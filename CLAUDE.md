# RC Race Map — Claude Context

## Projekt-Überblick
RC Race Map ist eine Single-Page-App (kein Build-Schritt, kein Framework) die RC-Car-Rennen in Deutschland, Österreich und der Schweiz (DACH) auf einer Leaflet/MapLibre-Karte anzeigt. Drei Quelldateien: `app.js` (~5600 Zeilen), `style.css` (~4000 Zeilen), `index.html` (~1400 Zeilen).

**Live-URLs:**
- Production: `rcracemap.com` — Branch `main`
- Staging: `dev.rcracemap.com` — Branch `dev`

Der User testet **ausschließlich auf dev.rcracemap.com**, nie lokal. Nach jeder Änderung sofort auf `dev` pushen. Deployment läuft automatisch über GitHub Actions bei Push.

**Immer auf `dev` arbeiten, nie direkt auf `main` committen.** Merge dev → main nur wenn explizit gewünscht.

## Tech-Stack
- **Karte:** Leaflet 1.9.4 + MapLibre GL JS 5.23.0 via `@maplibre/maplibre-gl-leaflet`
- **Tiles:** Stadia Maps (`alidade_smooth` / `alidade_smooth_dark`)
- **Backend:** Supabase (Auth + Postgres) für Favoriten, Notifications, Theme-Präferenz
- **Deployment:** Hetzner Managed Server via SFTP (lftp), GitHub Actions

## Architektur

### Karte
- `L.map("map")` mit `minZoom: 6`, initial `setView([51.3, 10.5], 6)`
- `baseMapLayer` = MapLibre GL Leaflet Layer (Stadia-Tiles)
- Panel rechts: 390px breit + 24px Gap = **414px Offset**, Shift = **207px**
- `panToVisible(latlng, zoom)` — verschiebt projizierten Punkt um +207px (Desktop) damit geografisches Zentrum bei `W/2 - 207` erscheint (Mitte des sichtbaren Bereichs links vom Panel). Setzt `lastVisibleCenter`.
- `fitMapToBounds(bounds, options)` — Desktop: `getBoundsZoom` mit 207px symmetrischem Padding + `panToVisible`. Mobile: Leaflet `fitBounds` mit Drawer-Padding.
- `updateMarkers(list, shouldFitBounds)` — rendert Marker; ruft `fitMapToBounds` wenn `shouldFitBounds = true`
- `render()` — zweiphasig: Liste sofort (synchron), Karte per double-rAF (async mit Spinner). `initialRenderDone` wird nur auf `true` gesetzt wenn `venues.length > 0`.

### MAX_BOUNDS
```js
const MAX_BOUNDS = [[35.0, -5.0], [62.0, 30.0]];
```
Bewusst weiter als DACH: `panToVisible` verschiebt das Kartenzentrum auf Mobile bis ~200px südlich des Ziel-Venues. Leaflet's `_limitCenter` prüft ob der **gesamte Container** (nicht nur das Zentrum) innerhalb der Bounds liegt. Bei Zoom 6 + Container-Höhe 764px ergibt das ~6° Spielraum. Der Südrand 35°N gibt genug Puffer für alle DACH-Venues.

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

### Mobile Drawer
- Zustände: `"collapsed"` (H - 64px), `"half"` (80 + (H-80)×0.5), `"full"` (80px)
- `setDrawerState(state)` ruft `map.invalidateSize({ pan: false })` — `pan: false` verhindert unkontrolliertes Neuzentrieren
- `panToVisible` berechnet Shift direkt aus CSS-Mathematik (nicht aus `getBoundingClientRect`), da die Drawer-Transition 0.32s dauert und DOM-Messung mid-animation falsche Werte liefert

### Render-Performance
`venueForRace(race)` wurde früher ~650.000× pro Render aufgerufen (259 Venues × 2238 Rennen in `updateMarkers` + `latestPastRaceForVenue` + `filteredRaces`). Jetzt gecacht:
```js
const _venueForRaceCache = new Map(); // race.id → venue
// wird in venueForRace() befüllt, nach Datenladen geleert (_venueForRaceCache.clear())
```
Zweiphasiger Render in `render()`:
- **Phase 1 (synchron):** `syncFilterUi()` + `renderList()` — Browser malt sofort
- **Phase 2 (double-rAF):** `updateMarkers()` — während dieser Phase zeigt `.map-panel.map-is-updating .map-loader` den Spinner

### Datenmodell (Host / Venue / Race)
- **Host** — Verein/Organisation/Ausrichter (`hosts.json`)
- **Venue** — physische Strecke mit Koordinate (`venues.json`). MyRCM-Organisation → Host, aber NICHT automatisch → Venue. Venue nur wenn in `venue-seeds.json` vorhanden oder sicher aus RCK-PDF-Adresse ableitbar.
- **Race** — konkretes Rennen mit `hostId` + `venueId`. Non-DACH-Races haben immer `venueId: null`.
- `venue-seeds.json` ist die manuelle Wahrheitsquelle für geprüfte Strecken.
- Kein Rennen soll wegen einer Organisation einen falschen Kartenpunkt bekommen — lieber kein Standort als falscher Standort.

