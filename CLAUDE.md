# RC Race Map — Claude Context

## Projekt-Überblick
RC Race Map ist eine Single-Page-App (kein Build-Schritt, kein Framework) die RC-Car-Rennen in Deutschland auf einer Leaflet/MapLibre-Karte anzeigt. Drei Quelldateien: `app.js` (~4500 Zeilen), `style.css` (~3500 Zeilen), `index.html` (~1350 Zeilen).

**Live-URLs:**
- Production: `rcracemap.com` — Branch `main`
- Staging: `dev.rcracemap.com` — Branch `dev`

Der User testet **ausschließlich auf dev.rcracemap.com**, nie lokal. Nach jeder Änderung sofort auf `dev` pushen. Deployment läuft automatisch über GitHub Actions bei Push.

**Immer auf `dev` arbeiten, nie direkt auf `main` committen.** Merge dev → main nur wenn explizit gewünscht.

## Tech-Stack
- **Karte:** Leaflet 1.9.4 + MapLibre GL JS 5.23.0 via `@maplibre/maplibre-gl-leaflet`
- **Tiles:** Stadia Maps (`alidade_smooth` / `alidade_smooth_dark`)
- **Backend:** Supabase (Auth + Postgres) für Favoriten, Notifications, Theme-Präferenz
- **Deployment:** Hetzner via SFTP (lftp), GitHub Actions

## Architektur

### Karte
- `L.map("map")` mit `minZoom: 6`, initial `setView([51.3, 10.5], 6)`
- `baseMapLayer` = MapLibre GL Leaflet Layer (Stadia-Tiles)
- Panel rechts: 390px breit + 24px Gap = **414px Offset**, Shift = **207px**
- `panToVisible(latlng, zoom)` — verschiebt projizierten Punkt um +207px (Desktop) damit geografisches Zentrum bei `W/2 - 207` erscheint (Mitte des sichtbaren Bereichs links vom Panel). Setzt `lastVisibleCenter`.
- `fitMapToBounds(bounds, options)` — Desktop: `getBoundsZoom` mit 207px symmetrischem Padding + `panToVisible`. Mobile: Leaflet `fitBounds` mit Drawer-Padding.
- `updateMarkers(list, shouldFitBounds)` — rendert Marker; ruft `fitMapToBounds` wenn `shouldFitBounds = true`
- `render()` — ruft `updateMarkers(list, !initialRenderDone)`. `initialRenderDone` wird nur auf `true` gesetzt wenn `venues.length > 0` (verhindert Frühzeitiges Setzen durch `onAuthStateChange` vor Datenladen)

### Map-Styling
```js
function applyRcRaceMapStyle()  // setzt alle Layer-Farben via setPaintProperty
rcRaceMapColorsLight / rcRaceMapColorsDark  // Farbpaletten
```
Events die `applyRcRaceMapStyle` auslösen:
- `"load"` — einmalig beim Laden
- `"styledata"` — direkt (kein Debounce!) bei jedem Style-Event
- `"webglcontextrestored"` → rAF → `applyRcRaceMapStyle`
- `document visibilitychange` (wenn nicht hidden) → rAF → `applyRcRaceMapStyle`

**Wichtig:** Kein Debounce auf `styledata` — der 80ms Debounce (Commit 48e7281) verursachte den grünen Flash und wurde revertiert (v84).

### Grüner Flash beim Tab-Wechsel
**Ursache:** `onAuthStateChange` (inkl. TOKEN_REFRESHED) rief `sbPullPreferences()` auf → `setTheme()` → `mlMap.setStyle(url)` = voller Style-Reload = Flash.
**Fix (v87):** `sbPullPreferences` ruft `setTheme` nur auf wenn DB-Theme ≠ localStorage-Theme.

### Daten
- `venues` — Array von Strecken (verwende `.find()`)
- `races` — Array von Rennen (myrcm + rck)
- `markers` — Map (venue.id → Leaflet Marker)
- `hosts`, `hostsById`, `hostsByOrgId` — Club-Daten
- Geladen via `fetch()` parallel; nach Laden: `render()` → `revealMapWhenReady()`

