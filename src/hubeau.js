// -----------------------------------------------------------------------------
// Hub'Eau Piézométrie v1 (https://hubeau.eaufrance.fr/page/api-piezometrie):
// the groundwater stations of the ADES network (BRGM) and their measurements,
// keyless, under the Licence Ouverte Etalab 2.0.
//
// What the live API does (captures of October 2026, see test/fixtures/README.md):
//   - `stations` filters by bbox, commune, department, code; `date_recherche`
//     keeps the stations that measured on or after that date. The documented
//     `latitude`/`longitude`/`distance` filter does not exist: it is ignored
//     and the whole country comes back;
//   - `chroniques` gives one value a day (level in m NGF, depth below the
//     ground in m), `date_mesure` a plain date; 20000 rows a page at most (a
//     larger page answers 503), and a full history takes several seconds;
//   - `chroniques_tr` gives the hourly real-time values of the stations that
//     send them, `date_mesure` in UTC, the level named `niveau_eau_ngf`. It can
//     lag behind `chroniques` by a few days;
//   - a page with a next one answers 206, with a `next` URL in the body.
// -----------------------------------------------------------------------------

import { HttpError, getJson } from './http.js';

export const HUBEAU_BASE = 'https://hubeau.eaufrance.fr/api/v1/niveaux_nappes';

const STATION_FIELDS = [
  'bss_id',
  'code_bss',
  'libelle_pe',
  'code_commune_insee',
  'nom_commune',
  'code_departement',
  'x',
  'y',
  'altitude_station',
  'date_debut_mesure',
  'date_fin_mesure',
  'nb_mesures_piezo',
  'noms_masse_eau_edl',
].join(',');
const DAILY_FIELDS = 'bss_id,date_mesure,niveau_nappe_eau,profondeur_nappe';
const REALTIME_FIELDS = 'bss_id,date_mesure,niveau_eau_ngf,profondeur_nappe';

// The largest page Hub'Eau serves; a longer history takes a second page.
export const MAX_PAGE_SIZE = 20000;
const MAX_PAGES = 3;
// A full history weighs about 1 MB and takes a while to come.
const HISTORY_TIMEOUT_MS = 120000;

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const number = (value) => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** One station of the referential, in the shape the integration uses. */
export function parseStation(raw) {
  const id = text(raw?.bss_id);
  if (!id) {
    return null;
  }
  const aquifers = Array.isArray(raw.noms_masse_eau_edl) ? raw.noms_masse_eau_edl : [];
  return {
    id,
    code: text(raw.code_bss) ?? id,
    label: text(raw.libelle_pe),
    commune: text(raw.nom_commune),
    communeCode: text(raw.code_commune_insee),
    department: text(raw.code_departement),
    latitude: number(raw.y),
    longitude: number(raw.x),
    altitude: number(raw.altitude_station),
    firstDay: text(raw.date_debut_mesure),
    lastDay: text(raw.date_fin_mesure),
    measures: number(raw.nb_mesures_piezo),
    aquifer: text(aquifers[0]),
  };
}

/** Daily rows to `[{ day: 'YYYY-MM-DD', level, depth }]`, oldest first, one per day. */
export function parseDaily(rows) {
  const byDay = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const day = text(row?.date_mesure);
    const level = number(row?.niveau_nappe_eau);
    const depth = number(row?.profondeur_nappe);
    if (!day || !DAY.test(day) || (level === null && depth === null)) {
      continue;
    }
    byDay.set(day, { day, level, depth });
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** The newest real-time row to `{ t, level, depth }` (`t` in ms), or null. */
export function parseRealtime(rows) {
  let latest = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    const t = Date.parse(row?.date_mesure);
    const level = number(row?.niveau_eau_ngf);
    const depth = number(row?.profondeur_nappe);
    if (Number.isNaN(t) || (level === null && depth === null)) {
      continue;
    }
    if (!latest || t > latest.t) {
      latest = { t, level, depth };
    }
  }
  return latest;
}

export class HubEau {
  /**
   * @param {object} [options]
   * @param {Function} [options.fetch]
   */
  constructor({ fetch: fetchImpl } = {}) {
    this.fetch = fetchImpl ?? globalThis.fetch;
  }

  /** Every row of a paginated query (206 + `next`), a few pages at most. */
  async rows(path, params, { maxPages = MAX_PAGES, timeoutMs } = {}) {
    let url = `${HUBEAU_BASE}/${path}?${new URLSearchParams(params)}`;
    const rows = [];
    for (let page = 0; page < maxPages && url; page += 1) {
      const body = await getJson(this.fetch, url, timeoutMs ? { timeoutMs } : undefined);
      if (!body || typeof body !== 'object' || !Array.isArray(body.data)) {
        throw new HttpError("Hub'Eau: unexpected answer (no data list)");
      }
      rows.push(...body.data);
      url = typeof body.next === 'string' && body.next.startsWith(HUBEAU_BASE) ? body.next : null;
    }
    return rows;
  }

  async stations(params) {
    const rows = await this.rows(
      'stations',
      { ...params, fields: STATION_FIELDS, format: 'json', size: '500' },
      { maxPages: 2 },
    );
    return rows.map(parseStation).filter(Boolean);
  }

  /** One station by its code, new (BSS002FVWC) or old (09838D0727/F); null if unknown. */
  async station(code) {
    const param = code.startsWith('BSS') ? 'bss_id' : 'code_bss';
    const found = await this.stations({ [param]: code });
    return found.find((station) => station.id === code || station.code === code) ?? null;
  }

  /** Stations that measured since `sinceDay` in a box `[minLon, minLat, maxLon, maxLat]`. */
  stationsInBox(box, sinceDay) {
    return this.stations({
      bbox: box.map((value) => Number(value.toFixed(5))).join(','),
      date_recherche: sinceDay,
    });
  }

  /** Stations of a commune (INSEE code), active or not. */
  stationsOfCommune(commune) {
    return this.stations({ code_commune: commune });
  }

  /** Stations of a department that measured since `sinceDay`. */
  stationsOfDepartment(department, sinceDay) {
    return this.stations({ code_departement: department, date_recherche: sinceDay });
  }

  /**
   * The daily values of a station, oldest first: the whole history, or from
   * `sinceDay` (YYYY-MM-DD) on.
   */
  async daily(id, sinceDay = null) {
    const params = { bss_id: id, fields: DAILY_FIELDS, sort: 'asc', size: String(MAX_PAGE_SIZE) };
    if (sinceDay) {
      params.date_debut_mesure = sinceDay;
    }
    const rows = await this.rows('chroniques', params, {
      timeoutMs: sinceDay ? undefined : HISTORY_TIMEOUT_MS,
    });
    return parseDaily(rows);
  }

  /** The newest real-time value of a station, or null when it sends none. */
  async realtime(id) {
    const rows = await this.rows(
      'chroniques_tr',
      { bss_id: id, fields: REALTIME_FIELDS, sort: 'desc', size: '1' },
      { maxPages: 1 },
    );
    return parseRealtime(rows);
  }
}
