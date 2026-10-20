// -----------------------------------------------------------------------------
// What the integration computes from the daily history of a station: its
// situation compared with the same days of the previous years, the trend of
// the last week, and the newest measurement (daily or real-time).
//
// The situation is an ESTIMATE of this integration, not the official
// indicator of the BRGM (IPS, monthly, standardized): the mean level of the
// last 10 days is ranked among the mean levels of the same 31 days (the
// calendar date ± 15 days) of every previous year with enough values. Its
// rank, from 0 (lower than every year) to 1 (higher than every year), gives
// five classes: very low (under 10 %), low (under 30 %), normal (30 to 70 %),
// high (up to 90 %), very high (above).
//
// The history is stored compactly: `[dayNumber, level, depth]` tuples, oldest
// first, `dayNumber` the days since 1970-01-01 (UTC), level in m NGF (altitude
// of the water table) and depth in m below the ground (null when missing).
// -----------------------------------------------------------------------------

export const DAY_MS = 24 * 60 * 60 * 1000;

export const SITUATIONS = ['very_low', 'low', 'normal', 'high', 'very_high'];

// Upper bound (rank) of each class but the last.
const CLASS_BOUNDS = [0.1, 0.3, 0.7, 0.9];

export const SITUATION_RULES = {
  // Years of history needed before a situation is given.
  minYears: 10,
  // Values needed in a 31-day window of a previous year.
  minValuesPerYear: 10,
  // Half-width of the window of the previous years, in days.
  windowDays: 15,
  // Days averaged for the current value.
  currentDays: 10,
  // No situation when the newest daily value is older than this.
  maxAgeDays: 30,
};

// A level moving by less than this in a week is steady.
export const STEADY_M_PER_WEEK = 0.05;

/** 'YYYY-MM-DD' → days since 1970-01-01. */
export const dayNumber = (day) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
/** Days since 1970-01-01 → 'YYYY-MM-DD'. */
export const dayString = (number) => new Date(number * DAY_MS).toISOString().slice(0, 10);

/** Parsed daily rows (src/hubeau.js parseDaily) → history tuples. */
export const toTuples = (rows) => rows.map((row) => [dayNumber(row.day), row.level, row.depth]);

/** Merge new tuples into a history (a day measured again replaces the old value). */
export function mergeHistory(history, tuples) {
  const byDay = new Map((history ?? []).map((tuple) => [tuple[0], tuple]));
  for (const tuple of tuples) {
    byDay.set(tuple[0], tuple);
  }
  return [...byDay.values()].sort((a, b) => a[0] - b[0]);
}

/**
 * The value series the ranking uses: the levels (m NGF) when the station
 * publishes them, else the depths turned negative (a deeper water table is a
 * lower one). Never a mix of both.
 */
export function rankedSeries(history) {
  const levels = history.filter((tuple) => tuple[1] !== null);
  const depths = history.filter((tuple) => tuple[2] !== null);
  return levels.length >= depths.length
    ? levels.map((tuple) => [tuple[0], tuple[1]])
    : depths.map((tuple) => [tuple[0], -tuple[2]]);
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Same month and day in another year (29 February → 28). */
function sameDayIn(year, month, day) {
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCMonth() !== month) {
    return Math.round(Date.UTC(year, month, 28) / DAY_MS);
  }
  return Math.round(date.getTime() / DAY_MS);
}

/**
 * The situation of a station.
 * @param {Array} history tuples, oldest first
 * @param {number} today days since 1970-01-01
 * @param {object} [rules]
 * @param {string|null} [previous] the class published before: kept while the
 *   rank stays within one year (1 / years) of its bounds, so a level hovering
 *   on a bound does not flip the class, and fire a trigger, every day
 * @returns {{ key: string|null, index: number|null, rank: number|null, years: number,
 *   reason: 'empty'|'stale'|'history'|null }}
 */
