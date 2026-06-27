#!/bin/bash
set -e

echo "=== DMC Import — $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="

# Git konfigurieren
git config user.name "render-import[bot]"
git config user.email "render-import[bot]@rcracemap.com"
git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/carstenschneider/myrcm-rc-map.git" 2>/dev/null || \
git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/carstenschneider/myrcm-rc-map.git"

git fetch origin main dev
git checkout -B main origin/main

# DMC importieren
echo "--- Import DMC ---"
node import-dmc.js

# Änderungen committen und pushen
git add dmc-races.json
if git diff --staged --quiet; then
  echo "Keine Änderungen — kein Commit nötig."
else
  git commit -m "Update DMC race data"
  git pull --rebase --autostash origin main
  git push origin main

  git fetch origin dev
  git checkout -B dev origin/dev
  git checkout main -- dmc-races.json
  git commit -m "Update DMC race data"
  git pull --rebase --autostash origin dev
  git push origin dev

  git checkout main
  echo "dmc-races.json auf main und dev gepusht."
fi

echo "=== DMC Import abgeschlossen — $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
