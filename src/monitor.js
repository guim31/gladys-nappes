// -----------------------------------------------------------------------------
// The monitor: which stations are followed, their history and measurements,
// the states published to Gladys and the scene triggers. Everything the SDK
// handlers, the action and the widget need goes through it (src/app.js wires
// it).
//
// Followed stations: the codes and "around my house" of the configuration
// (MAX_STATIONS at most), plus every station whose device the user created
// (deleting the device stops following it).
//
// Scheduling: the devices are published with should_poll: false (the core does
// not poll external devices reliably, GladysAssistant/Gladys#3198, and its
// longest period is one minute). The monitor runs a cycle every 6 hours: the
// measurements are daily. Per station and per cycle, two small Hub'Eau
// requests (the daily values of the last week, the newest real-time value);
// the whole history (about 1 MB) is read once, then again every 90 days.
//
// States: `publishChangedStates` sends only what changed, plus a heartbeat every
// 12 hours. Depth and level stop being published 45 days after the last
// measurement; the "Last measurement" feature says when it was.
//
// Logs: at info, only the lifecycle (start, stations followed, a station going
// silent or coming back, a situation change). A failure that repeats at every
// cycle (Hub'Eau unreachable) is logged once, then at debug until it recovers,
// with one line at recovery. LOG_LEVEL=debug shows every cycle. The coordinates
// of the house are never logged nor stored.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { HOME_STATIONS, MAX_STATIONS } from './config.js';
import { buildDevice, stationIdOf, stationIds, stationName } from './devices.js';
import { boxAround, distanceKm } from './geo.js';
import { HubEau } from './hubeau.js';
import {
  NO_SITUATION,
  SITUATION_NAMES,
  STATUS,
  formatMeasurement,
  join,
  render,
} from './messages.js';
import {
  DAY_MS,
  dayString,
  latestOf,
  mergeHistory,
  situationOf,
  toTuples,
  trendOf,
} from './situation.js';

const logger = createLogger({ name: 'nappes' });

export const WIDGET_KEY = 'stations';
export const TRIGGERS = { SITUATION: 'situation_changed', SILENT: 'station_silent' };
// Days without a measurement that fire the "station silent" trigger.
export const SILENCE_DAYS = ['7', '15', '30', '60'];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const DEFAULT_TIMINGS = {
  refreshMs: 6 * HOUR,
  // The whole history is read again this often (late corrections of the BRGM).
  historyMaxAgeMs: 90 * DAY_MS,
  // Days of daily values asked again at every cycle (late or corrected values).
  overlapDays: 7,
  // A station without real-time values is asked again once a day.
  realtimeRetryMs: DAY_MS,
  // Metadata of a station (name, commune, aquifer): asked again once a week.
  metadataMaxAgeMs: 7 * DAY_MS,
  // An unknown code is asked again after this delay.
  lookupRetryMs: HOUR,
  // The stations around the house are chosen again once a day.
  homeMaxAgeMs: DAY_MS,
  // Stations "in service": measured during the last days.
  activeDays: 30,
  // Depth and level are no longer published this long after the measurement.
  valueMaxAgeMs: 45 * DAY_MS,
  heartbeatMs: 12 * HOUR,
  // Between two Hub'Eau requests, to stay polite.
  requestSpacingMs: 500,
  // requestWidgetRefresh is rate-limited to one call every 10 s by the core.
  widgetRefreshMs: 10000,
};