### Daten
- `venues` — Array von Strecken (verwende `.find()`)
- `races` — Array von Rennen (myrcm + rck + dmc), aktuell ~2524 (2229 MyRCM + 19 RCK + 276 DMC)
- `markers` — Map (venue.id → Leaflet Marker)
- `hosts`, `hostsById`, `hostsByOrgId` — Club-Daten (256 Hosts: 176 DE, 43 AT, 37 CH)
- Geladen via `fetch()` parallel; nach Laden: `render()` → `revealMapWhenReady()`

### Länderfilter
```js
let selectedCountry = "all"; // | "DE" | "AT" | "CH"
```
- `venueCountry(venue)` — schlägt in `hostsByOrgId` nach, normalisiert Vollnamen zu ISO-Codes
  ```js
  const _countryNameToCode = { Austria: "AT", Switzerland: "CH", Germany: "DE" };
  ```
  **Wichtig:** `myrcm-hosts-dach.json` speichert `country: "Austria"`, `hosts.json` hat `country: "AT"`. Beide Quellen landen in `hostsByOrgId`, DACH-Einträge überschreiben (kommen zuletzt). Ohne Normalisierung würde `"Austria" === "AT"` immer false sein.
- `matchesCountryFilter(race)` — Fallback `if (!c) return true` wenn kein Country-Datum vorhanden
- `recentPastRacesForVenue(venue)` — enthält ebenfalls `matchesCountryFilter` (wichtig: sonst erscheinen DE-Venues bei AT-Filter wegen `latestPastRaceForVenue`)
- **Länderzoom:** Beim Filterwechsel setzt `_zoomToCountryPending = true`, Phase 2 von `render()` ruft `fitToCountry(selectedCountry)` auf
  ```js
  const COUNTRY_BOUNDS = {
    DE: [[47.2, 5.8], [55.1, 15.1]],
    AT: [[46.2, 9.4], [49.0, 17.2]],
    CH: [[45.7, 5.9], [47.9, 10.6]],
    all: [[45.7, 5.8], [55.1, 17.5]],
  };
  ```
- **Auto-Erkennung:** `detectCountryFromLocale()` — prüft zuerst Language-Tags (`de-AT` → AT), dann Timezone-Fallback (`Europe/Vienna` → AT, `Europe/Zurich` → CH, `Europe/Berlin` → DE). Persistiert in `localStorage("rcRaceMapCountry")`.

### Favoriten & "Zuletzt"-Karten
- `isFavoriteHostId(id)` — prüft ob Strecke favorisiert
- `latestPastRaceForVenue(venue)` — letztes vergangenes Rennen
- `buildPastRaceCardEl(race)` → `[label, card]`
- In `renderList()`: wenn `selectedFavoriteFilter === "favorites"`, werden für favorisierte Strecken ohne aktives Rennen "Zuletzt"-Karten angehängt (ohne Label, ohne Duplikate)
- `renderVenueNoRaces(latestPastRace)` — zeigt Zuletzt-Karte wenn Strecke ausgewählt aber keine Rennen

### Onboarding Tips
Erstbesucher sehen drei Tips, die sich beim Schließen nacheinander zeigen. Jeder Tip wird nur einmal gezeigt.

```js
const ONBOARDING_TIPS = [
  { render: "list-top",    arrow: "bottom-right", title: "...", html: "..." },
  { render: "list-second", arrow: "top-center",   title: "...", html: "...", mobileFull: true },
  { render: "fixed-map",                          title: "...", html: "...<span class='tip-footer'>...</span>" },
];
```

**Render-Typen:**
- `"list-top"` — als erstes Element in der Rennliste eingefügt (vor allen Karten)
- `"list-second"` — nach der ersten Rennkarte eingefügt (`_listSecondInserted`-Flag)
- `"fixed-map"` — `position:fixed` Overlay, zentriert auf `#map` via `getBoundingClientRect` + `transform: translate(-50%, -50%)`

**State:** `localStorage("rcRaceMapTipIndex")` — Index des aktuellen Tips. `_dismissTip()` inkrementiert ohne Modulo. Sobald alle gezeigt wurden und Index = Anzahl Tips, wird kein Tip mehr angezeigt.

**DOM:**
- `_buildTipCardEl(tip)` — erstellt `<aside class="tip-card">` mit Grid-Layout:
  - Zeile 1: `.tip-title` (fett, weiß) + `.tip-dismiss`-Button
  - Zeile 2: `.tip-text` (über volle Breite)
  - Zeile 3: `.tip-counter` ("1 / 3")
