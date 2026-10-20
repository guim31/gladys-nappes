// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Hub'Eau serving the
// recorded answers of test/fixtures (filtered the way the real API filters), a
// manual clock, a temporary /data, and the integration wired on top through
// registerHandlers. Nothing touches the network.
// -----------------------------------------------------------------------------

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';

process.env.LOG_LEVEL ??= 'silent';
process.env.TZ = 'Europe/Paris';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

// The captures were made on 20/10/2026: the clock starts that morning.
export const START = Date.parse('2026-10-20T08:00:00Z');
export const DAY = 24 * 60 * 60 * 1000;

// A house in Toulouse (Capitole square, public coordinates).
export const HOUSE = {
  id: 'house-1',
  name: 'Maison',
  selector: 'maison',
  latitude: 43.6045,
  longitude: 1.444,
};

// Five real stations around Toulouse (see test/fixtures/README.md).
export const LOMBEZ = 'BSS002FVWC'; // 09838D0727/F, Toulouse, alluvium, real-time, very high
export const UPS = 'BSS002GCNV'; // 09845C1426/F, Toulouse, molasse, normal
export const LAMASQUERE = 'BSS002HSFG'; // 10092X0166/F, silent since 08/09/2026
export const EAUNES = 'BSS002HVPP'; // 10098A0004/F, deep confined aquifer, very low
export const DAUX = 'BSS002FPUU'; // 09833C0249/F, no daily history served
export const OLD_CODES = {
  [LOMBEZ]: '09838D0727/F',
  [UPS]: '09845C1426/F',
  [LAMASQUERE]: '10092X0166/F',
  [EAUNES]: '10098A0004/F',
  [DAUX]: '09833C0249/F',
};

const fileOf = (id) => OLD_CODES[id].replace('/', '_');

/**
 * Fake Hub'Eau. `api.down`: 'network' (connection refused), a status (503) or false.
 */
export function createApi() {
  const stations = fixture('hubeau/stations.json');
  const daily = {};
  const realtime = {};
  for (const id of Object.keys(OLD_CODES)) {
    try {
      daily[id] = fixture(`hubeau/chroniques-${fileOf(id)}.json`).data;
      realtime[id] = fixture(`hubeau/chroniques_tr-${fileOf(id)}.json`).data;
    } catch {
      daily[id] = [];
      realtime[id] = [];
    }
  }
  const envelope = (data) => ({
    count: data.length,
    first: null,
    last: null,
    prev: null,
    next: null,
    api_version: '1.4.3',
    data,
  });

  const api = {
    stations: stations.data,
    daily,
    realtime,
    down: false,
    requests: [],

    /** Add a daily value (and a real-time one at noon UTC when `withRealtime`). */
    addDaily(id, day, level, depth, { withRealtime = false } = {}) {
      api.daily[id] = api.daily[id].filter((row) => row.date_mesure !== day);
      api.daily[id].push({
        code_bss: OLD_CODES[id],
        date_mesure: day,
        niveau_nappe_eau: level,
        profondeur_nappe: depth,
      });
      if (withRealtime) {
        api.realtime[id].unshift({
          code_bss: OLD_CODES[id],
          bss_id: id,
          date_mesure: `${day}T12:00:00Z`,
          niveau_eau_ngf: level,
          profondeur_nappe: depth,
        });
      }
    },

    /** Requests to one endpoint ('stations', 'chroniques', 'chroniques_tr'). */
    calls(endpoint) {
      return api.requests.filter((url) => url.pathname.endsWith(`/${endpoint}`));
    },

    hubeau(url) {
      const params = url.searchParams;
      const endpoint = url.pathname.split('/').pop();
      if (endpoint === 'stations') {
        let data = api.stations;
        const filters = {
          bss_id: 'bss_id',
          code_bss: 'code_bss',
          code_commune: 'code_commune_insee',
          code_departement: 'code_departement',
        };
        for (const [param, key] of Object.entries(filters)) {
          if (params.has(param)) {
            data = data.filter((s) => params.get(param).split(',').includes(s[key]));
          }
        }
        if (params.has('date_recherche')) {
          data = data.filter((s) => s.date_fin_mesure >= params.get('date_recherche'));
        }
        if (params.has('bbox')) {
          const [minLon, minLat, maxLon, maxLat] = params.get('bbox').split(',').map(Number);
          data = data.filter(
            (s) => s.x >= minLon && s.x <= maxLon && s.y >= minLat && s.y <= maxLat,
          );
        }
        return envelope(data);
      }
      const id = params.get('bss_id');
      const size = Number(params.get('size') ?? 5000);
      if (size > 20000) {
        return 503;
      }
      if (endpoint === 'chroniques') {
        const since = params.get('date_debut_mesure') ?? '';
        const data = (api.daily[id] ?? [])
          .filter((row) => row.date_mesure >= since)
          .sort((a, b) => a.date_mesure.localeCompare(b.date_mesure));
        if (params.get('sort') === 'desc') {
          data.reverse();
        }
        return envelope(data.slice(0, size));
      }
      if (endpoint === 'chroniques_tr') {
        const data = [...(api.realtime[id] ?? [])].sort((a, b) =>
          b.date_mesure.localeCompare(a.date_mesure),
        );
        return envelope(data.slice(0, size));
      }
      return null;
    },

    async fetch(input) {
      const url = new URL(input);
      api.requests.push(url);
      if (api.down === 'network') {
        throw new TypeError('fetch failed');
      }
      if (api.down) {
        return { status: api.down, text: async () => 'Service Unavailable' };
      }
      const body = api.hubeau(url);
      if (body === null || typeof body === 'number') {
        const status = body ?? 404;
        return { status, text: async () => 'error' };
      }
      return { status: 200, text: async () => JSON.stringify(body) };
    },
  };
  return api;
}

