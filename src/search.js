// -----------------------------------------------------------------------------
// The "Find stations" configuration action: lists groundwater stations near the
// house, in a commune, a department or by code, with their distance, their
// first year and their last measurement, so the user can copy the codes into
// the configuration.
//
// What can be typed (one at a time):
//   - nothing: the stations in service around the house (its location in Gladys);
//   - an INSEE commune code (31555): every station of the commune, the ones in
//     service first;
//   - a department number (31, 2A, 974): the stations in service there;
//   - a station code, new (BSS002FVWC) or old (09838D0727/F).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { stationCodeOf } from './config.js';
import { stationName } from './devices.js';
import { boxAround, distanceKm } from './geo.js';
import { SEARCH, formatDay, formatNumber, render } from './messages.js';

const logger = createLogger({ name: 'nappes-search' });

export const SEARCH_RADII = ['10', '20', '30', '50'];
const DEFAULT_RADIUS_KM = 20;
const MAX_RESULTS = 10;
const COMMUNE = /^(?:\d{5}|2[AB]\d{3})$/;
const DEPARTMENT = /^(?:\d{2}|2[AB]|97[1-6])$/;

/** What the user typed: `{ kind: 'house'|'station'|'commune'|'department', value }`. */
export function parseQuery(text) {
  const token = String(text ?? '').trim();
  if (token === '') {
    return { kind: 'house', value: null };
  }
  const code = stationCodeOf(token);
  if (code) {
    return { kind: 'station', value: code };
  }
  const upper = token.toUpperCase();
  if (COMMUNE.test(upper)) {
    return { kind: 'commune', value: upper };
  }
  if (DEPARTMENT.test(upper)) {
    return { kind: 'department', value: upper };
  }
  return { kind: 'invalid', value: token };
}

async function candidates(monitor, query, radiusKm) {
  const since = monitor.activeSince();
  const house = await monitor.house();
  switch (query.kind) {
    case 'station': {
      const station = await monitor.hubeau.station(query.value);
      return { stations: station ? [station] : [], origin: house };
    }
    case 'commune':
      return { stations: await monitor.hubeau.stationsOfCommune(query.value), origin: house };
    case 'department':
      return {
        stations: await monitor.hubeau.stationsOfDepartment(query.value, since),
        origin: house,
      };
    case 'house': {
      if (!house) {
        return { error: 'noHouse' };
      }
      const stations = (
        await monitor.hubeau.stationsInBox(
          boxAround(house.latitude, house.longitude, radiusKm),
          since,
        )
      ).filter(
        (station) =>
          station.latitude !== null &&
          distanceKm(house.latitude, house.longitude, station.latitude, station.longitude) <=
            radiusKm,
      );
      return { stations, origin: house };
    }
    default:
      return { error: 'invalid' };
  }
}

/**
 * Handler of the `search_stations` action.
 * @param {import('./monitor.js').Monitor} monitor
 * @param {{ query?: string, radius?: string }} fields
 */
export async function searchStations(monitor, fields = {}) {
  const query = parseQuery(fields.query);
  const radiusKm = SEARCH_RADII.includes(String(fields.radius))
    ? Number(fields.radius)
    : DEFAULT_RADIUS_KM;
  try {
    const found = await candidates(monitor, query, radiusKm);
    if (found.error) {
      return render(SEARCH, found.error);
    }
    const since = monitor.activeSince();
    const { origin } = found;
    const listed = found.stations
      .map((station) => ({
        station,
        active: (station.lastDay ?? '') >= since,
        km:
          origin && station.latitude !== null
            ? distanceKm(origin.latitude, origin.longitude, station.latitude, station.longitude)
            : null,
      }))
      .sort(
        (a, b) =>
          Number(b.active) - Number(a.active) ||
          (a.km !== null && b.km !== null ? a.km - b.km : 0) ||
          (b.station.lastDay ?? '').localeCompare(a.station.lastDay ?? ''),
      )
      .slice(0, MAX_RESULTS);
    logger.info(`Station search: ${listed.length} station(s) found`);
    if (listed.length === 0) {
      return render(SEARCH, 'none');
    }
    return Object.fromEntries(
      Object.keys(SEARCH).map((language) => {
        const texts = SEARCH[language];
        const lines = listed.map(({ station, km }) => {
          const parts = [`${station.id} — ${stationName(station)}`];
          if (km !== null) {
            parts.push(`${formatNumber(km, language, 1)} km`);
          }
          if (station.firstDay) {
            parts.push(texts.since({ year: station.firstDay.slice(0, 4) }));
          }
          if (station.lastDay) {
            parts.push(texts.last({ date: formatDay(station.lastDay, language) }));
          }
          return parts.join(', ');
        });
        return [language, `${texts.found({ count: listed.length })}\n${lines.join('\n')}`];
      }),
    );
  } catch (err) {
    logger.warn(`Station search failed: ${err.message}`);
    return render(SEARCH, 'unavailable');
  }
}
