# Übergabe-Notizen (Stand: app.js v201, 27. Juni 2026)

---

## Versionsstand

| Datei | Version | Cache-Buster in `index.html` |
|---|---|---|
| `app.js` | **v201** | `<script src="app.js?v=201">` |
| `style.css` | **v110** | `<link href="style.css?v=110">` |

Bei jeder Änderung an `app.js` den `?v=`-Wert in `index.html` hochzählen.

---

## Branch-Regeln (WICHTIG)

- **Immer auf `dev` arbeiten** — nie direkt auf `main` committen
- Ausnahme: `import-myrcm.js` muss auf `main` UND `dev` identisch sein (Import-Job checkt `main` aus)
- `dev` → deployt automatisch auf `dev.rcracemap.com`
- `main` → Production `rcracemap.com` (nur via explizitem Merge)
- User testet **ausschließlich auf `dev.rcracemap.com`**, nie lokal
- Nach jeder Änderung sofort auf `dev` pushen

### Rollback-Referenz
Branch `stable/2026-06-27` zeigt auf Commit `7ede4df` (main) — stabiler Stand vor DMC-Arbeit.

---

## Import-System

### render.com (Haupt-Import)
Der tägliche Import läuft auf **render.com**, NICHT in GitHub Actions.

| Datei | Funktion |
|---|---|
| `render.yaml` | Render-Cron-Config (täglich 04:00 UTC) |
| `scripts/render-import.sh` | Haupt-Import-Script |
| `.github/workflows/trigger-render-import.yml` | Manueller Trigger via GitHub Actions |

**WICHTIG:** Import nur via `trigger-render-import.yml` auslösen, NIEMALS direkt `import-races.yml` (falls vorhanden).

### Was `render-import.sh` macht
1. MyRCM-Verfügbarkeit prüfen (3 Versuche × 5 Min)
2. `node import-rck.js` (RCK_GEOCODE=0)
3. `node import-myrcm.js`
4. Alle JSON-Dateien committen → push zu `main` und `dev`
5. Supabase Edge Function `send-race-notifications` aufrufen

### Commit-Dateien (render-import.sh)
```
races.json hosts.json venues.json venue-unmatched.json venue-seeds.json
rck-races.json rck-unmatched-venues.json rck-venue-candidates.json
```

---

## DMC-Import (in Arbeit)

### Status
- `import-dmc.js` existiert, schreibt nach `dmc-races.json`
- Aktuell holt es Daten von `api.rc-cloud.de/germany` (Stefan Teitges aggregierter Dienst) — **das ist nur ein Zwischenstand**
- **Ziel:** Direktes Scraping von `dmc-online.com` (noch nicht implementiert)
- Scraper soll ebenfalls in `render-import.sh` laufen (wie RCK/MyRCM)
- Test-Workflow: `.github/workflows/test-dmc-import.yml` (manuell triggern)

### Match-Rate (Test vom 27.06.2026)
- 410 Rennen total im RC Cloud Feed, davon 128 DMC
- **100/128 (78%)** haben eine venueId-Zuordnung via `hosts.json`
- 28 ungematchte Clubs → erscheinen im Admin-Panel unter "Unbekannt" zum manuellen Eintragen

### Datenformat `dmc-races.json`
```json
{
  "id": "dmc-mc-fuerstenwalde-e-v-2026-06-27",
  "venueId": "mc-fuerstenwalde-e-v",
  "venueName": "MC Fürstenwalde e.V.",
  "venueLocation": "Fürstenwalde",
  "hostId": "mc-fuerstenwalde-e-v",
  "hostName": "MC Fürstenwalde e.V.",
  "name": "Rennen",
  "from": "2026-06-27",
  "to": "2026-06-27",
  "series": [],
  "classes": [],
  "source": "dmc",
  "url": null,
  "registrationStatus": null,
  "registrationOpens": null
}
```

---

## Bugfixes seit v165

### 1. ETS-Races fälschlicherweise auf Arena33 gemappt (v~195)
**Problem:** ETS (Euro Touring Series) reist durch Europa (Trencin/SK, Apeldoorn/NL etc.), aber MyRCM listet diese Rennen unter der ETS-Organisation (Heimat: Arena33/Andernach). `detail.hostLabel` gab "Arena33" zurück → `wasExplicit = true` → `isNonDach`-Check wurde umgangen.

**Fix in `import-myrcm.js`:**
```js
// Alt:
const venue = (isNonDach && !wasExplicit) ? null : venueFromSeed(detectedVenueSeed);
// Neu:
const venue = isNonDach ? null : venueFromSeed(detectedVenueSeed);
```
→ Non-DACH-Races bekommen immer `venueId: null`, egal ob explicit match.

