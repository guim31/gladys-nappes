# Nappes phréatiques (groundwater) for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that brings the
**groundwater level near your home** into Gladys: depth and level of the water table measured by
the public piezometers of the French ADES network (BRGM), read through the open
[Hub'Eau Piézométrie](https://hubeau.eaufrance.fr/page/api-piezometrie) API, and a **situation**
(very low to very high) estimated from the history of each station. Public open data, no account,
no key.

> **The situation is an estimate of this integration, not the official indicator of the BRGM**
> (the monthly IPS of the groundwater bulletins). Not affiliated with the BRGM nor with Hub'Eau.

## Features

- **One device per station**: depth of the water table (m), its level (m NGF), a situation index
  from 1 (very low) to 5 (very high), the situation in words, and the date of the last
  measurement (daily values, or hourly real-time ones for the stations that send them).
- **Stations by code (new `BSS002FVWC` or old `09838D0727/F`) or around your house** (the 3
  nearest stations in service, from the location of your house in Gladys).
- **"Find stations"** in the Configuration screen: around your house, in a commune, a department
  or by code, with distance, first year and last measurement.
- **Scene triggers**: _Groundwater situation changes_ (filtered by station and new situation) and
  _Station without measurement_ (7, 15, 30 or 60 days).
- **Dashboard widget**: the followed stations with their depth, situation and weekly trend, or the
  detail of one station with live tiles and a link to its ADES page.
- Texts in English, French, German and Spanish.

Complementary integrations: [Vigicrues](https://github.com/guim31/gladys-vigicrues) (rivers and
flood vigilance), [Eau](https://github.com/guim31/gladys-eau) (your water consumption), and the
[VigiEau](https://github.com/prohand/gladys-vigieau) integration by prohand (official water
restrictions).

## Requirements

- Gladys Assistant **5.1.0** or later (widget and scene triggers).
- Internet access from Gladys to `hubeau.eaufrance.fr`.
- For "around my house": the location of your house in Gladys. The integration declares
  `location: true`, shown on the install screen.
- France only (mainland and overseas departments).

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-nappes` (or install it from the catalog once it is listed).
2. In **Configuration**, press **Find stations**, copy the codes you want into **Station codes**
   (or choose **Around my house**), then save.
3. Open the **Discover** tab and press **Add to Gladys** on the stations you want.

The user guide is in [`docs/en.md`](docs/en.md) ([français](docs/fr.md), [Deutsch](docs/de.md),
[español](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

```
Integration container ──HTTPS──▶ hubeau.eaufrance.fr   stations, daily and real-time measurements
      │ SDK (WebSocket + host API)
      ▼
Gladys core ── devices, states, scene events, widget
```

- Devices are published with `should_poll: false`: the integration refreshes itself every 6
  hours (groundwater moves slowly and the data are daily). The whole daily history of a station
  (up to 20,000 values, about 1 MB) is read once and kept in `/data/nappes.json`, then each
  cycle asks only the last week and the newest real-time value; the history is read again every
  90 days.
- The situation: the mean level of the last 10 days is ranked among the means of the same 31
  days of every previous year (10 years at least). Under 10 %: very low; under 30 %: low; up to
  70 %: normal; up to 90 %: high; above: very high.
- Only the changes are published, plus a heartbeat every 12 hours. Depth and level stop 45 days
  after the last measurement; the "Last measurement" feature says when it was.
- `/data/nappes.json` never holds the house coordinates.

## Limitations

- **An estimate, not the official BRGM indicator**; a confined or exploited aquifer can stay
  "very low" for years.
- Tested against the **real answers** of Hub'Eau (stations around Toulouse, recorded on
  20/10/2026) and against the live API, not on a live Gladys: feedback welcome.
- Public piezometers only, about a dozen in service per department.
- 10 stations at most from the configuration (plus the ones whose device you created).

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test, against the SDK's fake Gladys and recorded API answers
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store --skip-image-check .   # store validator
```

Versions are bumped by the **Release** workflow (Actions → Release), never by hand.

## Credits

- Data: **Hub'Eau** (OFB, BRGM) and **ADES** (BRGM and its partners), under the
  [Licence Ouverte / Open Licence Etalab 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/).
- No Home Assistant integration served as a base.

Not affiliated with the BRGM, the OFB nor Hub'Eau. Their names and logos are not used.

## License

Apache-2.0, see [LICENSE](LICENSE).
