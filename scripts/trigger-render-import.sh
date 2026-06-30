#!/bin/bash
# Trigger a manual run of the render.com import cron job
# Requires RENDER_API_KEY environment variable

SERVICE_ID="crn-d8v9a4bsq97s73827f8g"

if [ -z "$RENDER_API_KEY" ]; then
  echo "Error: RENDER_API_KEY not set"
  exit 1
fi

echo "Triggering render.com import run..."
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  "https://api.render.com/v1/services/${SERVICE_ID}/jobs")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -1)

echo "HTTP $HTTP_CODE"
echo "$BODY"

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "✓ Import run triggered successfully"
else
  echo "✗ Failed to trigger import run"
  exit 1
fi