**Manuell gepatcht in `races.json` (main):** 9 Einträge mit falschem `venueId: "arena33-andernach"` auf `null` gesetzt:
- Euro NITRO: Apeldoorn/NL, Leno/IT, Rucphen/NL, Aigen/AT (×2)
- ETS: Apeldoorn/NL (×2), Trencin/SK (×2), EOS Trencin/SK

### 2. Event-Listener-Akkumulation in `renderAdminUnbekanntTab` (v201)
**Problem:** Listener wurden auf dem persistenten `container`-Element registriert → akkumulierten bei jedem Tab-Wechsel.

**Fix:** Entries in ein inneres `<div>` einwickeln, Listener am `wrapper = container.firstElementChild` registrieren (wird bei jedem Render neu erstellt via `innerHTML`).

---

## Datendateien

| Datei | Inhalt |
|---|---|
| `races.json` | MyRCM-Rennen (~2238, DACH) |
| `rck-races.json` | RCK-Rennen |
| `dmc-races.json` | DMC-Rennen (aus RC Cloud / künftig direkt von dmc-online.com) |
| `venues.json` | Strecken (259 Venues) |
| `hosts.json` | Clubs (256 Hosts: 176 DE + 43 AT + 37 CH) |
| `myrcm-hosts-dach.json` | Seed: 304 MyRCM-Hosts DACH (orgId, country als Vollname) |
| `venue-seeds.json` | 228 Venue-Seeds mit Koordinaten (Quelle für Geocoding) |
| `venue-unmatched.json` | Nicht zugeordnete MyRCM-Venues |
| `rck-venue-candidates.json` | RCK Venue-Kandidaten |

---

## Wichtige Stolperfallen

1. **`venues` ist Array, `markers` ist Map** — `.find()` vs `.get()`
2. **`initialRenderDone`** wird nur gesetzt wenn `venues.length > 0`
3. **`panToVisible`** setzt `lastVisibleCenter` — wichtig für Resize-Handler
4. **Kein Debounce auf `styledata`** — direkter Aufruf (sonst grüner Flash beim Tab-Wechsel)
5. **`sbPullPreferences`** ruft `setTheme` nur bei echten Änderungen auf
6. **Dev-Deploy** kopiert keine JSON-Daten — `deploy-data-dev-hetzner.yml` manuell ausführen
7. **`map.invalidateSize({ pan: false })`** in `setDrawerState` — `pan: false` ist entscheidend
8. **`import-myrcm.js`** muss auf `main` und `dev` identisch sein
9. **`myrcm-hosts-dach.json`** muss auf `main` vorhanden sein (Import-Job braucht sie)
10. **`_venueForRaceCache`** nach Datenladen leeren (`_venueForRaceCache.clear()`)
11. **`recentPastRacesForVenue`** muss `matchesCountryFilter` enthalten
12. **`hosts.json` hat `country: "AT"`**, `myrcm-hosts-dach.json` hat `country: "Austria"` → `venueCountry()` normalisiert via `_countryNameToCode`

---

## Deployment

| Workflow | Trigger | Ziel |
|---|---|---|
| `deploy-site-dev-hetzner.yml` | `dev` push | `rcracemap-dev/` (nur HTML/JS/CSS) |
| `deploy-site-main-hetzner.yml` | `main` push | `.` (root inkl. JSON) |
| `deploy-data-dev-hetzner.yml` | manuell | `rcracemap-dev/` JSON-Daten |
| `trigger-render-import.yml` | manuell | Render.com Cron-Job starten |

---

## Supabase

- URL: `https://ncsqbncxctofkmabmwku.supabase.co`
- Anon Key (öffentlich, in app.js): `sb_publishable_Y9b0eW34GzqNfG3u8JZmiA_EI7fSc6P`
- Edge Function: `send-race-notifications` — liest von Production (`rcracemap.com`)
- Tabellen: `venue_notifications` (Abos), `seen_race_notifications` (Deduplizierung)
- Notification-Test: eigene Zeilen in `seen_race_notifications` löschen, dann Import triggern

---

## Nächste offene Punkte

- [ ] **DMC-Scraper** direkt gegen `dmc-online.com` bauen (in `render-import.sh` integrieren)
- [ ] **`app.js`** lädt `dmc-races.json` noch nicht — muss noch eingebaut werden
- [ ] **Admin "Unbekannt"-Tab** DMC-Races ohne venueId anzeigen (für manuelles Geo-Nachtragen)
- [ ] AT/CH-Serien im Serienfilter ergänzen
- [ ] AT/CH-Venue-Koordinaten manuell prüfen (53 geocodierte Seeds)
