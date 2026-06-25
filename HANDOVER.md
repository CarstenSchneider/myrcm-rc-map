# Übergabe-Notizen: Country-Filter-Pill (Stand: v165, Branch `dev`)

Letzter Commit auf `dev`: **v165** (25. Juni 2026)

---

## Was wurde implementiert

### Länderfilter-Pille (`country-pill`)
- Weiße Pille, `position: fixed`, links unter dem Locate-Button auf der Karte
- Klappt nach rechts auf (`max-width` Transition mit `overflow: hidden`)
- Erstes Click → expandiert. Zweites Click → wählt Land, kollabiert
- Mouse-Enter/Leave expandiert/kollabiert ebenfalls (Desktop-Hover)
- Flaggen via [`flag-icons` CDN](https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/css/flag-icons.min.css) — Klassen: `fi fi-XX fis country-flag-icon`
- Hover-Scale **nur** für nicht-aktive Flaggen: `.country-pill-btn:not(.is-active):hover`
- Nachtmodus: `var(--pill-bg)` = `#1a2a45` — identisch zu `mob-menu-btn` und `locate-btn`

**Positionen:**

| Screen | `top` | `height` | Berechnung |
|---|---|---|---|
| Mobile ≤860px | 136px | 52px | 74 (locate-top) + 52 (locate-h) + 10 gap |
| Desktop >860px | 140px | 40px | 14 (filters-panel) + 68 (topbar) + 8 (grid gap) + 40 (chips-row) + 10 gap |

### Locate-Button
- **Desktop**: JS verschiebt Button in `#locateDesktopSlot` (in `.topbar-chips-row`)
- **Mobile**: JS hängt Button an `document.body`; CSS `position: fixed; top: 74px; left: 14px`
- Beim Breakpoint-Crossing (Resize über/unter 860px) wird der Button umgehängt (Resize-Handler in `app.js` ~Zeile 4100)

### Länderfilter-Logik (`app.js`)
- `let selectedCountry = "all"` — deklariert bei Zeile ~54 (VOR `countryFlags`-Array — wichtig wegen TDZ!)
- `countryFlags` Array mit `{ country, code, label }` — `code` = ISO 3166-1 alpha-2 für flag-icons
- `matchesCountryFilter(race)` → prüft `hostsByOrgId.get(String(venue.myrcmOrgId))?.country`
- `filteredRaces()` enthält `.filter(r => matchesCountryFilter(r))`

---

## Noch offene Punkte

### 1. `hosts.json` braucht `country`-Feld (Import ausstehend)
Das Feld `country` in `hosts.json` wurde noch **nicht** für alle Clubs gesetzt. Der AT/CH-Filter macht daher derzeit nichts. Wird beim nächsten `import-races.yml`-Lauf automatisch nachgezogen.

→ Nach dem nächsten Import: **`deploy-data-dev-hetzner.yml`** manuell triggern, damit dev die frischen JSON-Daten bekommt.

### 2. Desktop-Pill-Position ggf. fein justieren
Aktuelle Berechnung ergibt `top: 140px`. Falls der Locate-Button optisch anders sitzt als erwartet: Wert in `.country-pill` (in `style.css`) anpassen.

### 3. AT/CH-Serien fehlen im Serienfilter
Der `seriesFilter`-Dropdown zeigt aktuell nur DE-Serien. AT/CH-Serien aus `series.json` müssen noch ergänzt werden.

### 4. AT/CH-Venues: Koordinaten-Review steht aus
53 geocodierte Seed-Venues für AT/CH wurden noch nicht manuell geprüft.

