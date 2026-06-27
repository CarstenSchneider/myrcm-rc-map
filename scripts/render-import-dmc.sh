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

# Änderungen committen und pushen (nur dev — DMC noch nicht in Produktion)
git add dmc-races.json dmc-venues.json dmc-debug-html.json 2>/dev/null || true
if git diff --staged --quiet; then
  echo "Keine Änderungen — kein Commit nötig."
else
  git commit -m "Update DMC race data"
  git pull --rebase --autostash origin dev
  git push origin dev
  echo "dmc-races.json auf dev gepusht."
fi

echo "=== DMC Import abgeschlossen — $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