- `.tip-footer` — inline in `tip.html` als `<span>`, kleiner + 75% Opazität
- `.tip-overlay` — zusätzliche CSS-Klasse für `fixed-map`-Tips (stärkerer Schatten)
- Pfeilspitze via `::after` pseudo-element, gleiche Farbe wie Karte (nahtlos integriert)

**Icon-Konstanten** (müssen VOR `ONBOARDING_TIPS` definiert sein — TDZ!):
```js
const _favIconSvg    = (cls) => `<svg ...>...</svg>`;   // Stern-Icon (Kreis + Feather-Stern-Cutout)
const _bellIconSvg   = (cls) => `<svg ...>...</svg>`;   // Glocken-Icon (Kreis + Glocke-Cutout)
const _locateIconSvg = (cls) => `<svg ...>...</svg>`;   // Crosshair-Icon (Kreise + Punkt)
```
Alle drei mit `fill-rule: evenodd` bzw. Stroke, `aria-hidden="true"`, Klasse `tip-inline-icon`.

**Farbe:** `background: var(--status-upcoming)` = `#4A9EE8` (Hellblau) — identisch mit offenen Nennungen, funktioniert in Light + Dark Mode.

### Favoriten-Klick — kein Scroll-Reset
`renderList()` ruft immer `scrollTo(0, 0)` auf. Klick auf Favorit-Stern / Glocke darf daher **nicht** `renderList()` aufrufen, sonst springt die Liste nach oben.

**Fix (v246/v247):** Im `document click`-Handler wird unterschieden:
- `selectedFavoriteFilter === "favorites"`: Full-Re-Render via `renderList()` nötig (Listeninhalt ändert sich)
- Alle anderen Filter: **In-Place-Update** — kein `renderList()`-Aufruf, Scroll-Position bleibt erhalten:
  - **Host-Favorit:** `.race-host` des betroffenen Cards wird per `raceHostNameHtml(race)` neu gerendert → Glocke erscheint/verschwindet, Stern-Klasse und `is-favorite`-Klassen werden korrekt gesetzt
  - **Venue-Favorit:** nur Stern-Button `active`-Klasse und `race-card-favorite-venue` werden getoggelt (keine Glocke bei Venue-Favoriten)

### Resize & Window-Load
```js
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
// debounced 150ms, ruft panToVisible wenn Breakpoint gequert
```

## Claude Code — Benötigte Umgebungsvariablen

Damit Claude direkt auf render.com und Supabase zugreifen kann, müssen folgende Variablen **einmalig im Claude Code Web-UI unter Environment** gesetzt werden (Settings → Environment → Add variable). Sie stehen dann in jeder Session zur Verfügung.

| Variable | Woher | Wofür |
|---|---|---|
| `RENDER_API_KEY` | render.com → Account → API Keys | Import manuell triggern via `scripts/trigger-render-import.sh` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project → API → service_role | DB-Abfragen (seen_race_notifications etc.) |

**Import manuell triggern** — Claude nutzt das GitHub MCP Tool direkt (kein API Key nötig, kein Proxy-Problem):
```
mcp__github__actions_run_trigger(
  method: "run_workflow",
  owner: "CarstenSchneider",
  repo: "myrcm-rc-map",
  workflow_id: "trigger-render-import.yml",
  ref: "main"
)
```
Das triggert `.github/workflows/trigger-render-import.yml`, welches render.com per `secrets.RENDER_API_KEY` anstößt.

`bash scripts/trigger-render-import.sh` funktioniert **nicht** aus Claude's Umgebung — `api.render.com` ist vom Proxy geblockt (403).

Service ID render.com: `crn-d8v9a4bsq97s73827f8g`

## Deployment

### Workflows
| Workflow | Trigger | Ziel |
|---|---|---|
| `import-all.yml` | täglich 04:00 + 16:00 UTC, manuell | Vollständiger Import aller Plattformen → main + dev + dev-Server |
| `deploy-site-dev-hetzner.yml` | `dev` push | `rcracemap-dev/` (nur HTML/JS/CSS) |
| `deploy-site-main-hetzner.yml` | `main` push | `.` (root inkl. JSON-Daten) |
| `deploy-data-dev-hetzner.yml` | manuell | `rcracemap-dev/` JSON-Daten (Fallback) |
| `import-rcco.yml` | manuell | **PERMANENT DEAKTIVIERT** — rccar-online.de hat abgesagt (2026-06-29), keine Integration |
| `fetch-og-images.yml` | manuell | Fetcht og:image von Club-Websites → `hosts.json` auf dev |
| `check-osm-images.yml` | manuell | Prüft OSM/Overpass auf Venue-Bilder → `osm-images-result.json` |

