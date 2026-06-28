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

## Deployment

### Workflows
| Workflow | Trigger | Ziel |
|---|---|---|
| `import-all.yml` | täglich 04:00 + 16:00 UTC, manuell | Vollständiger Import aller Plattformen → main + dev + dev-Server |
| `deploy-site-dev-hetzner.yml` | `dev` push | `rcracemap-dev/` (nur HTML/JS/CSS) |
| `deploy-site-main-hetzner.yml` | `main` push | `.` (root inkl. JSON-Daten) |
| `deploy-data-dev-hetzner.yml` | manuell | `rcracemap-dev/` JSON-Daten (Fallback) |
| `import-rcco.yml` | manuell | **DEAKTIVIERT** — wartet auf Genehmigung von rccar-online.de |
| `fetch-og-images.yml` | manuell | Fetcht og:image von Club-Websites → `hosts.json` auf dev |
| `check-osm-images.yml` | manuell | Prüft OSM/Overpass auf Venue-Bilder → `osm-images-result.json` |

**Wichtig:** `deploy-site-dev-hetzner.yml` kopiert **keine** JSON-Daten. `import-all.yml` deployed JSON-Daten direkt nach dem Import auf den dev-Server (kein manueller Schritt nötig).

**render.com:** Cron deaktiviert (auf nie-existierendes Datum gesetzt). `scripts/render-import.sh` bleibt als Fallback erhalten, wird aber nicht mehr automatisch ausgeführt.

### Cache-Busting
`index.html` verlinkt `app.js?v=XX` und `style.css?v=YY`. Bei jeder Änderung an `app.js` die Versionsnummer in `index.html` hochzählen.

Aktuelle Version: **app.js v243**, **style.css v150**

## Import-System

### Ablauf (GitHub Actions `import-all.yml`)
Der Import läuft täglich **04:00 + 16:00 UTC** via GitHub Actions, NICHT mehr auf render.com.

### import-all.yml — Ablauf
1. **Import RCK** — `node import-rck.js` (RCK_GEOCODE=0, `continue-on-error`)
2. **Import MyRCM** — `node --no-warnings import-myrcm.js` (muss klappen, sonst Abbruch)
3. **Import DMC** — `node import-dmc.js` (`continue-on-error`)
4. ~~Import RCCO~~ — **deaktiviert** (Nutzungsbedingungen rccar-online.de, seit 2026-06-28)
5. **Commit main** — alle JSON-Dateien; `git pull --rebase --autostash` vor Push
6. **Update dev** — `git checkout main -- <files>` → commit + push
7. **Deploy dev-Server** — SFTP via lftp direkt im Workflow
8. **Send notifications** — POST an Supabase Edge Function

### import-myrcm.js — Konfiguration
```js
const hostListFile = "myrcm-hosts-dach.json"; // 304 Hosts: 179 DE + 67 AT + 58 CH
```
**Wichtig:** Muss auf `main` identisch zu `dev` sein — der Import-Job checkt `main` aus.

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
| `venue-seeds.json` | Manuell geprüfte Strecken-Koordinaten (283 Einträge); Wahrheitsquelle für alle Venues |
| `venue-unmatched.json` | nicht zugeordnete Venues |
| `rck-venue-candidates.json` | RCK Venue-Kandidaten |

### RCCO — Status und Genehmigung
**rccar-online.de Nutzungsbedingungen** (Abschnitt "Webscraping - kommerzieller Nutzung") verbieten automatisiertes Extrahieren von Daten. Import wurde am **2026-06-28** deaktiviert.

- `rcco-races.json` ist geleert (`[]`) und wird nicht mehr befüllt
- `rcco-venues.json` enthält nur manuell eingetragene Koordinaten (kein Scraping)
- `import-rcco.yml` gibt eine Fehlermeldung aus und tut nichts
- `import-all.yml` enthält keinen RCCO-Schritt

**Reaktivierung:** Kontaktaufnahme mit rccar-online.de am 2026-06-28. Sobald Genehmigung vorliegt:
1. RCCO-Schritt in `import-all.yml` wieder einkommentieren
2. `import-rcco.yml` wiederherstellen
3. `rcco-races.json` wird beim nächsten Import automatisch befüllt

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
6. **Dev-Deploy** kopiert keine JSON-Daten — `deploy-data-dev-hetzner.yml` manuell ausführen
7. **MAX_BOUNDS** muss Südrand ≤35°N haben — sonst snap-back bei österreichischen Venues auf Mobile
8. **`map.invalidateSize({ pan: false })`** in `setDrawerState` — `pan: false` ist entscheidend
9. **Notification-Funktion** liest von Production (`rcracemap.com`), nicht von dev — auf dev testen macht keinen Sinn
10. **`_venueForRaceCache`** muss nach Datenladen geleert werden (`_venueForRaceCache.clear()`) — sonst werden veraltete Venue-Zuordnungen gecacht
11. **`recentPastRacesForVenue`** muss `matchesCountryFilter` enthalten — sonst erscheinen Venues anderer Länder im Karten-Layer wegen `latestPastRaceForVenue`
12. **`import-myrcm.js` auf `main` und `dev` synchron halten** — Import-Job checkt `main` aus; Änderungen nur auf `dev` werden beim nächsten Tagesimport ignoriert
13. **`myrcm-hosts-dach.json` muss auf `main` vorhanden sein** — Import-Job braucht die Datei; fehlt sie auf main, fällt Import auf DE-only zurück
14. **Non-DACH-Races immer `venueId: null`** — `import-myrcm.js` setzt `venue = isNonDach ? null : venueFromSeed(...)`. Früher gab es `wasExplicit`-Bypass: ETS-Rennen in Trencin/NL wurden fälschlich Arena33 zugeordnet weil `detail.hostLabel` "Arena33" zurückgab. Fix: `wasExplicit` wird für die venue-Zuweisung nicht mehr berücksichtigt.
15. **Neue Workflows nur auf `main` triggern** — `workflow_dispatch`-Workflows müssen auf dem Default-Branch (`main`) liegen um über die GitHub API auslösbar zu sein. Neue Workflows daher immer auf beiden Branches commiten (`fetch-og-images.yml`, `check-osm-images.yml` als Beispiele).
