#!/bin/bash
set -e

echo "=== RC RaceMap Import — $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="

# Git konfigurieren
git config user.name "render-import[bot]"
git config user.email "render-import[bot]@rcracemap.com"
git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/carstenschneider/myrcm-rc-map.git" 2>/dev/null || \
git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/carstenschneider/myrcm-rc-map.git"

git fetch origin main dev
git checkout -f -B main origin/main

# Dev-only venue seeds in main mergen (neue Seeds die noch nicht auf main sind)
node -e "
  const fs = require('fs');
  const { execSync } = require('child_process');
  try {
    const mainSeeds = JSON.parse(fs.readFileSync('venue-seeds.json', 'utf8'));
    const devSeedsRaw = execSync('git show origin/dev:venue-seeds.json').toString();
    const devSeeds = JSON.parse(devSeedsRaw);
    const mainIds = new Set(mainSeeds.map(s => s.id || s.hostId).filter(Boolean));
    const newSeeds = devSeeds.filter(s => {
      const id = s.id || s.hostId;
      return id && !mainIds.has(id);
    });
    if (newSeeds.length > 0) {
      const merged = [...mainSeeds, ...newSeeds];
      fs.writeFileSync('venue-seeds.json', JSON.stringify(merged, null, 2) + '\n');
      console.log('Merged ' + newSeeds.length + ' dev-only seeds into venue-seeds.json');
    } else {
      console.log('No dev-only seeds to merge');
    }
  } catch (e) {
    console.log('Could not merge dev seeds (non-fatal):', e.message);
  }
"

# Alte races.json für Diff sichern (vor dem Import)
cp races.json /tmp/old-races.json 2>/dev/null || echo "[]" > /tmp/old-races.json

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

echo "--- Discover CZ clubs ---"
if node scripts/discover-myrcm-cz.js; then
  echo "✓ CZ Discovery erfolgreich"
else
  echo "✗ CZ Discovery FEHLGESCHLAGEN — myrcm-hosts-cz.json unverändert"
fi

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

# main: alle Importdaten committen
MAIN_FILES="races.json hosts.json venues.json venue-unmatched.json venue-seeds.json rck-races.json rck-unmatched-venues.json rck-venue-candidates.json rck-pdf-cache.json myrcm-hosts-cz.json"
DMC_FILES="dmc-races.json dmc-venues.json dmc-pdf-cache.json"
git add $MAIN_FILES
[ "$IMPORT_DMC_OK" = "1" ]   && git add $DMC_FILES
if git diff --staged --quiet; then
  echo "Keine Änderungen (main) — kein Commit nötig."
else
  git commit -m "Update race data $(date -u '+%Y-%m-%d %H:%M UTC')"
  git pull --rebase --autostash origin main
  git push origin main
  echo "Daten auf main gepusht."
fi

# dev: Daten von main übertragen
git fetch origin dev
git checkout -f -B dev origin/dev
git checkout main -- $MAIN_FILES
[ "$IMPORT_DMC_OK" = "1" ]   && git checkout main -- $DMC_FILES

git add $MAIN_FILES
[ "$IMPORT_DMC_OK" = "1" ]   && git add $DMC_FILES
if git diff --staged --quiet; then
  echo "Keine Änderungen (dev) — kein Commit nötig."
else
  git commit -m "Update race data DEV $(date -u '+%Y-%m-%d %H:%M UTC')"
  git pull --rebase --autostash origin dev
  git push origin dev
  echo "Daten auf dev gepusht."
fi

git checkout -f main

# Änderungen gegenüber alten races.json berechnen
echo "--- Berechne Renndaten-Änderungen ---"
RACE_CHANGES=$(node scripts/diff-races.js /tmp/old-races.json races.json 2>/dev/null || echo "[]")
RACE_CHANGES_COUNT=$(echo "$RACE_CHANGES" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).length))" 2>/dev/null || echo "0")
echo "Erkannte Änderungen: $RACE_CHANGES_COUNT"

# Benachrichtigungen senden
echo "--- Sende Benachrichtigungen ---"
HTTP_CODE=$(curl --silent \
  --output /tmp/notif-body.txt \
  --write-out "%{http_code}" \
  --request POST \
  --url "https://ncsqbncxctofkmabmwku.supabase.co/functions/v1/send-race-notifications" \
  --header "Authorization: Bearer sb_publishable_Y9b0eW34GzqNfG3u8JZmiA_EI7fSc6P" \
  --header "Content-Type: application/json" \
  --data "{\"changes\":$RACE_CHANGES}")
echo "HTTP $HTTP_CODE"
cat /tmp/notif-body.txt
if [ "$HTTP_CODE" -ge 400 ]; then
  echo "Benachrichtigung fehlgeschlagen (HTTP $HTTP_CODE)"
  exit 1
fi
echo "Benachrichtigungen erfolgreich versendet."
echo "=== Import abgeschlossen — $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