**Wichtig:** `deploy-site-dev-hetzner.yml` deployt bei einem Push auf `dev` auch alle JSON-Daten. Ein Push auf `dev` reicht — kein manueller Datendeploy nötig.

**render.com ist der primäre Import-Runner** (GitHub Actions `import-all.yml` hat Probleme). `scripts/render-import.sh` läuft täglich 04:00 + 16:00 UTC auf render.com und ist die Wahrheitsquelle für den Import-Ablauf. Änderungen am Import-Prozess immer in `render-import.sh` (und parallel in `import-all.yml`) vornehmen.

### Cache-Busting
`index.html` verlinkt `app.js?v=XX` und `style.css?v=YY`. Bei jeder Änderung an `app.js` die Versionsnummer in `index.html` hochzählen.

Aktuelle Version: **app.js v291**, **style.css v168**

## Import-System

### Primärer Import: render.com (`scripts/render-import.sh`)
Der Import läuft täglich **04:00 + 16:00 UTC auf render.com**. `render-import.sh` ist die Wahrheitsquelle.

### render-import.sh — Ablauf
1. **Dev-Seeds merge** — neue venue-seeds aus dev → main mergen (vor Import)
2. **France Discovery** — `node scripts/discover-myrcm-france.js` (aktualisiert `myrcm-hosts-france.json`)
3. **Import RCK** — `node import-rck.js` (`continue-on-error`)
4. **Import MyRCM** — `node --no-warnings import-myrcm.js` (muss klappen, sonst Abbruch)
5. **Import DMC** — `node import-dmc.js` (`continue-on-error`)
6. **Import FFVRC** — `node import-ffvrc.js` (`continue-on-error`)
7. ~~Import RCCO~~ — **deaktiviert** (Nutzungsbedingungen rccar-online.de)
8. **Commit main** — alle JSON-Dateien inkl. `myrcm-hosts-france.json`; `git pull --rebase --autostash` vor Push
9. **Update dev** — Daten von main → dev branch → push (triggert `deploy-site-dev-hetzner.yml`)
10. **Send notifications** — POST an Supabase Edge Function

**Neues Land / neue Plattform hinzufügen:** Script schreiben → `render-import.sh` ergänzen → ggf. `loadHosts()` in `import-myrcm.js` erweitern → leere JSON-Datei anlegen → auf dev **und** main pushen.

### myrcm.ch — Zugriff aus Claude's Umgebung NICHT möglich
**WICHTIG:** Claude's Remote-Execution-Umgebung kann myrcm.ch **nicht** erreichen (Proxy gibt 403/000 zurück). render.com hingegen kann myrcm.ch problemlos erreichen. Für alle Aufgaben die myrcm.ch-Zugriff erfordern (Discovery, Scraping, Test): Script schreiben das auf render.com läuft — nicht versuchen es von hier aus zu testen.

### import-myrcm.js — Konfiguration
```js
const hostListFile = "myrcm-hosts-dach.json";       // 304 Hosts: 179 DE + 67 AT + 58 CH
const beneluxHostListFile = "myrcm-hosts-benelux.json"; // 90 Hosts: NL 50, BE 34, LU 6
const franceHostListFile = "myrcm-hosts-france.json";   // FR Clubs (auto-discovery via render.com)
```
`loadHosts()` lädt alle drei Dateien und mergt sie (Duplikate per orgId dedupliziert).

**Wichtig:** `import-myrcm.js` und alle `myrcm-hosts-*.json` müssen auf `main` und `dev` identisch sein — render.com checkt `main` aus.

### import-myrcm.js — Fehlerbehandlung
```js
async function isMyrcmReachable()  // schneller Ping auf myrcm.ch (8s Timeout)
```
**Nach jedem Netzwerkfehler** (Event-Detail oder Host-Seite):
- `isMyrcmReachable()` → **true**: einzelner Bad Event/Host, überspringen (`return null` / `continue`)
- `isMyrcmReachable()` → **false**: systemischer Ausfall → `throw error` → Retry nach 30s (max. 3 Versuche)

`parseEvents()` filtert `null`-Werte mit `races.filter(Boolean)`.

**Buchungsseiten-Check:** Die Nennseite (`hId[1]=bkg`) wird beim Import abgerufen. Enthält sie "Registration closed" oder "Booking closed", wird `registrationStatus` auf `"closed"` gesetzt. **"Booking not possible" allein setzt NICHT mehr auf closed** — dieser Text erscheint auch wenn die Nennung noch nicht geöffnet ist (Status "upcoming"). Wenn `registrationInfoFromText` bereits "upcoming" zurückgibt, wird das nicht überschrieben.

**Country-Backfill:** Nach `mergeHosts()` wird für Hosts ohne `country`-Feld das Land aus `myrcm-hosts-dach.json` nachgefüllt (via `orgId`-Mapping). So haben alle Hosts in `hosts.json` ein `country`-Feld im ISO-Format (AT/CH/DE).

