#!/bin/bash
set -e

echo "=== RC RaceMap Import — $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="

# Git konfigurieren
git config user.name "render-import[bot]"
git config user.email "render-import[bot]@rcracemap.com"
git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/carstenschneider/myrcm-rc-map.git" 2>/dev/null || \
git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/carstenschneider/myrcm-rc-map.git"

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

# Importers unabhängig voneinander ausführen — ein Fehler stoppt nicht die anderen
IMPORT_RCK_OK=0
IMPORT_MYRCM_OK=0
IMPORT_DMC_OK=0

echo "--- Import RCK ---"
if RCK_GEOCODE=0 node import-rck.js; then
  IMPORT_RCK_OK=1
  echo "✓ RCK Import erfolgreich"
else
  echo "✗ RCK Import FEHLGESCHLAGEN — rck-races.json wird nicht aktualisiert"
fi

echo "--- Import MyRCM ---"
if node --no-warnings import-myrcm.js; then
  IMPORT_MYRCM_OK=1
  echo "✓ MyRCM Import erfolgreich"
else
  echo "✗ MyRCM Import FEHLGESCHLAGEN — races.json wird nicht aktualisiert"
fi

echo "--- Import DMC ---"
if node import-dmc.js; then
  IMPORT_DMC_OK=1
  echo "✓ DMC Import erfolgreich"
else
  echo "✗ DMC Import FEHLGESCHLAGEN — dmc-races.json wird nicht aktualisiert"
fi

# Zusammenfassung
echo ""
echo "=== Import-Status ==="
[ "$IMPORT_RCK_OK" = "1" ]   && echo "✓ RCK"   || echo "✗ RCK"
[ "$IMPORT_MYRCM_OK" = "1" ] && echo "✓ MyRCM" || echo "✗ MyRCM"
[ "$IMPORT_DMC_OK" = "1" ]   && echo "✓ DMC"   || echo "✗ DMC"

# Mindestens MyRCM muss erfolgreich sein für einen Commit auf main
if [ "$IMPORT_MYRCM_OK" = "0" ]; then
  echo "MyRCM fehlgeschlagen — kein Commit auf main."
  exit 1
fi

# main: MyRCM + RCK Daten committen
MAIN_FILES="races.json hosts.json venues.json venue-unmatched.json venue-seeds.json rck-races.json rck-unmatched-venues.json rck-venue-candidates.json rck-pdf-cache.json"
git add $MAIN_FILES
if git diff --staged --quiet; then
  echo "Keine Änderungen (main) — kein Commit nötig."
else
  git commit -m "Update race data"
  git pull --rebase --autostash origin main
  git push origin main
  echo "Daten auf main gepusht."
fi

# dev: alle Daten inkl. DMC committen
git fetch origin dev
git checkout -B dev origin/dev
git checkout main -- $MAIN_FILES

DEV_EXTRA_FILES="rck-pdf-cache.json"
[ "$IMPORT_DMC_OK" = "1" ] && DEV_EXTRA_FILES="$DEV_EXTRA_FILES dmc-races.json dmc-venues.json dmc-pdf-cache.json"

git add $MAIN_FILES $DEV_EXTRA_FILES
if git diff --staged --quiet; then
  echo "Keine Änderungen (dev) — kein Commit nötig."
else
  git commit -m "Update race data"
  git pull --rebase --autostash origin dev
  git push origin dev
  echo "Daten auf dev gepusht."
fi

git checkout main

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
