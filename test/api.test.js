// -----------------------------------------------------------------------------
// The Hub'Eau Piézométrie client on the recorded answers: shapes, requests,
// pagination, failures. Nothing touches the network.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxAround, distanceKm } from '../src/geo.js';
import { HttpError, USER_AGENT, getJson } from '../src/http.js';
import { HUBEAU_BASE, HubEau, parseDaily, parseRealtime, parseStation } from '../src/hubeau.js';
import { HOUSE, LOMBEZ, fixture } from './helpers/world.js';

const answer = (status, body) => async () => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

test("Hub'Eau stations: the referential shape (altitude given as text)", () => {
  const lombez = fixture('hubeau/stations.json').data.find((s) => s.bss_id === LOMBEZ);
  assert.deepEqual(parseStation(lombez), {
    id: LOMBEZ,
    code: '09838D0727/F',
    label: 'LOMBEZ',
    commune: 'Toulouse',
    communeCode: '31555',
    department: '31',
    latitude: lombez.y,
    longitude: lombez.x,
    altitude: 138.75,
    firstDay: '1997-01-16',
    lastDay: '2026-10-16',
    measures: 10164,
    aquifer: 'Alluvions de la Garonne moyenne autour de Toulouse',
  });
  assert.equal(parseStation({ code_bss: 'x' }), null);
});

test("Hub'Eau daily values: one a day, oldest first, the empty ones dropped", () => {
  const rows = fixture('hubeau/chroniques-09838D0727_F.json').data;
  const daily = parseDaily(rows);
  assert.equal(daily.at(-1).day, '2026-10-19');
  assert.deepEqual(daily.at(-1), { day: '2026-10-19', level: 133.85, depth: 5.06 });
  assert.ok(daily.every((row, i) => i === 0 || row.day > daily[i - 1].day));
  assert.deepEqual(
    parseDaily([
      { date_mesure: '2026-10-02', niveau_nappe_eau: 1, profondeur_nappe: null },
      { date_mesure: '2026-10-01', niveau_nappe_eau: null, profondeur_nappe: null },
      { date_mesure: 'yesterday', niveau_nappe_eau: 1 },
    ]),
    [{ day: '2026-10-02', level: 1, depth: null }],
  );
});

test("Hub'Eau real-time values: the newest one, its time in UTC", () => {
  const rows = fixture('hubeau/chroniques_tr-09838D0727_F.json').data;
  assert.deepEqual(parseRealtime(rows), {
    t: Date.parse('2026-10-17T03:00:00Z'),
    level: 133.848,
    depth: 5.062,
  });
  assert.equal(parseRealtime([]), null);
});

test("Hub'Eau: the requests ask only the useful fields, by the new code", async () => {
  const calls = [];
  const hubeau = new HubEau({
    fetch: async (url) => {
      calls.push(new URL(url));
      return answer(200, { data: [], next: null })();
    },
  });
  await hubeau.station('09838D0727/F');
  await hubeau.station(LOMBEZ);
  await hubeau.daily(LOMBEZ);
  await hubeau.daily(LOMBEZ, '2026-10-12');
  await hubeau.realtime(LOMBEZ);
  await hubeau.stationsInBox([1.2, 43.4, 1.7, 43.8], '2026-09-20');
  const [byOld, byNew, full, since, realtime, box] = calls;
  assert.equal(byOld.searchParams.get('code_bss'), '09838D0727/F');
  assert.equal(byNew.searchParams.get('bss_id'), LOMBEZ);
  assert.equal(full.pathname, '/api/v1/niveaux_nappes/chroniques');
  assert.equal(full.searchParams.get('size'), '20000');
  assert.equal(full.searchParams.get('sort'), 'asc');
  assert.equal(
    full.searchParams.get('fields'),
    'bss_id,date_mesure,niveau_nappe_eau,profondeur_nappe',
  );
  assert.equal(since.searchParams.get('date_debut_mesure'), '2026-10-12');
  assert.equal(realtime.pathname, '/api/v1/niveaux_nappes/chroniques_tr');
  assert.equal(realtime.searchParams.get('size'), '1');
  assert.equal(realtime.searchParams.get('sort'), 'desc');
  assert.equal(box.searchParams.get('bbox'), '1.2,43.4,1.7,43.8');
  assert.equal(box.searchParams.get('date_recherche'), '2026-09-20');
});

test("Hub'Eau: a 206 page is followed through its next link, on Hub'Eau only", async () => {
  const row = (day) => ({ date_mesure: day, niveau_nappe_eau: 1, profondeur_nappe: 2 });
  let calls = 0;
  const hubeau = new HubEau({
    fetch: async (url) => {
      calls += 1;
      return url.includes('page=2')
        ? answer(206, { data: [row('2026-10-02')], next: 'https://example.org/page=3' })()
        : answer(206, { data: [row('2026-10-01')], next: `${HUBEAU_BASE}/chroniques?page=2` })();
    },
  });
  const daily = await hubeau.daily(LOMBEZ);
  assert.equal(calls, 2);
  assert.equal(daily.length, 2);
});

test('HTTP failures become an HttpError: status, network, timeout, not JSON', async () => {
  await assert.rejects(getJson(answer(503, 'down'), `${HUBEAU_BASE}/x`), {
    name: 'HttpError',
    status: 503,
    message: 'hubeau.eaufrance.fr: HTTP 503',
  });
  await assert.rejects(
    getJson(async () => {
      throw new TypeError('fetch failed');
    }, `${HUBEAU_BASE}/x`),
    { message: 'hubeau.eaufrance.fr: fetch failed', status: null },
  );
  await assert.rejects(
    getJson(async () => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    }, `${HUBEAU_BASE}/x`),
    { message: 'hubeau.eaufrance.fr: no answer in 30 s' },
  );
  await assert.rejects(getJson(answer(200, '<html>'), `${HUBEAU_BASE}/x`), {
    message: 'hubeau.eaufrance.fr: the answer is not JSON',
  });
  await assert.rejects(new HubEau({ fetch: answer(200, { oops: 1 }) }).station(LOMBEZ), HttpError);
});

test('every request names the integration and asks for JSON', async () => {
  let headers;
  await getJson(async (url, options) => {
    headers = options.headers;
    return answer(200, {})();
  }, `${HUBEAU_BASE}/x`);
  assert.deepEqual(headers, { Accept: 'application/json', 'User-Agent': USER_AGENT });
});

test('the box around the house is rounded out to a 0.05° grid, and holds the circle', () => {
  const box = boxAround(HOUSE.latitude, HOUSE.longitude, 10);
  for (const value of box) {
    assert.ok(Math.abs(value * 20 - Math.round(value * 20)) < 1e-9, `${value} on the grid`);
  }
  assert.ok(distanceKm(HOUSE.latitude, HOUSE.longitude, HOUSE.latitude, box[2]) >= 10);
  assert.ok(distanceKm(HOUSE.latitude, HOUSE.longitude, box[3], HOUSE.longitude) >= 10);
  assert.ok(Math.abs(distanceKm(48.8566, 2.3522, 43.6047, 1.4442) - 588) < 2, 'Paris-Toulouse');
});