/** A manual clock; `sleep` moves it forward instead of waiting. */
export function createClock(start = START) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
    async sleep(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {Array} [options.houses] houses of Gladys
 * @param {object} [options.api] from createApi
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers] true: the monitor's own timer runs (mock it)
 */
export async function createWorld({
  config = {},
  devices = [],
  houses = [HOUSE],
  api = createApi(),
  connect = true,
  timers = false,
  clock = createClock(),
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-nappes-')),
} = {}) {
  const gladys = createFakeGladys({ config, devices, houses });
  const store = new Store(dataDir);
  const app = registerHandlers(gladys, {
    store,
    fetch: api.fetch,
    timers,
    now: clock.now,
    sleep: clock.sleep,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
    await app.monitor.running;
  }
  return { gladys, fake: gladys.fake, app, monitor: app.monitor, api, clock, store, dataDir };
}

/** The device published for a station id, from the last discovery list. */
export const discovered = (world, id) =>
  world.fake.discoveredDevices.find((device) =>
    device.params.some((p) => p.name === 'BSS_ID' && p.value === id),
  );

/** Create the device of a station in Gladys, as the user would. */
export async function create(world, id) {
  const device = discovered(world, id);
  if (!device) {
    throw new Error(`${id} is not in the discovered devices`);
  }
  await world.fake.deviceCreated(device);
  return device;
}

/** External id of one feature of a device. */
export const featureId = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`))?.external_id;

/** Run one refresh cycle, `hours` later. */
export async function cycle(world, hours = 6) {
  world.clock.advance(hours * 60 * 60 * 1000);
  await world.monitor.runCycle();
}

/**
 * Capture the integration's log lines at `level` and above (LOG_LEVEL is read
 * at every call). Returns the lines as `{ level, text }`.
 */
export function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => {
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    const match = /^\[[^\]]+\] \[(\w+)\]/.exec(text);
    lines.push({ level: match ? match[1].toLowerCase() : 'raw', text });
  };
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}
