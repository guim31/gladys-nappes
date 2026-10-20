# Test fixtures

## `gladys-feature-table.json`

The category/type couples, units and poll frequencies the Gladys core (5.2.x) knows, extracted
from its code. Used by `test/gladys-rules.test.js`.

## `hubeau/`: recorded answers of Hub'Eau Piézométrie

Real answers of `https://hubeau.eaufrance.fr/api/v1/niveaux_nappes`, recorded on 20/10/2026
between 12:46 and 12:51 UTC for five stations around Toulouse. Public data under the Licence
Ouverte / Open Licence Etalab 2.0 (Hub'Eau, ADES/BRGM): nothing to anonymize. Kept compact
(Prettier leaves the folder alone, `.prettierignore`).

| File                            | Request                                                                                                        | Trimmed                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `stations.json`                 | `stations?bbox=1.2,43.45,1.7,43.75&date_recherche=2026-09-01&size=50&format=json`                              | verbatim                                                                        |
| `chroniques-<code>.json` (4)    | `chroniques?code_bss=<code>&size=20000&fields=code_bss,date_mesure,niveau_nappe_eau,profondeur_nappe&sort=asc` | the days of September to November of every year, and every day since 01/08/2026 |
| `chroniques_tr-<code>.json` (4) | `chroniques_tr?code_bss=<code>&size=30&sort=desc`                                                              | verbatim                                                                        |

The stations (old code, new code):

- `09838D0727/F`, `BSS002FVWC`, Toulouse (LOMBEZ), Garonne alluvium, daily since 1997 and real
  time; its daily values run two days past its real-time ones (19/10 against 17/10 03:00 UTC).
- `09845C1426/F`, `BSS002GCNV`, Toulouse (UPS), molasse, daily since 1996.
- `10092X0166/F`, `BSS002HSFG`, Lamasquère, silent since 08/09/2026.
- `10098A0004/F`, `BSS002HVPP`, Eaunes (MURET 104), deep confined Eocene aquifer, falling for
  years: "very low".
- `09833C0249/F`, `BSS002FPUU`, Daux: in `stations.json` only, so the fake serves it no history.

The fake Hub'Eau of `test/helpers/world.js` filters them the way the real API does (`bss_id`,
`code_bss`, `code_commune`, `code_departement`, `bbox`, `date_recherche`, `date_debut_mesure`,
`sort`, `size`; a page larger than 20,000 rows answers 503 like the real one).