export class Monitor {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK fake)
   * @param {object} options.store see src/store.js
   * @param {Function} [options.fetch] fetch, for Hub'Eau
   * @param {boolean} [options.timers] false: no background timer (tests drive the cycles)
   * @param {Function} [options.now] clock in ms
   * @param {Function} [options.sleep] `(ms) => Promise`
   * @param {object} [options.timings] overrides of DEFAULT_TIMINGS
   */
  constructor({ gladys, store, fetch: fetchImpl, timers = true, now, sleep, timings }) {
    this.gladys = gladys;
    this.store = store;
    this.hubeau = new HubEau({ fetch: fetchImpl });
    this.timers = timers;
    this.now = now ?? (() => Date.now());
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.config = null;
    this.data = emptyData();
    // Stations of the configuration, in order (codes, then house).
    this.configured = [];
    this.problems = { unknown: [], noHouse: false, noHomeStation: false, tooMany: false };
    this.resolved = false;
    this.lastCycleAt = -Infinity;
    this.statusMessage = undefined;
    this.cycleTimer = null;
    this.running = null;
    this.lastRefreshAt = -Infinity;
    this.refreshTimer = null;
    this.stopped = false;
    // Keys of the failures already logged, so a repeated one is not logged again.
    this.failing = new Set();
  }

  /** Log a failure once (warn or error), then at debug until `recovered(key)`. */
  failed(key, level, message, err) {
    const details = err ? [message, err] : [message];
    if (this.failing.has(key)) {
      logger.debug(...details);
      return;
    }
    this.failing.add(key);
    logger[level](...details);
  }

  /** One line when a failure logged by `failed(key)` is over. */
  recovered(key, message) {
    if (this.failing.delete(key)) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    const saved = await this.store.load();
    if (saved?.version === 1) {
      this.data = { ...emptyData(), ...saved };
    }
    await this.resolve();
    await this.publishDiscovered();
    await this.updateConnectionStatus();
    logger.info(`Started: ${this.followed().length} station(s) followed, refreshed every 6 hours`);
    this.schedule();
    this.runCycle();
  }

  /** Reconnection: Gladys may have restarted, publish everything again. */
  async resync(config) {
    this.config = config;
    await this.publishDiscovered();
    this.statusMessage = undefined;
    await this.updateConnectionStatus();
    this.gladys.forgetPublishedStates?.();
    await this.publishStates(this.created());
    this.requestRefresh();
  }

  async reconfigure(config) {
    const before = this.followed().join(',');
    this.config = config;
    this.data.home = null;
    this.resolved = false;
    await this.resolve();
    await this.publishDiscovered();
    await this.updateConnectionStatus();
    const after = this.followed();
    if (after.join(',') !== before) {
      logger.info(`Configuration saved: ${after.length} station(s) followed`);
    }
    await this.runCycle();
    this.requestRefresh();
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.cycleTimer);
    clearTimeout(this.refreshTimer);
    this.cycleTimer = null;
    await this.running?.catch(() => {});
    await this.store.flush();
  }

  schedule() {
    if (!this.timers || this.stopped) {
      return;
    }
    clearInterval(this.cycleTimer);
    this.cycleTimer = setInterval(() => this.runCycle(), this.timings.refreshMs);
    this.cycleTimer.unref?.();
  }

  save() {
    // Only the followed stations are kept: an unfollowed history is dropped,
    // never after an incomplete resolution (Hub'Eau or Gladys unreachable).
    const keep = new Set(this.followed());
    for (const table of this.resolved ? ['history', 'realtime', 'situations', 'silence'] : []) {
      for (const id of Object.keys(this.data[table])) {
        if (!keep.has(id)) {
          delete this.data[table][id];
        }
      }
    }
    return this.store.save(this.data);
  }

  today() {
    return Math.floor(this.now() / DAY_MS);
  }

  // --- Which stations ----------------------------------------------------------

  /** Station ids whose device exists in Gladys. */
  created() {
    return [
      ...new Set(
        (this.gladys.devices ?? [])
          .map((device) => stationIdOf(this.gladys, device.external_id))
          .filter(Boolean),
      ),
    ];
  }

  isCreated(id) {
    const externalId = stationIds(this.gladys, id).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  /** Every followed station: the configured ones, then the created ones. */
  followed() {
    return [...new Set([...this.configured, ...this.created()])];
  }

  /** What the integration knows of a station, a created device filling the gaps. */
  station(id) {
    const known = this.data.stations[id];
    if (known) {
      return known;
    }
    const device = (this.gladys.devices ?? []).find(
      (item) => stationIdOf(this.gladys, item.external_id) === id,
    );
    const param = (name) => device?.params?.find((p) => p.name === name)?.value;
    return {
      id,
      code: param('BSS_CODE') ?? id,
      label: null,
      commune: null,
      aquifer: param('AQUIFER') ?? null,
      name: device?.name,
    };
  }

  nameOf(id) {
    const station = this.station(id);
    return station.name ?? stationName(station);
  }

  /**
   * Resolve the configuration into station ids. A Hub'Eau failure keeps what
   * is cached and is tried again at the next cycle.
   */
  async resolve() {
    const problems = { unknown: [], noHouse: false, noHomeStation: false, tooMany: false };
    const ids = [];
    let complete = true;
    const add = (id) => {
      if (!ids.includes(id)) {
        ids.push(id);
      }
    };
    try {
      for (const code of this.config.stationCodes) {
        const id = await this.knownStation(code);
        if (id) {
          add(id);
        } else {
          problems.unknown.push(code);
        }
      }
      if (this.config.homeRadiusKm > 0) {
        const home = await this.homeStations();
        if (home === null) {
          problems.noHouse = true;
        } else if (home.length === 0) {
          problems.noHomeStation = true;
        } else {
          home.forEach(add);
        }
      }
      // Stations only followed through their device: their metadata too.
      for (const id of this.created()) {
        if (!this.data.stations[id]) {
          await this.knownStation(id);
        }
      }
      this.recovered('resolve', "Hub'Eau answers again: stations resolved");
    } catch (err) {
      complete = false;
      this.failed('resolve', 'warn', `Cannot resolve the stations yet: ${err.message}`);
    }
    // A failed resolution keeps the stations found before it, and their problems.
    const configured = complete ? ids : [...new Set([...this.configured, ...ids])];
    if (configured.length > MAX_STATIONS) {
      problems.tooMany = true;
      configured.length = MAX_STATIONS;
    }
    this.configured = configured;
    this.problems = complete ? problems : this.problems;
    this.resolved = complete;
    for (const code of problems.unknown) {
      this.failed(`unknown:${code}`, 'warn', `Unknown station code: ${code}`);
    }
    await this.save();
  }

  /**
   * The id of a station code (new or old), from the cache or Hub'Eau; null when
   * Hub'Eau does not know it.
   */
  async knownStation(code) {
    const now = this.now();
    const cachedId = this.data.aliases[code] ?? (this.data.stations[code] ? code : null);
    const cached = cachedId ? this.data.stations[cachedId] : null;
    if (cached && now - cached.fetchedAt < this.timings.metadataMaxAgeMs) {
      return cached.id;
    }
    const unknownAt = this.data.unknown[code];
    if (!cached && unknownAt && now - unknownAt < this.timings.lookupRetryMs) {
      return null;
    }
    let station;
    try {
      station = await this.hubeau.station(code);
    } catch (err) {
      // Hub'Eau down: a known station stays followed with its cached metadata.
      if (cached) {
        return cached.id;
      }
      throw err;
    }
    if (!station) {
      if (cached) {
        return cached.id;
      }
      this.data.unknown[code] = now;
      return null;
    }
    delete this.data.unknown[code];
    this.remember(station);
    if (code !== station.id) {
      this.data.aliases[code] = station.id;
    }
    logger.debug(`Station ${station.id}: ${stationName(station)}`);
    return station.id;
  }

  remember(station) {
    this.data.stations[station.id] = { ...station, fetchedAt: this.now() };
  }

  /** The first house of Gladys that has a location, or null (also when Gladys cannot tell). */
  async house() {
    try {
      return await this.locatedHouse();
    } catch (err) {
      this.failed('houses', 'warn', `Cannot read the houses of Gladys: ${err.message}`);
      return null;
    }
  }

  /** The first house that has a location, or null; throws when the houses cannot be read. */
  async locatedHouse() {
    const houses = await this.gladys.getHouses();
    this.recovered('houses', 'The houses of Gladys can be read again');
    return (
      houses.find((house) => Number.isFinite(house.latitude) && Number.isFinite(house.longitude)) ??
      null
    );
  }

  /** `YYYY-MM-DD` of the oldest last measurement a station "in service" may have. */
  activeSince() {
    return dayString(this.today() - this.timings.activeDays);
  }

  /**
   * The nearest stations in service around the house (HOME_STATIONS at most),
   * chosen again once a day; null without a located house.
   */
  async homeStations() {
    const radius = this.config.homeRadiusKm;
    const cached = this.data.home;
    if (
      cached &&
      cached.radiusKm === radius &&
      this.now() - cached.at < this.timings.homeMaxAgeMs
    ) {
      return cached.ids;
    }
    // A failure to read the houses is not "no house": the resolution is incomplete.
    const house = await this.locatedHouse();
    if (!house) {
      return null;
    }
    const ids = (
      await this.hubeau.stationsInBox(
        boxAround(house.latitude, house.longitude, radius),
        this.activeSince(),
      )
    )
      .filter((station) => station.latitude !== null && station.longitude !== null)
      .map((station) => ({
        station,
        km: distanceKm(house.latitude, house.longitude, station.latitude, station.longitude),
      }))
      .filter(({ km }) => km <= radius)
      .sort((a, b) => a.km - b.km)
      .slice(0, HOME_STATIONS)
      .map(({ station }) => {
        this.remember(station);
        return station.id;
      });
    // The house coordinates are not stored: only the radius and the stations.
    this.data.home = { radiusKm: radius, ids, at: this.now() };
    return ids;
  }

  // --- Discovery and connection status -----------------------------------------

  discoveredDevices() {
    return this.followed().map((id) =>
      buildDevice(this.gladys, this.station(id), this.config.language),
    );
  }

  async publishDiscovered() {
    await this.gladys.publishDiscoveredDevices(this.discoveredDevices());
  }

  async updateConnectionStatus() {
    const { unknown, noHouse, noHomeStation, tooMany } = this.problems;
    const parts = [];
    if (this.failing.has('readings') || (!this.resolved && this.failing.has('resolve'))) {
      parts.push(render(STATUS, 'hubeauDown'));
    }
    if (unknown.length > 0) {
      parts.push(render(STATUS, 'unknown', { codes: unknown.join(', ') }));
    }
    if (this.config.invalid.length > 0) {
      parts.push(render(STATUS, 'invalid', { values: this.config.invalid.join(', ') }));
    }
    if (noHouse) {
      parts.push(render(STATUS, 'noHouse'));
    }
    if (noHomeStation) {
      parts.push(render(STATUS, 'noHomeStation'));
    }
    if (tooMany) {
      parts.push(render(STATUS, 'tooMany', { max: MAX_STATIONS }));
    }
    if (
      this.resolved &&
      this.followed().length === 0 &&
      unknown.length === 0 &&
      !noHouse &&
      !noHomeStation
    ) {
      parts.push(render(STATUS, 'none'));
    }
    const message = parts.length > 0 ? join(...parts) : undefined;
    const connected = !this.failing.has('readings') && this.resolved;
    const key = JSON.stringify([connected, message]);
    if (key === this.statusMessage) {
      return;
    }
    this.statusMessage = key;
    await this.gladys.setConnectionStatus(connected, message).catch(() => {});
  }

  // --- Gladys events -----------------------------------------------------------

  async onDeviceCreated(device) {
    const id = stationIdOf(this.gladys, device.external_id);
    if (!id) {
      return;
    }
    if (!this.data.history[id]) {
      await this.runCycle();
    }
    if (!this.data.history[id]) {
      // The cycle in progress had started without this station.
      await this.runCycle();
    }
    // The SDK forgot the states of the device: everything is published again.
    await this.publishStates([id]);
    this.requestRefresh();
  }

  async onDeviceDeleted() {
    // A station only followed through its device is no longer followed.
    await this.publishDiscovered();
    await this.save();
    this.requestRefresh();
  }

  /** onPoll fallback: should_poll is false, but a Gladys polling anyway gets an answer. */
  async poll(device) {
    const id = stationIdOf(this.gladys, device.external_id);
    if (!id) {
      return;
    }
    // Read again only if the last cycle is older than half the interval.
    if (this.now() - this.lastCycleAt >= this.timings.refreshMs / 2) {
      await this.runCycle();
    } else {
      await this.publishStates([id]);
    }
  }

  // --- Cycles ------------------------------------------------------------------

  runCycle() {
    if (this.running || this.stopped) {
      return this.running;
    }
    this.running = this.cycle()
      .then(() => this.recovered('cycle', 'Refresh cycles work again'))
      .catch((err) => this.failed('cycle', 'error', 'Refresh cycle failed', err))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  async cycle() {
    this.lastCycleAt = this.now();
    // Cheap when the caches are fresh: the house stations are chosen again once
    // a day, the metadata once a week, a failed resolution at the next cycle.
    const before = this.discoveredKey();
    await this.resolve();
    if (this.discoveredKey() !== before) {
      await this.publishDiscovered();
    }
    const ids = this.followed();
    let changed = false;
    let failures = 0;
    let lastError = null;
    const read = new Set();
    for (const [index, id] of ids.entries()) {
      if (index > 0) {
        await this.sleep(this.timings.requestSpacingMs);
      }
      try {
        changed = (await this.refreshStation(id)) || changed;
        read.add(id);
      } catch (err) {
        failures += 1;
        lastError = err;
        logger.debug(`Station ${id} not refreshed: ${err.message}`);
      }
    }
    if (ids.length > 0 && failures === ids.length) {
      this.failed('readings', 'warn', `Hub'Eau unreachable: ${lastError.message}`);
    } else {
      this.recovered('readings', "Hub'Eau answers again");
    }
    for (const id of ids) {
      changed = (await this.checkStation(id, read.has(id))) || changed;
    }
    await this.publishStates(this.created());
    await this.updateConnectionStatus();
    await this.save();
    logger.debug(`Refresh cycle: ${ids.length} station(s)`);
    if (changed) {
      this.requestRefresh();
    }
  }

  discoveredKey() {
    return JSON.stringify(this.discoveredDevices());
  }

  /** Read the new measurements of a station; resolves true when one changed. */
  async refreshStation(id) {
    const now = this.now();
    const before = JSON.stringify(this.latest(id));
    const known = this.data.history[id];
    if (!known || now - known.fullAt >= this.timings.historyMaxAgeMs) {
      const tuples = toTuples(await this.hubeau.daily(id));
      this.data.history[id] = { tuples, fullAt: now };
      logger.debug(`Station ${id}: ${tuples.length} daily values`);
    } else {
      const last = known.tuples.at(-1)?.[0] ?? this.today() - this.timings.overlapDays;
      const since = dayString(Math.min(last, this.today()) - this.timings.overlapDays);
      const fresh = toTuples(await this.hubeau.daily(id, since));
      known.tuples = mergeHistory(known.tuples, fresh);
    }
    const realtime = this.data.realtime[id];
    if (
      !realtime ||
      realtime.value !== null ||
      now - realtime.checkedAt >= this.timings.realtimeRetryMs
    ) {
      this.data.realtime[id] = { value: await this.hubeau.realtime(id), checkedAt: now };
    }
    return JSON.stringify(this.latest(id)) !== before;
  }

  /** The newest measurement of a station, or null. */
  latest(id) {
    return latestOf(this.data.history[id]?.tuples, this.data.realtime[id]?.value ?? null);
  }

  /** The situation, the stored one kept while the rank stays near its class. */
  situation(id) {
    return situationOf(
      this.data.history[id]?.tuples ?? [],
      this.today(),
      undefined,
      this.data.situations[id]?.key ?? null,
    );
  }

  trend(id) {
    return trendOf(this.data.history[id]?.tuples ?? []);
  }

  /** Days since the newest measurement (whole days), or null. */
  silentDays(id) {
    const latest = this.latest(id);
    return latest ? Math.floor((this.now() - latest.at) / DAY_MS) : null;
  }

  /**
   * Situation change and silence of a station: logs and scene triggers. The
   * silence is only judged on a station read this cycle: Hub'Eau being down
   * is not a station without measurement.
   */
  async checkStation(id, read = true) {
    let changed = false;
    const situation = this.situation(id);
    const previous = this.data.situations[id];
    if (situation.key && situation.key !== previous?.key) {
      this.data.situations[id] = { key: situation.key, at: this.now() };
      changed = true;
      if (previous?.key) {
        await this.situationChanged(id, previous.key, situation.key);
      }
    }
    const days = this.silentDays(id);
    if (days === null || !read) {
      return changed;
    }
    const crossed = SILENCE_DAYS.filter((threshold) => days >= Number(threshold));
    const record = this.data.silence[id];
    this.data.silence[id] = { notified: crossed };
    if (!record) {
      // First sight (or after a lost /data): remembered, never fired.
      return changed;
    }
    const fresh = crossed.filter((threshold) => !record.notified.includes(threshold));
    if (record.notified.length > 0 && crossed.length === 0) {
      logger.info(`${this.nameOf(id)}: measurements are back`);
      return true;
    }
    if (fresh.length === 0) {
      return changed;
    }
    // After a long stop, only the longest silence crossed fires.
    const threshold = fresh.at(-1);
    logger.info(`${this.nameOf(id)}: no new measurement for ${threshold} days`);
    if (this.isCreated(id)) {
      const latest = this.latest(id);
      await this.gladys
        .publishSceneEvent(TRIGGERS.SILENT, {
          station: stationIds(this.gladys, id).device,
          days: threshold,
          station_name: this.nameOf(id),
          last_measurement: formatMeasurement(latest, this.config.language),
        })
        .catch((err) => logger.warn(`${TRIGGERS.SILENT} event refused: ${err.message}`));
    }
    return true;
  }

  async situationChanged(id, from, to) {
    const name = this.nameOf(id);
    logger.info(`${name}: groundwater situation ${from} -> ${to}`);
    if (!this.isCreated(id)) {
      return;
    }
    const names = SITUATION_NAMES[this.config.language];
    const latest = this.latest(id);
    await this.gladys
      .publishSceneEvent(TRIGGERS.SITUATION, {
        station: stationIds(this.gladys, id).device,
        situation: to,
        station_name: name,
        situation_name: names[to],
        previous_situation: from,
        previous_situation_name: names[from],
        depth: latest?.depth ?? null,
        level: latest?.level ?? null,
      })
      .catch((err) => logger.warn(`${TRIGGERS.SITUATION} event refused: ${err.message}`));
  }

  // --- States ------------------------------------------------------------------

  /** The states of the given stations whose device exists. */
  statesOf(ids) {
    const states = [];
    const language = this.config.language;
    for (const id of ids) {
      if (!this.isCreated(id)) {
        continue;
      }
      const feature = stationIds(this.gladys, id);
      const latest = this.latest(id);
      if (latest && this.now() - latest.at <= this.timings.valueMaxAgeMs) {
        if (latest.depth !== null) {
          states.push({ device_feature_external_id: feature.depth, state: latest.depth });
        }
        if (latest.level !== null) {
          states.push({ device_feature_external_id: feature.level, state: latest.level });
        }
      }
      if (latest) {
        states.push({
          device_feature_external_id: feature.lastMeasurement,
          text: formatMeasurement(latest, language),
        });
      }
      const situation = this.situation(id);
      if (situation.key) {
        states.push(
          { device_feature_external_id: feature.situationIndex, state: situation.index },
          {
            device_feature_external_id: feature.situation,
            text: SITUATION_NAMES[language][situation.key],
          },
        );
      } else if (situation.reason === 'history' || situation.reason === 'stale') {
        states.push({
          device_feature_external_id: feature.situation,
          text: NO_SITUATION[language][situation.reason],
        });
      }
    }
    return states;
  }

  async publishStates(ids) {
    const states = this.statesOf(ids);
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.recovered('publish', 'Publishing the states works again');
    } catch (err) {
      // Sent again at the next cycle (the SDK forgets what Gladys refused).
      this.failed('publish', 'warn', `Publishing the states failed: ${err.message}`);
    }
  }

  // --- Widget -------------------------------------------------------------------

  requestRefresh() {
    if (this.stopped) {
      return;
    }
    const now = this.now();
    const wait = this.lastRefreshAt + this.timings.widgetRefreshMs - now;
    if (wait <= 0) {
      this.lastRefreshAt = now;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } else if (this.timers && !this.refreshTimer) {
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        this.requestRefresh();
      }, wait);
      this.refreshTimer.unref?.();
    }
  }

  /** What the widget shows of one station. */
  view(id) {
    const latest = this.latest(id);
    const fresh = Boolean(latest && this.now() - latest.at <= this.timings.valueMaxAgeMs);
    return {
      id,
      code: this.station(id).code ?? id,
      name: this.nameOf(id),
      latest,
      fresh,
      depth: fresh ? latest.depth : null,
      level: fresh ? latest.level : null,
      situation: this.situation(id),
      trend: fresh ? this.trend(id) : null,
    };
  }
}

function emptyData() {
  return {
    version: 1,
    stations: {},
    aliases: {},
    unknown: {},
    home: null,
    history: {},
    realtime: {},
    situations: {},
    silence: {},
  };
}