### Datendateien
| Datei | Inhalt |
|---|---|
| `races.json` | MyRCM-Rennen (~2229 Rennen, DACH) |
| `rck-races.json` | RCK-Rennen (~19) |
| `dmc-races.json` | DMC-Rennen (~276, via `import-dmc.js`, in app.js integriert) |
| `rcco-races.json` | **LEER (`[]`)** — RCCO-Import deaktiviert (ToS-Verstoß) |
| `rcco-venues.json` | RCCO-Strecken (12 Venues, manuell aus venue-seeds.json — kein Scraping) |
| `venues.json` | Strecken (DACH); enthält alle venue-seeds.json-Einträge mit gültigen Koordinaten |
| `hosts.json` | Clubs (256 Hosts: 176 DE + 43 AT + 37 CH); enthält `ogImage`-Felder für 47 Clubs (via `fetch-og-images.yml`) |
| `myrcm-hosts-dach.json` | Seed-Datei: 304 MyRCM-Hosts DACH (orgId, country als Vollname) |
| `myrcm-hosts-benelux.json` | Seed-Datei: 90 MyRCM-Hosts Benelux (NL 50, BE 34, LU 6) |
| `myrcm-hosts-france.json` | Auto-generiert von `scripts/discover-myrcm-france.js` auf render.com; initial leer |
| `ffvrc-races.json` | FFVRC-Rennen (via `import-ffvrc.js`) |
| `ffvrc-venues.json` | FFVRC-Strecken (locationUnknown Fallback: `ffvrc-fr`) |
| `venue-seeds.json` | Manuell geprüfte Strecken-Koordinaten (283 Einträge); Wahrheitsquelle für alle Venues |
| `venue-unmatched.json` | nicht zugeordnete Venues |
| `rck-venue-candidates.json` | RCK Venue-Kandidaten |

### RCCO — Status: **Dauerhaft abgesagt**
**rccar-online.de hat am 2026-06-29 abgesagt** — sie möchten ihre Rennen nicht auf der Karte haben. Die Integration ist dauerhaft deaktiviert, keine Reaktivierung geplant.

- `rcco-races.json` bleibt leer (`[]`) — wird nie befüllt
- `rcco-venues.json` enthält nur manuell eingetragene Koordinaten (kein Scraping)
- `import-rcco.yml` ist dauerhaft deaktiviert
- `import-all.yml` enthält keinen RCCO-Schritt

**Keine Reaktivierung** — rccar-online.de hat explizit abgesagt. RCCO-Code und Dateien bleiben im Repo als Archiv, werden aber nicht deployed oder ausgeführt.

### LRP Offroad Series — Status und Genehmigung
**lrp.cc** betreibt eine eigene Rennserie (LRP Offroad Series) mit einem Veranstaltungskalender ähnlich wie RCK (wahrscheinlich PDF-basiert).

- Noch kein Importer vorhanden
- Kontaktaufnahme mit lrp.cc am 2026-06-28
- Implementierung: analog zu `import-rck.js` (PDF-Parser)

**Reaktivierung:** Sobald Genehmigung vorliegt:
1. `import-lrp.js` erstellen (analog `import-rck.js`)
2. LRP-Schritt in `import-all.yml` ergänzen
3. `lrp-races.json` + ggf. `lrp-venues.json` anlegen und in app.js einbinden

## Notification-System

### Supabase Edge Function: `send-race-notifications`
- Datei: `supabase/functions/send-race-notifications/index.ts`
- Wird aufgerufen: nach jedem erfolgreichen Import via `import-races.yml`
- Liest Daten von Production: `https://rcracemap.com/races.json` + `rck-races.json` + `venues.json`
- Sendet Email via **Resend API** (`noreply@rcracemap.com`)

### Datenbank-Tabellen
- `venue_notifications` — Abonnements: `(user_id, host_id)`, enthält Favoriten mit aktivierter Glocke
- `seen_race_notifications` — Deduplizierung: `(user_id, race_id, notif_type)` verhindert doppelte Emails

### Notification-Typen
- `new_race` — neues Rennen bei abonniertem Verein
- `registration_open` — Nennung geöffnet

### Email neu senden (Test)
1. Supabase Dashboard → Table Editor → `seen_race_notifications` → eigene Zeilen löschen (Filter: `user_id = [eigene UUID]`)
2. GitHub → Actions → **Trigger Render Import** → Run workflow

### Anon Key (öffentlich, bereits in app.js)
```
sb_publishable_Y9b0eW34GzqNfG3u8JZmiA_EI7fSc6P
```
Supabase URL: `https://ncsqbncxctofkmabmwku.supabase.co`

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

