# RC-Rennen TSV Mariendorf

Ein erster Test fuer eine RC-Rennkarte mit Leaflet und OpenStreetMap.

## Dateien

- `index.html` - Grundstruktur der Seite
- `app.js` - Kartenlogik, Filter und Darstellung
- `races.json` - Renntermine
- `venues.json` - Strecken mit Adresse und Koordinaten

## Datenmodell

Events speichern keine eigenen Koordinaten mehr. Jedes Event verweist ueber `venueId` auf eine Strecke in `venues.json`.

Beispiel Event:

```json
{
  "title": "Berlin Touring Masters",
  "venueId": "tsv-mariendorf",
  "startDate": "2026-04-25",
  "endDate": "2026-04-26"
}
```

Beispiel Strecke:

```json
{
  "id": "tsv-mariendorf",
  "name": "TSV Mariendorf RC-Car Racing",
  "lat": 52.4106863916474,
  "lng": 13.321987361999637
}
```