export function situationOf(history, today, rules = SITUATION_RULES, previous = null) {
  const series = rankedSeries(history ?? []);
  if (series.length === 0) {
    return { key: null, index: null, rank: null, years: 0, reason: 'empty' };
  }
  const last = series[series.length - 1][0];
  if (today - last > rules.maxAgeDays) {
    return { key: null, index: null, rank: null, years: 0, reason: 'stale' };
  }
  const current = mean(
    series.filter(([day]) => day > last - rules.currentDays).map(([, value]) => value),
  );
  const lastDate = new Date(last * DAY_MS);
  const references = [];
  const firstYear = new Date(series[0][0] * DAY_MS).getUTCFullYear();
  for (let year = firstYear; year < lastDate.getUTCFullYear(); year += 1) {
    const center = sameDayIn(year, lastDate.getUTCMonth(), lastDate.getUTCDate());
    const values = series
      .filter(([day]) => Math.abs(day - center) <= rules.windowDays)
      .map(([, value]) => value);
    if (values.length >= rules.minValuesPerYear) {
      references.push(mean(values));
    }
  }
  if (references.length < rules.minYears) {
    return { key: null, index: null, rank: null, years: references.length, reason: 'history' };
  }
  // Values equal at the centimetre count half: a flat aquifer stays "normal".
  const round = (value) => Math.round(value * 100);
  const below = references.filter((value) => round(value) < round(current)).length;
  const equal = references.filter((value) => round(value) === round(current)).length;
  const rank = (below + equal / 2) / references.length;
  let index = CLASS_BOUNDS.findIndex((bound, i) => (i < 2 ? rank < bound : rank <= bound));
  if (index === -1) {
    index = SITUATIONS.length - 1;
  }
  const kept = SITUATIONS.indexOf(previous);
  if (kept !== -1 && kept !== index) {
    const margin = 1 / references.length;
    const low = kept === 0 ? -Infinity : CLASS_BOUNDS[kept - 1] - margin;
    const high = kept === SITUATIONS.length - 1 ? Infinity : CLASS_BOUNDS[kept] + margin;
    if (rank >= low && rank <= high) {
      index = kept;
    }
  }
  return {
    key: SITUATIONS[index],
    index: index + 1,
    rank: Number(rank.toFixed(3)),
    years: references.length,
    reason: null,
  };
}

/** Rising, steady or falling over the last week; null without two values 7 to 14 days apart. */
export function trendOf(history) {
  const series = rankedSeries(history ?? []);
  if (series.length < 2) {
    return null;
  }
  const [last, value] = series[series.length - 1];
  const earlier = series.findLast(([day]) => day <= last - 7);
  if (!earlier || last - earlier[0] > 14) {
    return null;
  }
  const perWeek = ((value - earlier[1]) * 7) / (last - earlier[0]);
  if (perWeek >= STEADY_M_PER_WEEK) {
    return 'rising';
  }
  return perWeek <= -STEADY_M_PER_WEEK ? 'falling' : 'steady';
}

/**
 * The newest measurement: the last daily value, or the real-time one when it
 * is from the same day or newer (more precise). `daily: true` means a date
 * without a time.
 * @returns {{ at: number, day: string, level: number|null, depth: number|null, daily: boolean }|null}
 */
export function latestOf(history, realtime) {
  const last = history?.length > 0 ? history[history.length - 1] : null;
  const realtimeDay = realtime ? Math.floor(realtime.t / DAY_MS) : null;
  if (realtime && (!last || realtimeDay >= last[0])) {
    return {
      at: realtime.t,
      day: dayString(realtimeDay),
      level: realtime.level,
      depth: realtime.depth,
      daily: false,
    };
  }
  if (!last) {
    return null;
  }
  // A daily value is dated noon UTC: the middle of its day, whatever the zone.
  return {
    at: last[0] * DAY_MS + DAY_MS / 2,
    day: dayString(last[0]),
    level: last[1],
    depth: last[2],
    daily: true,
  };
}
