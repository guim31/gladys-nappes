# Nappes phréatiques (Grundwasser)

Der **Grundwasserstand in deiner Nähe**, nach den öffentlichen Messstellen (Piezometern) des
französischen ADES-Netzes (BRGM), gelesen über die offene API
[Hub'Eau Piézométrie](https://hubeau.eaufrance.fr/page/api-piezometrie). Ohne Konto, ohne Schlüssel.

Jede Station (ein Piezometer, ein Brunnen, in dem das Grundwasser gemessen wird) wird zu einem
Gladys-Gerät: die Tiefe des Grundwassers, sein Stand, das Datum der letzten Messung und eine **Lage**
(sehr niedrig bis sehr hoch), die diese Integration aus dem Verlauf der Station schätzt.

> Die Lage ist eine Schätzung dieser Integration, **nicht der offizielle Indikator des BRGM** (der
> monatliche „IPS“ der Grundwasserberichte). Nicht mit dem BRGM oder Hub'Eau verbunden.

## Was du bekommst

- **Ein Gerät pro Station**: Tiefe des Grundwassers unter der Oberfläche (m), sein Stand (m NGF, das
  französische Höhensystem), ein Lageindex von 1 (sehr niedrig) bis 5 (sehr hoch), die Lage in
  Worten und das Datum der letzten Messung.
- **Stationen per Code oder rund um dein Haus** (die 3 nächsten, die noch messen, nach dem Standort
  deines Hauses in Gladys).
- **„Stationen suchen“** im Konfigurationsbildschirm: die Stationen rund um dein Haus, in einer
  Gemeinde oder einem Département, mit Entfernung, erstem Jahr und letzter Messung.
- **Szenen-Auslöser**: _Grundwasserlage ändert sich_ (gefiltert nach Station und neuer Lage) und
  _Station ohne Messung_ (7, 15, 30 oder 60 Tage).
- **Dashboard-Widget**: die verfolgten Stationen mit Tiefe, Lage und Tendenz der Woche, oder die
  Details einer Station.

Nachbarn: [Vigicrues](https://github.com/guim31/gladys-vigicrues) liefert die Flüsse (Wasserstand,
Abfluss, Hochwasserwarnung), die Integration [VigiEau](https://github.com/prohand/gladys-vigieau) die offiziellen Wassereinschränkungen deiner
Gemeinde: Beide ergänzen diese hier.

## Voraussetzungen

- Gladys Assistant 5.1.0 oder neuer (Widget und Szenen-Auslöser).
- Internetzugang von Gladys zu `hubeau.eaufrance.fr`.
- Für „Rund um mein Haus“: ein Standort für dein Haus in Gladys (Einstellungen, Häuser).
- Nur Frankreich (Festland und Überseedépartements, das ADES-Netz).

## Konfiguration

### Einstellungen

| Einstellung                | Wirkung                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------- |
| Stationscodes              | BSS-Codes durch Kommas getrennt, neu (`BSS002FVWC`) oder alt (`09838D0727/F`).          |
| Rund um mein Haus          | Verfolge auch die 3 nächsten Stationen in Betrieb im Umkreis von 10, 20, 30 oder 50 km. |
| Sprache der Funktionsnamen | Namen der Funktionen neuer Geräte und Sprache der Texte (Lage, letzte Messung).         |

Speichere, öffne dann den Tab **Entdecken** und lege die gewünschten Geräte an. Eine Station, deren
Gerät du angelegt hast, bleibt verfolgt, auch wenn du sie aus der Konfiguration entfernst; das Löschen
des Geräts beendet es. Über die Konfiguration werden höchstens 10 Stationen verfolgt.

### Deine Stationen finden

Die Aktion **Stationen suchen** im Konfigurationsbildschirm listet die Stationen mit ihrem Code, ihrer
Entfernung zu deinem Haus, dem Jahr ihrer ersten Messung und dem Datum der letzten auf:

- lass **Wo** leer: die Stationen in Betrieb rund um dein Haus (20 km oder die gewählte Entfernung);
- ein INSEE-Gemeindecode (`31555` für Toulouse): alle Stationen der Gemeinde, die in Betrieb zuerst;
- eine Département-Nummer (`31`, `2A`, `974`): die Stationen in Betrieb dort;
- ein Stationscode, neu oder alt.

Kopiere den Code (`BSS…`) in **Stationscodes** und speichere. Messende Piezometer sind selten (etwa
ein Dutzend in Haute-Garonne): Nimm am besten eine Station auf demselben Grundwasserleiter wie dein
Brunnen oder dein Garten, angegeben in den Geräteparametern (`AQUIFER`). Das
[ADES-Portal](https://ades.eaufrance.fr) zeigt sie auf einer Karte.

## Geräte

| Funktion                 | Typ                  | Inhalt                                                                    |
| ------------------------ | -------------------- | ------------------------------------------------------------------------- |
| Grundwassertiefe         | Flüssigkeitstiefe, m | Tiefe des Grundwassers unter der Oberfläche (negativ: darüber, artesisch) |
| Grundwasserstand (m NGF) | Flüssigkeitstiefe, m | Höhe des Grundwasserspiegels                                              |
| Lageindex (1 bis 5)      | Zähler               | 1 sehr niedrig, 2 niedrig, 3 normal, 4 hoch, 5 sehr hoch                  |
| Grundwasserlage          | Text                 | Die Lage in Worten, oder warum sie unbekannt ist                          |
| Letzte Messung           | Text                 | Datum der neuesten Messung (mit Uhrzeit bei Echtzeitwerten)               |

Tiefe und Stand werden 45 Tage nach der letzten Messung nicht mehr veröffentlicht; „Letzte Messung“
sagt immer, wann sie war. Eine Station, die einmal im Monat von Hand abgelesen wird, ist normal.
Wird die Lage unbekannt, behält der Index seinen letzten Wert: Eine Szenenbedingung auf den Index
sollte auch prüfen, dass „Grundwasserlage“ nicht unbekannt ist.

### Wie die Lage geschätzt wird

Der mittlere Stand der letzten 10 Tage wird unter den mittleren Ständen derselben 31 Tage (dasselbe
Datum ± 15 Tage) aller früheren Jahre der Station eingeordnet. Niedriger als 90 % der Jahre: sehr
niedrig; niedriger als 70 %: niedrig; dazwischen: normal; höher als 70 %: hoch; höher als 90 %: sehr
hoch. Nötig sind mindestens 10 Jahre Verlauf und eine Messung, die jünger als 30 Tage ist; sonst ist
die Lage „unbekannt“, mit dem Grund. Es ist nicht der offizielle Indikator des BRGM, der mit
standardisierten Monatsmitteln arbeitet: Meist stimmen beide überein, aber nicht immer.

## Dashboard-Widget

Füge das Widget **Grundwasser** zu einem Dashboard hinzu:

- ohne Station: eine Zeile pro verfolgter Station mit Tiefe und Lage, gefärbt nach der Lage (rot sehr
  niedrig, gelb niedrig, grün normal, blau hoch und sehr hoch), das Symbol zeigt die Tendenz der Woche
  (steigt, stabil, fällt);
- mit einer Station: ihre Tiefe und ihr Stand live, ihre Lage, Tendenz und letzte Messung, und ein Link
  zu ihrer Seite im ADES-Portal.

## Szenen-Auslöser

**Grundwasserlage ändert sich**: Die geschätzte Lage einer Station ändert sich. Filter: die Station
und die neuen Lagen (sehr niedrig, niedrig, normal, hoch, sehr hoch). Variablen: Name der Station, Lage
(Schlüssel und Worte), vorherige Lage (Schlüssel und Worte), Tiefe, Stand.

**Station ohne Messung**: Eine verfolgte Station hat seit 7, 15, 30 oder 60 Tagen nichts gesendet.
Jede Dauer löst einmal pro Funkstille aus; nach einem langen Stillstand von Gladys nur die längste
überschrittene. Variablen: Name der Station, Tage, Datum der letzten Messung.

Ein Schwellwert für die Tiefe („tiefer als 8 m“) ist eine Szenenbedingung auf den Gerätezustand:
Szenen-Auslöser filtern nur nach Gleichheit.

## Szenenbeispiele

- **Brunnen im Blick**: Wenn die Lage deiner Station auf _niedrig_ oder _sehr niedrig_ wechselt,
  sende „Grundwasser {{situation_name}} bei {{station_name}}: sparsam gießen“.
- **Zurück zur Normalität**: Wenn die Lage auf _normal_ wechselt, sende eine Nachricht und aktiviere
  die Szene zur Gartenbewässerung wieder.
- **Veraltete Daten**: Wenn deine Station seit 30 Tagen still ist, sende eine Erinnerung, mit
  „Stationen suchen“ eine andere zu wählen.
- **Wochenbericht**: Sende jeden Montag die Werte „Grundwasserlage“ und „Grundwassertiefe“.

## Datenquellen, Lizenz und Kontingente

- Daten: [Hub'Eau Piézométrie](https://hubeau.eaufrance.fr/page/api-piezometrie) v1, aus ADES (BRGM
  und Partner), unter der **Licence Ouverte Etalab 2.0**; das Widget nennt Quelle und Datum.
- Anfragen: einmal der gesamte Tagesverlauf einer Station (etwa 1 MB, einige Sekunden), dann alle 6
  Stunden zwei kleine Anfragen pro Station (die Tageswerte der letzten Woche, der neueste
  Echtzeitwert); der Verlauf wird alle 90 Tage neu gelesen. Hub'Eau veröffentlicht kein Kontingent:
  Dieser Rhythmus liegt weit unter jeder vernünftigen Grenze.
- Tageswerte kommen meist am nächsten Tag; Echtzeitwerte stündlich, für die Stationen, die sie senden,
  manchmal mit einigen Tagen Verzögerung.

## Fehlerbehebung

- **„Unbekannter Stationscode“**: Der Code ist nicht in Hub'Eau. Nutze „Stationen suchen“ und kopiere
  den angezeigten Code.
- **„Keine messende Station in dieser Entfernung“**: Wähle eine größere Entfernung oder eine Station
  per Code.
- **„Hub'Eau antwortet nicht“**: Der Dienst ist gestört oder langsam; die Werte kommen von selbst
  zurück.
- **Lage „unbekannt: unter 10 Jahren Verlauf“**: Die Station ist zu neu für eine Schätzung. Tiefe und
  Stand werden weiter veröffentlicht.
- **Lage „unbekannt: keine aktuelle Messung“**: Die Station hat seit 30 Tagen nichts gesendet.
- **„Kein aktueller Wert“ bei der Tiefe**: Die letzte Messung ist älter als 45 Tage; siehe „Letzte
  Messung“.
- Protokolle: `LOG_LEVEL=debug` zeigt jeden Aktualisierungszyklus.

## Grenzen

- Nur Frankreich (ADES-Netz) und nur die öffentlichen Piezometer: nicht dein eigener Brunnen.
- Die Lage ist eine Schätzung, nicht der offizielle Indikator des BRGM; ein gespannter oder genutzter
  Grundwasserleiter kann jahrelang „sehr niedrig“ bleiben.
- Aktualisierung alle 6 Stunden: Grundwasser bewegt sich langsam und die Daten sind täglich.
- Höchstens 10 Stationen über die Konfiguration.
- Entwickelt und getestet mit den echten Daten von Stationen rund um Toulouse; Rückmeldungen
  willkommen.
