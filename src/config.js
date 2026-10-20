// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Kilometres around the house where the nearest stations are followed; '0' = off.
// Active piezometers are sparse (a dozen in Haute-Garonne): up to 50 km.
export const HOME_RADII = ['0', '10', '20', '30', '50'];

// Stations followed "around my house": the nearest ones still measuring.
export const HOME_STATIONS = 3;

// Upper bound of the stations taken from the configuration (codes and house
// together): each costs two small Hub'Eau requests every 6 hours.
export const MAX_STATIONS = 10;

export const DEFAULT_CONFIG = {
  stations: '',
  around_home: '0',
  language: 'fr',
};

// The two codes of a groundwater station (BSS, the national register of the
// BRGM): the new one, "BSS" and 7 letters or digits (BSS002FVWC), and the old
// one, 10 characters, a slash and a designation (09838D0727/F). Both name the
// same station in Hub'Eau; the new one is the stable id of the devices.
const BSS_ID = /^BSS[0-9A-Z]{7}$/;
const OLD_CODE = /^\d{5}[A-Z]\d{4}\/[0-9A-Z.()_+-]{1,20}$/;

export const isBssId = (token) => BSS_ID.test(String(token).toUpperCase());
export const isOldCode = (token) => OLD_CODE.test(String(token).toUpperCase());

/** A station code (new or old format), upper-cased; null otherwise. */
export function stationCodeOf(token) {
  const code = String(token ?? '')
    .trim()
    .toUpperCase();
  return isBssId(code) || isOldCode(code) ? code : null;
}

/** Station codes of a free text; `invalid` lists the tokens that are not one. */
export function parseStationCodes(text) {
  const codes = [];
  const invalid = [];
  for (const token of String(text ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean)) {
    const code = stationCodeOf(token);
    if (code === null) {
      invalid.push(token);
    } else if (!codes.includes(code)) {
      codes.push(code);
    }
  }
  return { codes, invalid };
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const stations = parseStationCodes(source.stations);
  return {
    stationCodes: stations.codes,
    invalid: stations.invalid,
    homeRadiusKm: HOME_RADII.includes(String(source.around_home))
      ? Number(source.around_home)
      : Number(DEFAULT_CONFIG.around_home),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
