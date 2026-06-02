# RC-Rennen Deutschland

Testversion fuer eine RC-Rennkarte mit Leaflet und OpenStreetMap.

## Dateien

- `index.html` - Grundstruktur der Seite
- `style.css` - Layout und Gestaltung
- `app.js` - Kartenlogik, Filter und Listenansicht
- `races.json` - Renntermine
- `venues.json` - Strecken mit Adresse und Koordinaten

## Datenmodell

Events speichern keine eigenen Koordinaten. Jedes Event verweist ueber `venueId` auf eine Strecke in `venues.json`.

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
  "lat": 52.410703,
  "lng": 13.321052
}
```
