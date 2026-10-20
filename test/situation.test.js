// -----------------------------------------------------------------------------
// The situation, the trend and the newest measurement, on the real histories
// of four stations around Toulouse (captured on 20/10/2026) and on built ones.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDaily, parseRealtime } from '../src/hubeau.js';
import {
  SITUATIONS,
  dayNumber,
  dayString,
  latestOf,
  mergeHistory,
  situationOf,
  toTuples,
  trendOf,
} from '../src/situation.js';
import { fixture } from './helpers/world.js';

const TODAY = dayNumber('2026-10-20');
const history = (file) => toTuples(parseDaily(fixture(`hubeau/${file}`).data));

/** A flat history: `value(year)` for every day of September to November, 1990 to 2025. */
function built(value, { from = 1990, to = 2025 } = {}) {
  const tuples = [];
  for (let year = from; year <= to; year += 1) {
    for (let day = dayNumber(`${year}-09-01`); day <= dayNumber(`${year}-11-30`); day += 1) {
      tuples.push([day, value(year), 10 - value(year)]);
    }
  }
  return tuples;
}
const withCurrent = (tuples, value) => {
  const current = [];
  for (let day = TODAY - 20; day < TODAY; day += 1) {
    current.push([day, value, 10 - value]);
  }
  return mergeHistory(tuples, current);
};

test('the real stations: very high, normal, very low, and silent', () => {
  const lombez = situationOf(history('chroniques-09838D0727_F.json'), TODAY);
  assert.deepEqual(lombez, { key: 'very_high', index: 5, rank: 0.926, years: 27, reason: null });
  const ups = situationOf(history('chroniques-09845C1426_F.json'), TODAY);
  assert.equal(ups.key, 'normal');
  assert.equal(ups.years, 27);
  const eaunes = situationOf(history('chroniques-10098A0004_F.json'), TODAY);
  assert.equal(eaunes.key, 'very_low');
  assert.equal(eaunes.rank, 0);
  // Silent since 08/09/2026: 42 days, too old for a situation.
  const lamasquere = situationOf(history('chroniques-10092X0166_F.json'), TODAY);
  assert.equal(lamasquere.key, null);
  assert.equal(lamasquere.reason, 'stale');
});

test('the five classes follow the rank among the previous years', () => {
  // 36 previous years at 0, 1, 2 … 35 m: the current value places the rank.
  const base = built((year) => year - 1990);
  const cases = [
    [-1, 'very_low'],
    [3, 'very_low'], // (3 + 0.5) / 36 = 0.097
    [4, 'low'], // 0.125
    [10, 'low'], // 0.292
    [11, 'normal'], // 0.319
    [24, 'normal'], // 0.681
    [25, 'high'], // 0.708
    [31, 'high'], // 0.875
    [33, 'very_high'], // 0.931
    [99, 'very_high'],
  ];
  for (const [value, key] of cases) {
    assert.equal(situationOf(withCurrent(base, value), TODAY).key, key, `value ${value}`);
  }
  assert.equal(situationOf(withCurrent(base, 99), TODAY).index, 5);
  assert.deepEqual(SITUATIONS, ['very_low', 'low', 'normal', 'high', 'very_high']);
});

test('a flat aquifer stays normal: equal values count half', () => {
  const result = situationOf(
    withCurrent(
      built(() => 5),
      5,
    ),
    TODAY,
  );
  assert.equal(result.key, 'normal');
  assert.equal(result.rank, 0.5);
});

test('under 10 years of history, no situation', () => {
  const short = withCurrent(
    built(() => 5, { from: 2017 }),
    1,
  );
  const result = situationOf(short, TODAY);
  assert.equal(result.key, null);
  assert.equal(result.reason, 'history');
  assert.equal(result.years, 9);
  assert.equal(situationOf([], TODAY).reason, 'empty');
});

test('a station that only gives depths is ranked on them, deeper being lower', () => {
  const depthsOnly = withCurrent(
    built((year) => year - 1990),
    -1,
  ).map(([day, , depth]) => [day, null, depth]);
  // Depth 11 m, deeper than every year (10 - 0 … 10 - 35): very low.
  assert.equal(situationOf(depthsOnly, TODAY).key, 'very_low');
});

test('the trend compares the last value with the one a week before', () => {
  const at = (pairs) => pairs.map(([offset, value]) => [TODAY + offset, value, null]);
  assert.equal(
    trendOf(
      at([
        [-8, 10],
        [-1, 10.1],
      ]),
    ),
    'rising',
  );
  assert.equal(
    trendOf(
      at([
        [-7, 10],
        [0, 9.9],
      ]),
    ),
    'falling',
  );
  assert.equal(
    trendOf(
      at([
        [-7, 10],
        [0, 10.02],
      ]),
    ),
    'steady',
  );
  // Too far apart, or a single value: no trend.
  assert.equal(
    trendOf(
      at([
        [-30, 10],
        [0, 12],
      ]),
    ),
    null,
  );
  assert.equal(trendOf(at([[0, 10]])), null);
  assert.equal(trendOf(history('chroniques-10098A0004_F.json')), 'falling');
});

test('the newest measurement: the daily one, or the real-time one of the same day or later', () => {
  const daily = history('chroniques-09838D0727_F.json');
  const realtime = parseRealtime(fixture('hubeau/chroniques_tr-09838D0727_F.json').data);
  // Real-time values stop on 17/10 03:00 UTC, the daily ones go on until 19/10.
  assert.equal(new Date(realtime.t).toISOString(), '2026-10-17T03:00:00.000Z');
  assert.deepEqual(latestOf(daily, realtime), {
    at: Date.parse('2026-10-19T12:00:00Z'),
    day: '2026-10-19',
    level: 133.85,
    depth: 5.06,
    daily: true,
  });
  const newer = { t: Date.parse('2026-10-19T15:00:00Z'), level: 133.9, depth: 5.01 };
  assert.equal(latestOf(daily, newer).daily, false);
  assert.equal(latestOf([], newer).level, 133.9);
  assert.equal(latestOf([], null), null);
});

test('merging keeps one value a day, the newest answer winning', () => {
  const merged = mergeHistory(
    [
      [1, 10, 2],
      [2, 11, 1],
    ],
    [
      [2, 12, 0],
      [3, 13, -1],
    ],
  );
  assert.deepEqual(merged, [
    [1, 10, 2],
    [2, 12, 0],
    [3, 13, -1],
  ]);
  assert.equal(dayString(dayNumber('2024-02-29')), '2024-02-29');
});
