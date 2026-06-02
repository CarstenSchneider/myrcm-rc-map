# MyRCM RC Map

Karte fuer RC-Rennen in Berlin/Brandenburg.

## Dateien

- `venues.json`: Strecken mit Koordinaten
- `races.json`: Rennen, die auf eine Strecke per `venueId` verweisen
- `import-myrcm.js`: Importiert Rennen aus MyRCM und filtert Trainings aus
- `.github/workflows/import-myrcm.yml`: GitHub Action fuer manuellen und taeglichen Import

## MyRCM Import manuell starten

1. Repository auf GitHub oeffnen
2. Oben auf `Actions`
3. Links `Import MyRCM races` auswaehlen
4. Rechts `Run workflow`
5. Gruenen Button `Run workflow` klicken

Danach erzeugt GitHub eine neue `races.json` und committed sie automatisch.

## Lokal testen

```bash
npm install
npm run import:myrcm
```