### Warum myrcm.ch manchmal scheitert
myrcm.ch läuft auf einem Managed Server mit gelegentlichen Kurzausfällen. GitHub Actions IPs sind **nicht** geblockt — die Timeouts sind transient. Der `isMyrcmReachable()`-Check unterscheidet individuelle Bad Events von systemischen Ausfällen.

### Warum hostsByOrgId Vollnamen normalisiert werden müssen
`myrcm-hosts-dach.json` (Seed-Datei) hat `country: "Austria"`, `hosts.json` (Import-Output) hat `country: "AT"`. Beide Quellen landen in `hostsByOrgId`, DACH-Einträge kommen zuletzt und überschreiben. `venueCountry()` normalisiert daher via `_countryNameToCode` Map.

## Pre-Launch Checkliste

### Karte & Grundfunktion
- [ ] Startansicht korrekt (richtiges Land auto-erkannt, Karte zentriert)
- [ ] Alle Marker sichtbar (DE + AT + CH)
- [ ] Klick auf Marker öffnet Strecken-Panel
- [ ] Klick außerhalb schließt Panel wieder
- [ ] Zoom/Pan funktioniert, MAX_BOUNDS begrenzen korrekt

### Länderfilter
- [ ] DE / AT / CH Filter zeigen nur Rennen des jeweiligen Landes
- [ ] Filter-Wechsel zoomt Karte auf das Land
- [ ] "Alle Länder" zeigt DACH-Gesamtansicht
- [ ] Auswahl bleibt nach Reload erhalten (localStorage)
- [ ] Auto-Erkennung korrekt (Safari/Chrome, macOS/iOS/Android in DE/AT/CH testen)

### Renndaten
- [ ] Registrierungsstatus korrekt: "Nennung offen" / "geschlossen" / "Nennung ab [Datum]"
- [ ] Keine zukünftigen Rennen fälschlicherweise als "geschlossen" markiert
- [ ] Rennklassen-Tags werden angezeigt
- [ ] Teilnehmerzahl korrekt (wo verfügbar)
- [ ] Links zu MyRCM / RCK öffnen sich

### Favoriten & Notifications
- [ ] Stern setzen/entfernen funktioniert (eingeloggt)
- [ ] Glocke für Benachrichtigungen setzt/entfernt Abonnement
- [ ] Notification-Email kommt nach Import an (Supabase `seen_race_notifications` leeren und Import manuell starten)
- [ ] Favoriten-Filter zeigt nur Favoriten-Strecken

### Mobile (iOS Safari + Android Chrome)
- [ ] Drawer-Zustände: collapsed / half / full
- [ ] Swipe-Geste auf Drawer funktioniert
- [ ] Locate-Button (GPS) zentriert auf eigene Position
- [ ] Karte bleibt beim Öffnen eines Eintrags sichtbar

### Dark Mode
- [ ] Theme wechselt korrekt (System-Einstellung + manuell)
- [ ] Kein grüner Flash beim Tab-Wechsel
- [ ] Marker-Farben korrekt in beiden Themes

### Performance
- [ ] Filter-Wechsel sofort responsiv (kein UI-Freeze)
- [ ] Karten-Spinner erscheint während Marker-Update
- [ ] Initiales Laden < 3s auf normalem Mobilnetz

### Import-Pipeline
- [ ] `import-myrcm.js` auf `main` und `dev` identisch (vor Livegang abgleichen)
- [ ] Nächster geplanter Import (04:00 UTC) schreibt korrekt auf `main` + `dev`
- [ ] Nach Import: `races.json` enthält DE + AT + CH Rennen

### Deployment
- [ ] `dev` → `main` Merge nur wenn obige Punkte alle bestätigt
- [ ] Nach `main`-Push: Production-URL `rcracemap.com` testen

---

## Pipeline-Architektur (Übersicht)

```
04:00 + 16:00 UTC
       ↓
import-all.yml (GitHub Actions)
  ├── import-rck.js        → rck-races.json
  ├── import-myrcm.js      → races.json, hosts.json, venues.json
  ├── import-dmc.js        → dmc-races.json, dmc-venues.json
  └── [RCCO deaktiviert]
       ↓
  Commit → main (auto-deploy Production via deploy-site-main-hetzner.yml)
  Commit → dev
  SFTP → dev-Server (rcracemap-dev/)
  POST → Supabase send-race-notifications
```

Venue-Seeds → Koordinaten für alle Plattformen:
```
venue-seeds.json (manuell gepflegt, 283 Einträge)
  ├── hostId: "rcco-*"   → rcco-venues.json (immer, auch ohne Events)
  ├── myrcmOrgId: "..."  → venues.json (via import-myrcm.js mergeVenueSeedsIntoVenues)
  └── alle mit lat/lng   → venues.json (erscheinen auf Karte, auch ohne Rennen)
```

