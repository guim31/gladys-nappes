// -----------------------------------------------------------------------------
// One Gladys device per groundwater station (piezometer of the ADES network).
//
// Features (couples checked against the Gladys front, see
// test/gladys-rules.test.js):
//   - depth             level-sensor/liquid-depth in metres: depth of the water
//                       table below the ground (negative for an artesian well);
//   - level             level-sensor/liquid-depth in metres: altitude of the
//                       water table (m NGF, the French levelling datum);
//   - situation_index   counter-sensor/integer, 1 (very low) to 5 (very high),
//                       for scene conditions ("index ≤ 2");
//   - situation         text/text, the same in words, or why it is unknown;
//   - last_measurement  text/text, the date of the newest measurement.
//
// Published with should_poll: false: the refresh runs in the container every
// 6 hours (src/monitor.js). The platform id is the new BSS code of the station
// (BSS002FVWC): letters and digits only, stable for the life of the station.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'station';
export const FEATURE_KEYS = {
  DEPTH: 'depth',
  LEVEL: 'level',
  SITUATION_INDEX: 'situation_index',
  SITUATION: 'situation',
  LAST_MEASUREMENT: 'last_measurement',
};

// Display bounds of the charts. Depths go from artesian wells (water above the
// ground) to deep confined aquifers; levels from below the sea to the Alps.
export const DEPTH_BOUNDS_M = [-50, 300];
export const LEVEL_BOUNDS_M = [-100, 3000];

// Feature names, frozen at creation in Gladys (language of the configuration).
export const NAMES = {
  en: {
    depth: 'Groundwater depth',
    level: 'Groundwater level (m NGF)',
    situation_index: 'Situation index (1 to 5)',
    situation: 'Groundwater situation',
    last_measurement: 'Last measurement',
  },
  fr: {
    depth: 'Profondeur de la nappe',
    level: 'Niveau de la nappe (m NGF)',
    situation_index: 'Indice de situation (1 à 5)',
    situation: 'Situation de la nappe',
    last_measurement: 'Dernière mesure',
  },
  de: {
    depth: 'Grundwassertiefe',
    level: 'Grundwasserstand (m NGF)',
    situation_index: 'Lageindex (1 bis 5)',
    situation: 'Grundwasserlage',
    last_measurement: 'Letzte Messung',
  },
  es: {
    depth: 'Profundidad del acuífero',
    level: 'Nivel del acuífero (m NGF)',
    situation_index: 'Índice de situación (1 a 5)',
    situation: 'Situación del acuífero',
    last_measurement: 'Última medición',
  },
};

/** External ids of a station device and of its features. */
export function stationIds(gladys, id) {
  const ids = gladys.externalIds(DEVICE_TYPE, id);
  return {
    device: ids.device,
    depth: ids.feature(FEATURE_KEYS.DEPTH),
    level: ids.feature(FEATURE_KEYS.LEVEL),
    situationIndex: ids.feature(FEATURE_KEYS.SITUATION_INDEX),
    situation: ids.feature(FEATURE_KEYS.SITUATION),
    lastMeasurement: ids.feature(FEATURE_KEYS.LAST_MEASUREMENT),
  };
}

/** The station id of a device or feature external id (null if not ours). */
export function stationIdOf(gladys, externalId) {
  const prefix = gladys.externalIds(DEVICE_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  return externalId.slice(prefix.length).split(':')[0] || null;
}

/** "Toulouse – LOMBEZ", or the old code when the station has no label. */
export function stationName(station) {
  const what = station.label ?? station.code ?? station.id;
  return station.commune ? `${station.commune} – ${what}` : what;
}

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

/**
 * The discovery payload of a station.
 * @param {object} gladys
 * @param {object} station see src/hubeau.js parseStation
 * @param {string} language language of the feature names
 */
export function buildDevice(gladys, station, language = 'fr') {
  const ids = stationIds(gladys, station.id);
  const names = NAMES[language] ?? NAMES.fr;
  const LEVEL = DEVICE_FEATURE_CATEGORIES.LEVEL_SENSOR;
  const TEXT = DEVICE_FEATURE_CATEGORIES.TEXT;
  const params = [
    { name: 'BSS_ID', value: station.id },
    { name: 'BSS_CODE', value: station.code ?? station.id },
  ];
  if (station.aquifer) {
    params.push({ name: 'AQUIFER', value: station.aquifer.slice(0, 200) });
  }
  return {
    name: stationName(station),
    external_id: ids.device,
    model: 'Piezometer (ADES)',
    should_poll: false,
    params,
    features: [
      sensor(names.depth, ids.depth, LEVEL, TYPES.LEVEL_SENSOR.LIQUID_DEPTH, {
        unit: DEVICE_FEATURE_UNITS.M,
        keep_history: true,
        min: DEPTH_BOUNDS_M[0],
        max: DEPTH_BOUNDS_M[1],
      }),
      sensor(names.level, ids.level, LEVEL, TYPES.LEVEL_SENSOR.LIQUID_DEPTH, {
        unit: DEVICE_FEATURE_UNITS.M,
        keep_history: true,
        min: LEVEL_BOUNDS_M[0],
        max: LEVEL_BOUNDS_M[1],
      }),
      sensor(
        names.situation_index,
        ids.situationIndex,
        DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
        TYPES.SENSOR.INTEGER,
        { keep_history: true, min: 1, max: 5 },
      ),
      sensor(names.situation, ids.situation, TEXT, TYPES.TEXT.TEXT, {
        keep_history: false,
        min: 0,
        max: 0,
      }),
      sensor(names.last_measurement, ids.lastMeasurement, TEXT, TYPES.TEXT.TEXT, {
        keep_history: false,
        min: 0,
        max: 0,
      }),
    ],
  };
}