### Favoriten & "Zuletzt"-Karten
- `isFavoriteHostId(id)` — prüft ob Strecke favorisiert
- `latestPastRaceForVenue(venue)` — letztes vergangenes Rennen
- `buildPastRaceCardEl(race)` → `[label, card]`
- In `renderList()`: wenn `selectedFavoriteFilter === "favorites"`, werden für favorisierte Strecken ohne aktives Rennen "Zuletzt"-Karten angehängt (ohne Label, ohne Duplikate)
- `renderVenueNoRaces(latestPastRace)` — zeigt Zuletzt-Karte wenn Strecke ausgewählt aber keine Rennen

### Resize & Window-Load
```js
// window.load: invalidateSize korrigiert Leaflet-Maße, danach panToVisible re-zentrieren
window.addEventListener("load", () => {
  setDrawerState("half");
  requestAnimationFrame(() => {
    map?.invalidateSize?.();
    baseMapLayer?.getMaplibreMap?.()?.resize?.();
    if (lastVisibleCenter && !window.matchMedia("(max-width: 860px)").matches) {
      panToVisible(lastVisibleCenter, map.getZoom());
    }
    requestAnimationFrame(() => { void document.body.offsetHeight; });
  });
});

// Resize: nur bei Breakpoint-Crossing (860px) re-zentrieren
let resizeWasMobile = window.matchMedia("(max-width: 860px)").matches;
// debounced 150ms, ruft panToVisible wenn Breakpoint gequert
```

## Deployment

### Workflows
| Workflow | Branch | Ziel |
|---|---|---|
| `deploy-site-dev-hetzner.yml` | `dev` push | `rcracemap-dev/` (nur HTML/JS/CSS) |
| `deploy-site-main-hetzner.yml` | `main` push | `.` (root inkl. JSON-Daten) |
| `deploy-data-dev-hetzner.yml` | manuell | `rcracemap-dev/` JSON-Daten |
| `import-myrcm.yml` / `import-rck.yml` | manuell | Renndaten importieren |

### Cache-Busting
`index.html` verlinkt `app.js?v=XX` und `style.css?v=YY`. Bei jeder Änderung an `app.js` die Versionsnummer in `index.html` hochzählen.

Aktuelle Version: **app.js v87**, **style.css v51**

## Wichtige Design-Entscheidungen

### Warum minZoom: 6 (nicht 5)
Bei zoom=5 überkompensiert der 207px-Shift. Zoom 6 ist das Minimum für korrekte Panel-Zentrierung.

### Warum kein Debounce auf styledata
Der 80ms Debounce verhinderte zwar Label-Flash auf iPhone, verursachte aber einen grünen Flash bei Tab-Wechsel (styledata nach visibilitychange überschrieb unsere Farben). Direkter Aufruf ist korrekt.

### Popup-Verhalten
Klick auf Popup (inkl. Streckenname / Route-Button) pinnt die Strecke: `isPopupPinned = true`, `pinnedVenueId = venue.id`, `activeVenueId = venue.id`. Kein `<a>`-Early-Return im Click-Handler.

### Status-Farben
- `--status-upcoming: #4A9EE8` (hellblau, nicht orange)
- Definiert in CSS und als JS-Fallback `var(--status-upcoming, #4A9EE8)`

## Bekannte Stolperfallen
1. **`venues` ist Array, `markers` ist Map** — `.find()` vs `.get()`
2. **`initialRenderDone`** wird nur gesetzt wenn `venues.length > 0`
3. **`panToVisible`** setzt `lastVisibleCenter` — wichtig für Resize-Handler
4. **Kein Debounce auf `styledata`** — direkter Aufruf
5. **`sbPullPreferences`** ruft `setTheme` nur bei echten Änderungen auf
6. **Dev-Deploy** kopiert keine JSON-Daten — diese bleiben vom letzten manuellen Data-Deploy
