#!/bin/bash
set -e

echo "=== RC RaceMap Import — $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="

# Git konfigurieren
git config user.name "render-import[bot]"
git config user.email "render-import[bot]@rcracemap.com"
git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/carstenschneider/myrcm-rc-map.git" 2>/dev/null || \
git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/carstenschneider/myrcm-rc-map.git"

# Aktuellen Stand von main holen und lokalen main-Branch anlegen
git fetch origin main dev
git checkout -B main origin/main

# MyRCM-Verfügbarkeit prüfen (max. 3 Versuche × 5 Min = 15 Min)
for i in 1 2 3; do
  echo "MyRCM-Check Versuch $i/3 — $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  if curl --fail --silent --location \
    --connect-timeout 15 --max-time 30 \
    https://www.myrcm.ch/ > /dev/null; then
    echo "MyRCM erreichbar."
    break
  fi
  if [ "$i" -lt 3 ]; then
    echo "Nicht erreichbar — warte 5 Minuten..."
    sleep 300
  else
    echo "MyRCM nach 3 Versuchen nicht erreichbar — Import abgebrochen."
    exit 1
  fi
done

# RCK importieren
echo "--- Import RCK ---"
RCK_GEOCODE=0 node import-rck.js

# MyRCM importieren
echo "--- Import MyRCM ---"
node --no-warnings import-myrcm.js

# Änderungen committen und pushen
ALL_FILES="races.json hosts.json venues.json venue-unmatched.json venue-seeds.json rck-races.json rck-unmatched-venues.json rck-venue-candidates.json"

git add $ALL_FILES
if git diff --staged --quiet; then
  echo "Keine Änderungen — kein Commit nötig."
else
  git commit -m "Update race data"
  git pull --rebase origin main
  git push origin main

  git fetch origin dev
  git checkout -B dev origin/dev
  git checkout main -- $ALL_FILES
  git commit -m "Update race data"
  git pull --rebase origin dev
  git push origin dev

  git checkout main
  echo "Daten auf main und dev gepusht."
fi

# Benachrichtigungen senden
echo "--- Sende Benachrichtigungen ---"
HTTP_CODE=$(curl --silent \
  --output /tmp/notif-body.txt \
  --write-out "%{http_code}" \
  --request POST \
  --url "https://ncsqbncxctofkmabmwku.supabase.co/functions/v1/send-race-notifications" \
  --header "Authorization: Bearer sb_publishable_Y9b0eW34GzqNfG3u8JZmiA_EI7fSc6P" \
  --header "Content-Type: application/json")
echo "HTTP $HTTP_CODE"
cat /tmp/notif-body.txt
if [ "$HTTP_CODE" -ge 400 ]; then
  echo "Benachrichtigung fehlgeschlagen (HTTP $HTTP_CODE)"
  exit 1
fi
echo "Benachrichtigungen erfolgreich versendet."
echo "=== Import abgeschlossen — $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
