# RC Race Map Location Strategy

## Grundsatz

MyRCM liefert primär Organisationen und Events.
MyRCM-Orte dürfen nicht automatisch als physische Strecken behandelt werden.

RCK liefert bessere Ortsinformationen, aber oft nur über PDF-Dokumente.
RCK-PDFs werden daher als wichtige Quelle für Venue-Daten ausgewertet.

## Datenrollen

Host:
Ausrichter, Verein, Organisation, Veranstalter.

Venue:
Physische Strecke, Ort, Koordinate.

Race:
Konkretes Rennen mit hostId und venueId.

## MyRCM-Regel

MyRCM Organisation -> Host

Venue nur wenn:
- in venue-seeds.json vorhanden
- oder eindeutig aus einer geprüften Quelle ableitbar

Keine automatische Regel:
MyRCM Organisation -> Venue

## RCK-Regel

RCK Ausrichter -> Host

PDF-Adresse / Streckenadresse -> Venue

Wenn die PDF-Adresse nicht eindeutig ist:
Eintrag in venue-unmatched.json

## Manuelle Korrektur

venue-seeds.json ist die dauerhafte manuelle Wahrheitsquelle für geprüfte Strecken.

venues.json soll aus:
- venue-seeds.json
- sicher erkannten RCK-PDF-Adressen
- geprüften Korrekturen

aufgebaut werden.

## Ziel

Kein Rennen soll wegen einer Organisation einen falschen Kartenpunkt bekommen.
Lieber Standort fehlt als falscher Standort.
