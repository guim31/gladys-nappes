// -----------------------------------------------------------------------------
// Texts sent from the container (feature values, connection status, action
// messages, scene variables), in the four languages of the Gladys interface.
// Entries are strings or functions of one parameter object. German says "du",
// Spanish "usted".
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { LANGUAGES } from './config.js';

/** Widget colour of each situation (closed palette of the widgets). */
export const SITUATION_COLORS = {
  very_low: WIDGET_COLORS.DANGER,
  low: WIDGET_COLORS.WARNING,
  normal: WIDGET_COLORS.SUCCESS,
  high: WIDGET_COLORS.INFO,
  very_high: WIDGET_COLORS.INFO,
};

export const SITUATION_NAMES = {
  en: { very_low: 'Very low', low: 'Low', normal: 'Normal', high: 'High', very_high: 'Very high' },
  fr: { very_low: 'Très bas', low: 'Bas', normal: 'Normal', high: 'Haut', very_high: 'Très haut' },
  de: {
    very_low: 'Sehr niedrig',
    low: 'Niedrig',
    normal: 'Normal',
    high: 'Hoch',
    very_high: 'Sehr hoch',
  },
  es: { very_low: 'Muy bajo', low: 'Bajo', normal: 'Normal', high: 'Alto', very_high: 'Muy alto' },
};

// Value of the "Situation" feature when there is none.
export const NO_SITUATION = {
  en: {
    history: 'Unknown: under 10 years of history',
    stale: 'Unknown: no recent measurement',
  },
  fr: {
    history: "Inconnue : moins de 10 ans d'historique",
    stale: 'Inconnue : pas de mesure récente',
  },
  de: {
    history: 'Unbekannt: unter 10 Jahren Verlauf',
    stale: 'Unbekannt: keine aktuelle Messung',
  },
  es: {
    history: 'Desconocida: menos de 10 años de historial',
    stale: 'Desconocida: sin medición reciente',
  },
};

export const TREND_NAMES = {
  en: { rising: 'rising', steady: 'steady', falling: 'falling' },
  fr: { rising: 'monte', steady: 'stable', falling: 'baisse' },
  de: { rising: 'steigt', steady: 'stabil', falling: 'fällt' },
  es: { rising: 'sube', steady: 'estable', falling: 'baja' },
};

// Connection status of the Configuration screen.
export const STATUS = {
  en: {
    initFailed: 'Initialization failed, check the integration logs.',
    hubeauDown: "Hub'Eau does not answer: the measurements will come back with it.",
    unknown: ({ codes }) => `Unknown station code: ${codes}.`,
    invalid: ({ values }) => `Ignored (not a station code): ${values}.`,
    noHouse: 'Around my house: give your house a location in Gladys (Settings, Houses).',
    noHomeStation: 'Around my house: no station measuring within this distance.',
    tooMany: ({ max }) => `Only the first ${max} stations are followed.`,
    none: 'No station yet: fill in the configuration, or use "Find stations".',
  },
  fr: {
    initFailed: "L'initialisation a échoué, consultez les logs de l'intégration.",
    hubeauDown: "Hub'Eau ne répond pas : les mesures reviendront avec lui.",
    unknown: ({ codes }) => `Code de station inconnu : ${codes}.`,
    invalid: ({ values }) => `Ignoré (pas un code de station) : ${values}.`,
    noHouse:
      'Autour de ma maison : indiquez la position de votre maison dans Gladys (Paramètres, Maisons).',
    noHomeStation: 'Autour de ma maison : aucune station en service à cette distance.',
    tooMany: ({ max }) => `Seules les ${max} premières stations sont suivies.`,
    none: 'Aucune station : remplissez la configuration, ou utilisez « Chercher des stations ».',
  },
  de: {
    initFailed: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    hubeauDown: "Hub'Eau antwortet nicht: Die Messwerte kommen mit ihm zurück.",
    unknown: ({ codes }) => `Unbekannter Stationscode: ${codes}.`,
    invalid: ({ values }) => `Ignoriert (kein Stationscode): ${values}.`,
    noHouse: 'Rund um mein Haus: Gib deinem Haus in Gladys einen Standort (Einstellungen, Häuser).',
    noHomeStation: 'Rund um mein Haus: keine messende Station in dieser Entfernung.',
    tooMany: ({ max }) => `Nur die ersten ${max} Stationen werden verfolgt.`,
    none: 'Noch keine Station: Fülle die Konfiguration aus oder nutze „Stationen suchen“.',
  },
  es: {
    initFailed: 'La inicialización ha fallado, consulte los registros de la integración.',
    hubeauDown: "Hub'Eau no responde: las mediciones volverán con él.",
    unknown: ({ codes }) => `Código de estación desconocido: ${codes}.`,
    invalid: ({ values }) => `Ignorado (no es un código de estación): ${values}.`,
    noHouse: 'Alrededor de mi casa: indique la ubicación de su casa en Gladys (Ajustes, Casas).',
    noHomeStation: 'Alrededor de mi casa: ninguna estación en servicio a esta distancia.',
    tooMany: ({ max }) => `Solo se siguen las ${max} primeras estaciones.`,
    none: 'Aún no hay estaciones: rellene la configuración o use «Buscar estaciones».',
  },
};

