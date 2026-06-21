# Mobile Drawer — Entwicklungsprotokoll

## Ziel

Mobile Layout (<768px) komplett umbauen:
- Topbar / Navbar auf Mobile ausblenden
- Bottom Sheet Drawer mit 3 Snap-Zuständen (collapsed 64px, half 50vh, full 80px vom Viewport-Top)
- Floating hamburger Button (rund, oben links)
- Floating Ergebniszeile (oben Mitte)
- Alle Filter innerhalb des Drawers — **optisch identisch zum Desktop**
- Rennkarten im Drawer, gespiegelt aus der Desktop-Liste
- Swipe-Gesten (Touch + Maus)

---

## Versuch 1 — Doppelte Filter-HTML im Drawer

**Ansatz:** Separate mobile Filter-Elemente (`#rangeFilterMob`, `#seriesFilterMob` etc.) im Drawer-HTML anlegen. State manuell synchronisieren.

**Problem:**
- Sliding-Pill-Animation nicht reproduzierbar (eigene JS-Logik nötig)
- Visuell abweichend vom Desktop (andere Ikonenhöhe, Lupe falsch, Favoriten-Icon fehlt)
- Doppelter Code, schwer wartbar
- Seriendropdown muss manuell befüllt werden

**Status:** Verworfen

---

## Versuch 2 — Einzelne Filter-Elemente in den Drawer verschieben (DOM-Move)

**Ansatz:** Die echten Desktop-DOM-Elemente (`.topbar-range`, `#favoriteFilter`, `#registrationVisibilityFilter`, `.topbar-series`, `.topbar-search`) physisch in den `#mobFilterMount` verschieben. Auf Desktop zurückverschieben.

**Implementierung:**
```js
const _filterElements = [rangeEl, favEl, regEl, seriesEl, searchEl].map(el => ({
  el, parent: el.parentNode, next: el.nextSibling
}));

function applyMobileLayout(isMobile) {
  if (isMobile) {
    // row1: range + search; row2: favorites + registration + series
    mobFilterMount.append(row1, row2);
    _filterElements.forEach(({ el }) => row1.appendChild(el));
  } else {
    _filterElements.forEach(({ el, parent, next }) =>
      parent.insertBefore(el, next));
  }
}
```

**Kernproblem:** Nahezu alle wichtigen CSS-Regeln sind auf `.layout-prototype .topbar .something` beschränkt:
```css
.layout-prototype .topbar .segmented::before { /* Sliding Pill */ }
.layout-prototype .topbar .segmented button  { /* Button-Styles */ }
.layout-prototype .topbar-search::before     { /* Lupe-Icon */    }
```

Sobald die Elemente aus `.topbar` entfernt werden, greifen diese Regeln nicht mehr. Zusätzlich überschreibt der inline `<style>`-Block in index.html (der nach style.css geladen wird) die Drawer-spezifischen Flex-Breiten:

```css
/* inline style — höhere Kaskade als style.css */
.layout-prototype .topbar-search { flex: 0 0 clamp(280px, 17vw, 320px); }
.layout-prototype .topbar-series { flex: 0 1 clamp(260px, 20vw, 380px); }
```

`!important` in style.css konnte das teilweise überbrücken, aber der Grundansatz bleibt fehlerhaft.

**Rennkarten-Problem (separat):** Rennkarten im `#mobRaceList` (ein CSS Grid) kollabieren auf 0 Höhe. Ursache: `display: flex; overflow: hidden` auf `.layout-prototype .race-card` führt dazu, dass das Element dem Grid-Track-Sizing-Algorithmus eine intrinsische Höhe von 0 meldet → alle Inhalte werden durch `overflow: hidden` abgeschnitten. Symptom: nur der `box-shadow` sichtbar als dünne Linie.

Teilfix: `align-self: start` auf `.mob-drawer-list > .race-card` umgeht das Problem.

**Status:** Verworfen

---

## Versuch 3 — Gesamten Topbar `<header>` in den Drawer verschieben

**Ansatz:** Das gesamte `<header class="topbar">` Element (nicht nur einzelne Kinder) in den `#mobFilterMount` verschieben.

**Vorteil:** Alle CSS-Regeln mit `.topbar` im Selektor greifen weiterhin, da die Elemente weiterhin innerhalb von `.topbar` liegen.

