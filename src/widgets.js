// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `stations`.
//
// Without setting, one status line per followed station (10 at most): the depth
// of the water table and its situation, coloured by the situation (very low in
// red, low in yellow, normal in green, high and very high in blue), the icon
// giving the trend of the last week.
//
// With a station chosen in the settings: its live depth and level tiles (bound
// to the device features), then its situation, trend and last measurement.
//
// Both end with the source (the Licence Ouverte asks for it) and a link to
// ADES, the national groundwater portal. Budget: 1 text, 1 status, 2 tiles,
// 1 button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { stationIdOf, stationIds } from './devices.js';
import {
  NO_SITUATION,
  SITUATION_COLORS,
  SITUATION_NAMES,
  TREND_NAMES,
  formatMeasurement,
  formatNumber,
} from './messages.js';
import { WIDGET_KEY } from './monitor.js';

export const MAX_STATUS_ITEMS = 10;
export const TTL_SECONDS = 1800;
const MAX_STATUS_TEXT = 40;
export const ADES_SITE = 'https://ades.eaufrance.fr';
export const adesPage = (code) => `${ADES_SITE}/Fiche/PtEau?Code=${code}`;

export const TEXT = {
  empty: {
    en: 'No station yet: fill in the configuration of the Nappes phréatiques integration, then create the devices in the Discover tab.',
    fr: "Aucune station pour l'instant : remplissez la configuration de l'intégration Nappes phréatiques, puis créez les appareils dans l'onglet Découverte.",
    de: 'Noch keine Station: Fülle die Konfiguration der Integration Nappes phréatiques aus und lege dann die Geräte im Tab „Entdecken“ an.',
    es: 'Aún no hay estaciones: rellene la configuración de la integración Nappes phréatiques y, después, cree los dispositivos en la pestaña Descubrir.',
  },
  gone: {
    en: 'This station is no longer followed.',
    fr: "Cette station n'est plus suivie.",
    de: 'Diese Station wird nicht mehr verfolgt.',
    es: 'Esta estación ya no se sigue.',
  },
  depth: { en: 'Depth', fr: 'Profondeur', de: 'Tiefe', es: 'Profundidad' },
  level: { en: 'Level (m NGF)', fr: 'Niveau (m NGF)', de: 'Stand (m NGF)', es: 'Nivel (m NGF)' },
  situation: { en: 'Situation', fr: 'Situation', de: 'Lage', es: 'Situación' },
  trend: {
    en: 'Trend (7 days)',
    fr: 'Tendance (7 j)',
    de: 'Tendenz (7 T.)',
    es: 'Tendencia (7 d)',
  },
  lastMeasurement: {
    en: 'Last measurement',
    fr: 'Dernière mesure',
    de: 'Letzte Messung',
    es: 'Última medición',
  },
  silent: {
    en: 'Silent since ',
    fr: 'Muette depuis le ',
    de: 'Still seit ',
    es: 'Sin datos desde el ',
  },
  waiting: { en: 'Waiting', fr: 'En attente', de: 'Wartet', es: 'En espera' },
  unknown: { en: 'Unknown', fr: 'Inconnue', de: 'Unbekannt', es: 'Desconocida' },
  source: {
    en: "Source: Hub'Eau, ADES (BRGM)",
    fr: "Source : Hub'Eau, ADES (BRGM)",
    de: "Quelle: Hub'Eau, ADES (BRGM)",
    es: "Fuente: Hub'Eau, ADES (BRGM)",
  },
  site: { en: 'ADES', fr: 'ADES', de: 'ADES', es: 'ADES' },
};

const t = (text, language) => text[language] ?? text.en;
const clip = (text, max = MAX_STATUS_TEXT) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

const TREND_ICONS = { rising: 'trending-up', falling: 'trending-down', steady: 'minus' };

const colorOf = (view) =>
  view.fresh && view.situation.key ? SITUATION_COLORS[view.situation.key] : WIDGET_COLORS.NEUTRAL;