// Messages of the "Find stations" action.
export const SEARCH = {
  en: {
    noHouse:
      'Your house has no location in Gladys: type a commune code (31555), a department (31) or a station code.',
    invalid:
      'Not understood: leave empty (around your house), or type a commune code (31555), a department (31) or a station code.',
    none: 'No station found.',
    found: ({ count }) =>
      `${count} station(s), nearest first. Copy the codes into "Station codes", then save:`,
    unavailable: "Hub'Eau does not answer, try again in a few minutes.",
    since: ({ year }) => `since ${year}`,
    last: ({ date }) => `last measurement ${date}`,
  },
  fr: {
    noHouse:
      "Votre maison n'a pas de position dans Gladys : tapez un code de commune (31555), un département (31) ou un code de station.",
    invalid:
      'Non compris : laissez vide (autour de votre maison), ou tapez un code de commune (31555), un département (31) ou un code de station.',
    none: 'Aucune station trouvée.',
    found: ({ count }) =>
      `${count} station(s), les plus proches d'abord. Copiez les codes dans « Codes des stations », puis enregistrez :`,
    unavailable: "Hub'Eau ne répond pas, réessayez dans quelques minutes.",
    since: ({ year }) => `depuis ${year}`,
    last: ({ date }) => `dernière mesure le ${date}`,
  },
  de: {
    noHouse:
      'Dein Haus hat in Gladys keinen Standort: Gib einen Gemeindecode (31555), ein Département (31) oder einen Stationscode ein.',
    invalid:
      'Nicht verstanden: Leer lassen (rund um dein Haus) oder einen Gemeindecode (31555), ein Département (31) oder einen Stationscode eingeben.',
    none: 'Keine Station gefunden.',
    found: ({ count }) =>
      `${count} Station(en), die nächsten zuerst. Kopiere die Codes in „Stationscodes“ und speichere:`,
    unavailable: "Hub'Eau antwortet nicht, versuche es in ein paar Minuten erneut.",
    since: ({ year }) => `seit ${year}`,
    last: ({ date }) => `letzte Messung am ${date}`,
  },
  es: {
    noHouse:
      'Su casa no tiene ubicación en Gladys: escriba un código de municipio (31555), un departamento (31) o un código de estación.',
    invalid:
      'No se ha entendido: déjelo vacío (alrededor de su casa) o escriba un código de municipio (31555), un departamento (31) o un código de estación.',
    none: 'No se ha encontrado ninguna estación.',
    found: ({ count }) =>
      `${count} estación(es), las más cercanas primero. Copie los códigos en «Códigos de estación» y guarde:`,
    unavailable: "Hub'Eau no responde, inténtelo de nuevo en unos minutos.",
    since: ({ year }) => `desde ${year}`,
    last: ({ date }) => `última medición el ${date}`,
  },
};

/** One entry of a message table, in every language: `{ en, fr, de, es }`. */
export function render(table, key, params = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => {
      const entry = table[language][key];
      return [language, typeof entry === 'function' ? entry(params) : entry];
    }),
  );
}

/** Several multi-language texts joined, language by language. */
export function join(...messages) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      messages
        .filter(Boolean)
        .map((message) => message[language])
        .join(' '),
    ]),
  );
}

const locale = (language) => (language === 'en' ? 'en-GB' : language);

/** A day 'YYYY-MM-DD' in the user's language, e.g. "19/10/2026". */
export function formatDay(day, language) {
  return new Intl.DateTimeFormat(locale(language), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

/** A time in the user's time zone (TZ, set by the Gladys supervisor), e.g. "17/10/2026 05:00". */
export function formatTime(time, language) {
  return new Intl.DateTimeFormat(locale(language), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(time));
}

/** The date of a measurement (see src/situation.js latestOf). */
export const formatMeasurement = (latest, language) =>
  latest.daily ? formatDay(latest.day, language) : formatTime(latest.at, language);

/** A number in the user's language, e.g. "5,06" in French. */
export function formatNumber(value, language, digits = 2) {
  return new Intl.NumberFormat(locale(language), { maximumFractionDigits: digits }).format(value);
}