## Bekannte Stolperfallen
1. **`venues` ist Array, `markers` ist Map** — `.find()` vs `.get()`
2. **`initialRenderDone`** wird nur gesetzt wenn `venues.length > 0`
3. **`panToVisible`** setzt `lastVisibleCenter` — wichtig für Resize-Handler
4. **Kein Debounce auf `styledata`** — direkter Aufruf
5. **`sbPullPreferences`** ruft `setTheme` nur bei echten Änderungen auf
6. **Dev-Deploy kopiert jetzt auch JSON-Daten** — `deploy-site-dev-hetzner.yml` deployt seit 2026-06-29 auch `races.json`, `venues.json`, `hosts.json` etc. Ein Push auf `dev` reicht. `deploy-data-dev-hetzner.yml` ist nur noch manueller Fallback.
7. **MAX_BOUNDS** muss Südrand ≤35°N haben — sonst snap-back bei österreichischen Venues auf Mobile
8. **`map.invalidateSize({ pan: false })`** in `setDrawerState` — `pan: false` ist entscheidend
9. **Notification-Funktion** liest von Production (`rcracemap.com`), nicht von dev — auf dev testen macht keinen Sinn
10. **`_venueForRaceCache`** muss nach Datenladen geleert werden (`_venueForRaceCache.clear()`) — sonst werden veraltete Venue-Zuordnungen gecacht
11. **`recentPastRacesForVenue`** muss `matchesCountryFilter` enthalten — sonst erscheinen Venues anderer Länder im Karten-Layer wegen `latestPastRaceForVenue`
12. **`import-myrcm.js` auf `main` und `dev` synchron halten** — Import-Job checkt `main` aus; Änderungen nur auf `dev` werden beim nächsten Tagesimport ignoriert
13. **`myrcm-hosts-dach.json` muss auf `main` vorhanden sein** — Import-Job braucht die Datei; fehlt sie auf main, fällt Import auf DE-only zurück
14. **Non-DACH-Races immer `venueId: null`** — `import-myrcm.js` setzt `venue = isNonDach ? null : venueFromSeed(...)`. Früher gab es `wasExplicit`-Bypass: ETS-Rennen in Trencin/NL wurden fälschlich Arena33 zugeordnet weil `detail.hostLabel` "Arena33" zurückgab. Fix: `wasExplicit` wird für die venue-Zuweisung nicht mehr berücksichtigt.
15. **Neue Workflows nur auf `main` triggern** — `workflow_dispatch`-Workflows müssen auf dem Default-Branch (`main`) liegen um über die GitHub API auslösbar zu sein. Neue Workflows daher immer auf beiden Branches commiten (`fetch-og-images.yml`, `check-osm-images.yml` als Beispiele).
16. **Favoriten-Klick darf `renderList()` nicht aufrufen** — `renderList()` ruft immer `scrollTo(0,0)` auf. Stattdessen In-Place-Update: Bei Host-Favorit `.race-host` per `raceHostNameHtml(race)` neu bauen (damit Glocke erscheint/verschwindet). Bei Venue-Favorit nur Button- und Card-Klassen toggen. Ausnahme: `selectedFavoriteFilter === "favorites"` braucht Full-Re-Render.
17. **`focusRace()` auto-wechselt Länderfilter** — wenn der Marker einer Venue nicht existiert (weil Länderfilter aktiv), wird `selectedCountry = "all"` gesetzt und `updateMarkers()` synchron aufgerufen, bevor auf die Venue gepannt wird. So funktioniert das Klicken auf Rennen aus einem anderem Land als dem aktuell gefilterten.
18. **Icon-Konstanten müssen VOR `ONBOARDING_TIPS` definiert sein** — `ONBOARDING_TIPS` ist ein `const`-Array-Literal das `_bellIconSvg(...)` in seinem Initializer aufruft. `const` unterliegt der TDZ (Temporal Dead Zone): wird `_bellIconSvg` erst nach `ONBOARDING_TIPS` deklariert, wirft der Modul-Load sofort einen `ReferenceError` und die gesamte App bricht ab (keine Karte, keine Rennen). Reihenfolge: `_favIconSvg` → `_locateIconSvg` → `_bellIconSvg` → `ONBOARDING_TIPS`.
19. **`venueId: null` reicht NICHT um eine Venue-Zuordnung zu entfernen** — `venueForRace()` macht drei Lookups: `venueById(race.venueId) || venueByRaceAddress(race) || venueByRaceNameAndCity(race)`. Wenn `race.venueName` noch auf eine bekannte Venue zeigt (z.B. "Arena33"), findet `venueByRaceNameAndCity` diese trotzdem — das Race erscheint weiter am falschen Marker. **Fix:** `venueName` und `venueLocation` im Race ebenfalls nullen, UND die korrekte Venue zuweisen (oder `ets-international` für Ort-unbekannt).
20. **Wanderserien (ETS/TOS/ENS) niemals pauschal auf eine Home-Venue legen** — `travellingSeriesOrgIds` (import-myrcm.js) enthält BEIDE ETS-relevanten orgIds: `"2047"` (ETS / Euro RC Series) und `"24531"` (ToniSport GmbH). Nur wenn `host.orgId` in diesem Set ist, wird die Home-Venue-Zuweisung verhindert und `detail.hostLabel` aus dem raceText ausgeschlossen. Venue-Zuweisung läuft dann ausschließlich per Text-Match: `detectVenueSeedFromRaceText` matched Race-Namen gegen Venue-Namen und Aliases aus `venue-seeds.json`. Beispiel: Race "Euro Touring Series Round 4 DAUN/ GER" → matched Alias "DAUN/ GER" → `venueId: "mc-daun"`. Für Läufe ohne bekannte Venue: automatisch `venueId: "ets-international"` (locationUnknown, kein Karten-Marker, aber sichtbar in der Liste). **Wichtig:** `isNonDach`-Check wird für Wanderserien deaktiviert — ETS/ENS-Läufe in NL/BE/IT/SK werden NICHT genullt, sondern als `ets-international` angezeigt.
21. **ETS-Venue-Aliases in venue-seeds.json** — damit der nächste Import ETS-Läufe korrekt zuordnet, müssen die Venue-Seeds die Ortsnamen aus den Race-Namen als Aliases haben: `mav-aigen-schlaegl` → ["Aigen", "AIGEN"], `mc-ettlingen-e-v` → ["Ettlingen", "ETTLINGEN"], `m-a-r-s-alt-erlaa` → ["Vienna", "VIENNA"], `mc-daun` → ["DAUN / GER", "DAUN/ GER"]. Fehlt ein Alias, bleibt die Race auf `ets-international` (Ort unbekannt) statt am richtigen Marker.
22. **Races mit `venueId: null` und ohne Venue-Fallback verschwinden aus der Liste** — die App filtert solche Races aus der sichtbaren Liste. Für Races ohne bekannte Koordinaten immer `venueId: "ets-international"` (oder eine andere locationUnknown-Venue) setzen, nicht null lassen.
23. **`venueCountry()` ignoriert `venue.country` nicht — DACH-Venues haben kein `myrcmOrgId`** — DMC-Venues (und manuell verifizierte Venues) haben `"country": "DE"/"AT"/"CH"` direkt auf dem Objekt, aber kein `myrcmOrgId`. `venueCountry()` prüft zuerst `myrcmOrgId` (Lookup via `hostsByOrgId`), fällt dann auf `venue.country` zurück. Ohne diesen Fallback gab `venueCountry` für alle DMC-Venues `null` zurück — Folge: Deutsche DMC-Strecken erschienen im Belgien-Filter.
24. **`matchesCountryFilter`-Fallback bei fehlendem Länderdatum: nur DACH** — wenn weder `venue.country` noch `myrcmOrgId`-Lookup ein Land liefern, gilt: bei DACH-Filtern (DE/AT/CH) → `true` (Venue ist vermutlich DACH), bei Nicht-DACH-Filtern (BE/NL/LU/FR) → `false`. Der ursprüngliche generelle `return true`-Fallback war aus der Zeit als nur DACH-Filter existierten — mit Benelux/France falsch.
25. **myrcm.ch ist aus Claude's Remote-Umgebung NICHT erreichbar** — der Proxy gibt 403 oder 000 zurück. Niemals versuchen myrcm.ch von dieser Umgebung aus zu testen (curl, WebFetch, fetch — alles schlägt fehl). Stattdessen: Script schreiben, auf render.com laufen lassen. render.com hat freien Zugriff auf myrcm.ch.
26. **render.com ist der primäre Import-Runner** — GitHub Actions `import-all.yml` hat bekannte Probleme. Änderungen am Import immer in `scripts/render-import.sh` vornehmen (und parallel in `import-all.yml` für den Fallback). `render-import.sh` auf `main` pushen — render.com checkt `main` aus.
27. **`venueRecordFromSeed()` muss `country` vom Seed propagieren** — ohne `...(seed.country ? { country: seed.country } : {})` haben Venues kein `country`-Feld → `venueCountry()` gibt null zurück → Venues erscheinen unter falschem Länderfilter. Fix ist in `import-myrcm.js` vorhanden.
28. **Seed `id`-Feld ist kritisch für Venue-IDs** — `seedId(seed)` gibt `seed.id` zurück wenn vorhanden, sonst `"myrcm-{orgId}"`. Ohne explizites `id`-Feld hat eine Venue nach dem Import z.B. id `"myrcm-5305"` statt `"raco-2000"`. Immer `"id"` in venue-seeds.json setzen wenn eine sprechende ID gewünscht ist.
