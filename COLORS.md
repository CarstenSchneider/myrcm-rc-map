# Farbsystem — myrcm-rc-map

Verbindlicher Stand: 2026-06-19. Alle Farbänderungen müssen hier dokumentiert werden.

---

## CSS-Variablen (style.css :root)

| Variable | Tagmodus | Nachtmodus |
|---|---|---|
| `--bg` | `#F5F5F5` | `#0b1120` |
| `--panel` | `#FFFFFF` | `#111c33` |
| `--card` | `#FFFFFF` | `#152039` |
| `--card-closed` | `#e4e4e4` | `#0d1628` |
| `--pill-bg` | `#ebebeb` | `#1a2a45` |
| `--text` | `#1f1d1a` | `#d8e0f0` |
| `--muted` | `#716F6F` | `#7b8daa` |
| `--muted-light` | `#aaaaaa` | `#4f6180` |
| `--muted-alt` | `#5f5648` | `#8a9db8` |
| `--muted-warm` | `#756b5c` | `#7a90ae` |
| `--host-blue` | `#213769` | `#4569a5` |
| `--accent` | `#213769` | `#4569a5` |
| `--favorite` | `#C8B090` | `#c8b090` |
| `--status-open` | `#73FF60` | `#73FF60` |
| `--status-closed` | `#E51354` | `#E51354` |
| `--status-upcoming` | `#FFA700` | `#FFA700` |

---

## Kartenfarben (app.js rcRaceMapColorsLight / rcRaceMapColorsDark)

| Element | Tagmodus | Nachtmodus |
|---|---|---|
| Wasser | `#ffffff` | `#0c1829` |
| Land | `#f4f4f4` | `#0f1e35` |
| Siedlung | `#ebebeb` | `#132442` |
| Landbedeckung | `#f4f4f4` | `#0e1c32` |
| Gebäude | `#f4f4f4` | `#132442` |
| Straßen (Haupt) | `#d4d4d4` | `#1e3a5f` |
| Straßen (Neben) + Bahn | `#cccccc` | `#1e3a5f` |
| Grenzen | `#d8d8d8` | `#1e3a5f` |
| Ortsbezeichnungen | `#716F6F` | `#6a9fd8` |
| Ortsbezeichnungen Halo | `#ebebeb` | `#0f1e35` |
| Kartenpin aktiv | `#213769` | `#4569a5` |
| Kartenpin geschlossen | `#9a9795` | `#607080` |
| Kartenpin Favorit | `#C8B090` | `#c8b090` |

---

## UI-Zustände (Rennkarten)

### Offene Nennung (registration-open)

| Element | Tagmodus | Nachtmodus |
|---|---|---|
| Pillen Hintergrund | `var(--pill-bg)` = `#ebebeb` | `#4d68a1` |
| Pillen Text | `var(--host-blue)` = `#213769` | `#172037` |

### Geschlossene Nennung (registration-closed)

| Element | Tagmodus | Nachtmodus |
|---|---|---|
| Datum, Name, Ort, Fahrerzahl, Status-Text | `var(--muted)` = `#716F6F` | `#3d5380` |
| Statusdot ("Nennung geschlossen") | `#9a9795` | `#3d5380` |
| Pillen Hintergrund | `var(--muted)` = `#716F6F` | `var(--card)` = `#152039` |
| Pillen Text | `var(--bg)` = `#F5F5F5` | `#3d5380` |
| Karten-Hintergrund | `rgba(244,240,233,0.94)` | *(unverändert)* |
| Kartenrahmen | `rgba(222,214,202,0.7)` | *(unverändert)* |

### Kartenpin — Zustände

| Zustand | Tag | Nacht | Pin-Hintergrundlayer |
|---|---|---|---|
| Aktive Nennung | `#213769` | `#4569a5` | weiß |
| Favorit (egal ob aktiv) | `#C8B090` | `#c8b090` | weiß |
| Geschlossen, kein Favorit | `#9a9795` | `#607080` | transparent |

---

## Topbar (Nachtmodus)

| Element | Tagmodus | Nachtmodus |
|---|---|---|
| Topbar Hintergrund | *(Standard)* | `var(--pill-bg)` = `#1a2a45` |
| Burger-Button Hintergrund | *(Standard)* | `var(--pill-bg)` = `#1a2a45` |
| Segmente / Filter-Pillen | *(Standard)* | `var(--panel)` = `#111c33` |
| Suchfeld Hintergrund | *(Standard)* | `var(--panel)` = `#111c33` |
| Suchfeld Platzhaltertext | *(Standard)* | `var(--accent)` = `#4569a5` |
| Suchfeld Eingabetext | *(Standard)* | `var(--text)` = `#d8e0f0` |

---

## Regeln

- Alle Farbwerte für UI-Zustände werden als Hex-Konstanten gesetzt, **nie** über CSS-Variablen die im falschen Modus falsch auflösen können (z.B. `--muted` ist im Nachtmodus blau-grau, nicht grau).
- Statusfarben (open/closed/upcoming) gelten nur für die Status-Indikatoren, nie für Card-Elemente im geschlossenen Zustand.
- Nachtmodus-Änderungen immer parallel mit Tagmodus dokumentieren und testen — beide Modi müssen explizit geprüft werden.
- Nach jeder Änderung sofort zu GitHub pushen und live testen.
