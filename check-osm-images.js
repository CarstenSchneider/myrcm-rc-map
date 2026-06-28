#!/usr/bin/env node
// Queries Overpass API for OSM nodes near each venue and looks for image tags.
// Run: node check-osm-images.js

import { readFileSync, writeFileSync } from "fs";
import { setTimeout as sleep } from "timers/promises";

const RADIUS_M = 200;
const DELAY_MS = 1000; // be polite to Overpass
const TIMEOUT_MS = 15000;
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const IMAGE_TAGS = ["image", "wikimedia_commons", "mapillary", "image:0", "image:1"];
const RELEVANT_TAGS = [
  ["leisure", "sports_centre"],
  ["leisure", "pitch"],
  ["leisure", "track"],
  ["sport", "rc_car"],
  ["sport", "model_aerodrome"],
  ["amenity", "parking"], // sometimes RC tracks tagged as parking
];

function buildQuery(lat, lng) {
  const tagFilters = RELEVANT_TAGS
    .map(([k, v]) => `node["${k}"="${v}"](around:${RADIUS_M},${lat},${lng});`)
    .join("\n  ");
  // Also search without tag filter to catch anything nearby
  return `[out:json][timeout:10];
(
  ${tagFilters}
  way["sport"="rc_car"](around:${RADIUS_M},${lat},${lng});
  way["leisure"="track"](around:${RADIUS_M},${lat},${lng});
  relation["sport"="rc_car"](around:${RADIUS_M},${lat},${lng});
);
out tags;`;
}

async function queryOverpass(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      body: "data=" + encodeURIComponent(query),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractImages(elements) {
  const results = [];
  for (const el of elements) {
    const tags = el.tags || {};
    const images = {};
    for (const key of IMAGE_TAGS) {
      if (tags[key]) images[key] = tags[key];
    }
    if (Object.keys(images).length > 0) {
      results.push({
        osmType: el.type,
        osmId: el.id,
        name: tags.name || null,
        sport: tags.sport || null,
        leisure: tags.leisure || null,
        images,
      });
    }
  }
  return results;
}

async function run() {
  const venues = JSON.parse(readFileSync("venues.json", "utf8"));
  console.log(`Checking ${venues.length} venues against Overpass API...\n`);

  const results = [];
  let found = 0;

  for (let i = 0; i < venues.length; i++) {
    const venue = venues[i];
    const { lat, lng, id, name } = venue;
    if (!lat || !lng) continue;

    const query = buildQuery(lat, lng);
    const data = await queryOverpass(query);

    if (data?.elements?.length > 0) {
      const images = extractImages(data.elements);
      if (images.length > 0) {
        found++;
        console.log(`✓ ${name}`);
        for (const img of images) {
          for (const [k, v] of Object.entries(img.images)) {
            console.log(`  [${k}] ${v.slice(0, 90)}`);
          }
        }
        results.push({ venueId: id, venueName: name, lat, lng, osmMatches: images });
      }
    }

    process.stdout.write(`\r[${i + 1}/${venues.length}] Treffer: ${found}  `);
    await sleep(DELAY_MS);
  }

  console.log(`\n\n=== Ergebnis ===`);
  console.log(`Venues mit OSM-Bildern: ${found} / ${venues.length}`);

  writeFileSync("osm-images-result.json", JSON.stringify(results, null, 2) + "\n");
  console.log(`\nosm-images-result.json geschrieben`);
}

run().catch(e => { console.error(e); process.exit(1); });