**Implementierung:**
```js
const _topbarEl     = document.querySelector(".layout-prototype .topbar");
const _topbarParent = _topbarEl?.parentNode;
const _topbarNext   = _topbarEl?.nextSibling;

function applyMobileLayout(isMobile) {
  if (isMobile) {
    mobFilterMount.appendChild(_topbarEl);
    requestAnimationFrame(updateSlidingPills);
  } else {
    _topbarParent.insertBefore(_topbarEl, _topbarNext);
    requestAnimationFrame(updateSlidingPills);
  }
}
```

CSS-Overrides für den Drawer-Kontext:
```css
.mob-drawer-filters .topbar { flex-wrap: wrap; padding: 10px 14px 12px; }
.mob-drawer-filters .topbar::before { display: none; }
.mob-drawer-filters .topbar .app-menu-button { display: none !important; }
.mob-drawer-filters .topbar .topbar-spacer { display: none; }
.mob-drawer-filters .topbar-search { flex: 1 1 180px !important; }
.mob-drawer-filters .topbar-series { flex: 1 1 120px !important; }
```

**Aktueller Stand:** Noch nicht vollständig getestet auf dem neuen Rechner. Filter sollten jetzt korrekt aussehen. Rennkarten-Fix (`align-self: start`) ist eingebaut. Drawer-Geste (Touch + Maus) funktioniert.

**Offene Fragen / mögliche Probleme:**
1. Topbar hat Desktop-CSS (`position: relative; isolation: isolate; gap: 12px`) — könnte im Drawer-Kontext zu unerwartetem Layout führen
2. `updateSlidingPills()` muss nach dem Verschieben korrekt messen (getBoundingClientRect auf sichtbaren Elementen)
3. Auf Desktop (Resize von mobile → desktop) muss Topbar korrekt zurückversetzt werden

---

## Bekannte fixe Probleme (bereits gelöst)

| Problem | Fix |
|---|---|
| Karte hat Grünstich | `fill-opacity: 1` auf allen überschriebenen Layern |
| Rennkarten als blaue Balken (race-panel Regression) | `race-panel`: kein Flex-Container, nur `overflow-y: auto` |
| Rennkarten ohne `layout-prototype`-Styles im Drawer | `layout-prototype` Klasse auf `#mobDrawer` |
| Drawer auf Desktop verschiebbar | Touch-Events mit `mobMq.matches` Guard; Maus-Events hinzugefügt |
| Leere Rennliste beim Resize desktop→mobile | `mobMq.addEventListener('change', ...)` triggert `syncMobRaceList()` |
| Drawer öffnet bis ganz oben | `mob-drawer--full: translateY(80px)` statt `translateY(0)` |

---

## Architektur-Übersicht

```
<main class="app layout-map layout-prototype" id="app">
  <section class="map-panel">   ← Leaflet/MapLibre Karte
  <section class="filters-panel topbar-panel">
    <header class="topbar">     ← !! Wird auf Mobile in Drawer verschoben
      .app-menu-button           ← Desktop-Hamburger (auf Mobile: display:none)
      .topbar-range              ← Zeitraum-Segmented (2W / 4W / Alle)
      .topbar-series             ← Serien-Dropdown
      #favoriteFilter            ← Favoriten-Toggle
      #registrationVisibilityFilter ← Offen-Toggle
      .topbar-search             ← Suchfeld
    </header>
    <div class="topbar-chips-row">  ← Aktive Filter-Chips + Ergebniszeile
  </section>
  <aside class="race-panel">
    <section class="race-grid" id="raceList">  ← Desktop-Rennliste (Quelle)
```

```
<!-- Mobile-only, außerhalb von <main> -->
<button class="mob-menu-btn" id="mobMenuBtn">  ← Floating runder Hamburger
<div class="mob-result-badge" id="mobResultBadge">  ← Floating Ergebniszeile
<div class="mob-drawer layout-prototype" id="mobDrawer">
  <div class="mob-drawer-handle">
  <div class="mob-drawer-filters" id="mobFilterMount">
    <!-- header.topbar wird hier auf Mobile eingefügt -->
  </div>
  <div class="mob-drawer-list" id="mobRaceList">
    <!-- Geklonte Rennkarten aus #raceList -->
  </div>
  <div class="mob-drawer-footer">
```

---

## Nächste Schritte (nach Rechnerwechsel)

1. Aktuellen Stand auf neuem Rechner ausprobieren (Branch: `dev`)
2. Falls Filter immer noch nicht korrekt: Topbar-CSS in Drawer-Kontext debuggen
3. Falls Rennkarten immer noch kollabieren: `align-self: start` Regel prüfen
4. Drawer-Snap-States auf echtem Mobilgerät testen
5. Desktop-Rückversetzung beim Resize testen
