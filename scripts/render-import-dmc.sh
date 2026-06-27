#!/bin/bash
set -e

echo "=== DMC Import — $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="

# Git konfigurieren
git config user.name "render-import[bot]"
git config user.email "render-import[bot]@rcracemap.com"
git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/carstenschneider/myrcm-rc-map.git" 2>/dev/null || \
git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/carstenschneider/myrcm-rc-map.git"

git fetch origin dev
git checkout -f -B dev origin/dev

# DMC importieren
echo "--- Import DMC ---"
node import-dmc.js

# Debug-HTML immer committen falls vorhanden (unabhängig von Renndaten)
if [ -f dmc-debug-html.json ]; then
  git add dmc-debug-html.json
  git commit -m "debug: DMC Sportkreis page HTML dump" || true
  git pull --rebase --autostash origin dev
  git push origin dev
  echo "dmc-debug-html.json gepusht."
fi

# Renndaten committen
git add dmc-races.json dmc-venues.json
if git diff --staged --quiet; then
  echo "Keine Änderungen — kein Commit nötig."
else
  git commit -m "Update DMC race data"
  git pull --rebase --autostash origin dev
  git push origin dev
  echo "dmc-races.json auf dev gepusht."
fi

echo "=== DMC Import abgeschlossen — $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