/** The status value of a station, e.g. "5,06 m · Normal" (40 characters at most). */
export function stationValue(view, language) {
  if (!view.latest) {
    return t(TEXT.waiting, language);
  }
  if (!view.fresh || (view.depth === null && view.level === null)) {
    return clip(`${t(TEXT.silent, language)}${formatMeasurement(view.latest, language)}`);
  }
  // A station without depth gives its level (m NGF) instead.
  const depth =
    view.depth === null
      ? `${formatNumber(view.level, language)} m NGF`
      : `${formatNumber(view.depth, language)} m`;
  return clip(
    view.situation.key ? `${depth} · ${SITUATION_NAMES[language][view.situation.key]}` : depth,
  );
}

function situationText(view, language) {
  if (view.situation.key) {
    return SITUATION_NAMES[language][view.situation.key];
  }
  const reason = view.situation.reason;
  return clip(NO_SITUATION[language][reason] ?? t(TEXT.unknown, language));
}

function footer(views, language, link) {
  const times = views.map((view) => view.latest).filter(Boolean);
  const newest = times.reduce((a, b) => (b.at > (a?.at ?? -Infinity) ? b : a), null);
  const source = t(TEXT.source, language);
  return [
    {
      type: 'text',
      variant: 'caption',
      text: newest ? `${source} · ${formatMeasurement(newest, language)}` : source,
    },
    { type: 'button', label: t(TEXT.site, language), icon: 'external-link', link: { url: link } },
  ];
}

function overview(monitor, ids, language) {
  const views = ids.slice(0, MAX_STATUS_ITEMS).map((id) => monitor.view(id));
  return [
    {
      type: 'status',
      items: views.map((view) => ({
        label: clip(view.name),
        value: stationValue(view, language),
        color: colorOf(view),
        icon: view.trend ? TREND_ICONS[view.trend] : 'clock',
      })),
    },
    ...footer(views, language, ADES_SITE),
  ];
}

function detail(monitor, id, language) {
  const view = monitor.view(id);
  const ids = stationIds(monitor.gladys, id);
  return [
    { type: 'value', label: t(TEXT.depth, language), device_feature: ids.depth },
    { type: 'value', label: t(TEXT.level, language), device_feature: ids.level },
    {
      type: 'status',
      items: [
        {
          label: t(TEXT.situation, language),
          value: situationText(view, language),
          color: colorOf(view),
        },
        {
          label: t(TEXT.trend, language),
          value: view.trend ? TREND_NAMES[language][view.trend] : t(TEXT.unknown, language),
          icon: view.trend ? TREND_ICONS[view.trend] : 'minus',
          color: WIDGET_COLORS.NEUTRAL,
        },
        {
          label: t(TEXT.lastMeasurement, language),
          value: view.latest ? formatMeasurement(view.latest, language) : t(TEXT.waiting, language),
          color: view.fresh ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
          icon: 'clock',
        },
      ],
    },
    ...footer([view], language, adesPage(view.code)),
  ];
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(monitor, { settings, language = 'en' }) {
      const lang = SITUATION_NAMES[language] ? language : 'en';
      const created = monitor.created();
      const chosen = typeof settings?.station === 'string' ? settings.station : null;
      if (chosen) {
        const id = stationIdOf(monitor.gladys, chosen);
        const components =
          id && created.includes(id)
            ? detail(monitor, id, lang)
            : [{ type: 'text', variant: 'body', text: t(TEXT.gone, lang) }];
        return { ttl_seconds: TTL_SECONDS, components };
      }
      if (created.length === 0) {
        return {
          ttl_seconds: TTL_SECONDS,
          components: [{ type: 'text', variant: 'body', text: t(TEXT.empty, lang) }],
        };
      }
      return { ttl_seconds: TTL_SECONDS, components: overview(monitor, created, lang) };
    },
  },
};