### 5. Flag-Icons vom externen CDN
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/css/flag-icons.min.css" />
```
Fällt das CDN aus, fehlen die Flaggen. Ggf. lokal ins Repo kopieren.

---

## Technische Referenz

### Geänderte Dateien

| Datei | Was |
|---|---|
| `app.js` | `selectedCountry` früher deklariert; `countryFlags`; `updateCountryPill()`; `matchesCountryFilter()`; `venueCountry()`; `_countryPill`-Init via `document.body.appendChild`; Locate-Slot-Verschiebung (Desktop/Mobile) |
| `style.css` | `.country-pill`, `.country-pill-btn`, `.country-flag-icon`; Dark-Mode-Regeln für Pill + Locate global; Mobile Locate `position:fixed` |
| `index.html` | `flag-icons` CDN `<link>`; `#locateDesktopSlot` div in `.topbar-chips-row`; `app.js?v=165` |

### Versionsstand
- `app.js` → `v165` (Cache-Buster in `index.html`: `<script src="app.js?v=165">`)
- `style.css` → `v108` (Cache-Buster: `<link href="style.css?v=108">`)
- Bei jeder Änderung an `app.js` den `?v=`-Wert in `index.html` hochzählen

### Branch-Regeln (WICHTIG)
- **Nur auf `dev` arbeiten** — nie direkt auf `main` committen
- `dev` → deployt automatisch auf `dev.rcracemap.com` (GitHub Action)
- `main` → Production `rcracemap.com` (nur via explizitem Merge von `dev`)
- Nach jeder Änderung sofort pushen — User testet ausschließlich auf `dev.rcracemap.com`

### Pill-HTML (generiert in `updateCountryPill()`)
```html
<div class="country-pill [is-expanded]">
  <!-- aktive Flagge immer zuerst (links) -->
  <button class="country-pill-btn is-active" data-country="all">
    <span class="fi fi-eu fis country-flag-icon" aria-hidden="true"></span>
  </button>
  <button class="country-pill-btn" data-country="DE">
    <span class="fi fi-de fis country-flag-icon" aria-hidden="true"></span>
  </button>
  <button class="country-pill-btn" data-country="AT">
    <span class="fi fi-at fis country-flag-icon" aria-hidden="true"></span>
  </button>
  <button class="country-pill-btn" data-country="CH">
    <span class="fi fi-ch fis country-flag-icon" aria-hidden="true"></span>
  </button>
</div>
```

### Dark-Mode-Variablen
```css
:root.theme-dark {
  --pill-bg: #1a2a45;   /* Hamburger + Locate + Country-Pill */
  --panel:   #111c33;   /* Panel-Hintergrund */
  --panel-rgb: 17, 28, 51;
}
```

### Wichtige Stolperfallen (aus CLAUDE.md)
1. `let selectedCountry` muss VOR `countryFlags` deklariert sein (TDZ!)
2. `venues` ist Array (`.find()`), `markers` ist Map (`.get()`)
3. `panToVisible` setzt `lastVisibleCenter` — wichtig für Resize-Handler
4. **Kein Debounce** auf `styledata` — direkter Aufruf (sonst grüner Flash)
5. `map.invalidateSize({ pan: false })` — `pan: false` ist entscheidend
6. Dev-Deploy kopiert keine JSON-Daten — `deploy-data-dev-hetzner.yml` manuell

---

## Test-Checkliste

- [ ] Mobile: Pill erscheint unter Locate-Button, kein Überlapp mit Zoom-Controls
- [ ] Desktop: Pill erscheint unter dem topbar-chips-row (Locate-Button im Slot sichtbar)
- [ ] Click 1 auf Pill → expandiert (alle 4 Flaggen sichtbar)
- [ ] Click 2 auf Flagge → Land gewählt, Pill kollabiert, Rennen gefiltert
- [ ] Hover auf nicht-aktive Flagge → Scale 1.08
- [ ] Hover auf aktive Flagge (links) → kein Effekt
- [ ] Nachtmodus: Hamburger, Locate, Pill gleiche Farbe (`#1a2a45`)
- [ ] Tagmodus: Pill weiß, Flaggen mit sichtbarem weißen Rand um die Flagge
- [ ] Tab-Wechsel: kein grüner Flash (kein `setStyle()` bei Token-Refresh)
- [ ] Nach Länder-Import: DE/AT/CH-Filter filtert korrekt
