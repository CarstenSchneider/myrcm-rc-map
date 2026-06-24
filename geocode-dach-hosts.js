#!/usr/bin/env node
// Geocodes AT/CH hosts from myrcm-hosts-dach.json and adds them to venue-seeds.json.
// Run locally: node geocode-dach-hosts.js
// Only adds hosts not already in venue-seeds.json (checked by myrcmOrgId).

import { readFile, writeFile } from "fs/promises";

const DELAY_MS = 3000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function slugify(s) {
  return s.toLowerCase()
    .replace(/[äÄ]/g, "ae").replace(/[öÖ]/g, "oe").replace(/[üÜ]/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function geocode(name, city, country) {
  const query = city ? `${name}, ${city}, ${country}` : `${name}, ${country}`;
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "rcracemap.com geocoder/1.0" }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const feat = data?.features?.[0];
  if (!feat) return null;
  const [lng, lat] = feat.geometry.coordinates;
  return { lat, lng, display: feat.properties?.name || query };
}

const raw = await readFile("myrcm-hosts-dach.json", "utf8");
const allHosts = JSON.parse(raw);
const seeds = JSON.parse(await readFile("venue-seeds.json", "utf8"));

const existingOrgIds = new Set(seeds.map(s => String(s.myrcmOrgId || "")).filter(Boolean));

const targetHosts = allHosts.filter(h => {
  const c = (h.country || "").toLowerCase();
  const isAT = c.includes("austria") || c.includes("österreich");
  const isCH = c.includes("switzerland") || c.includes("schweiz");
  return (isAT || isCH) && !existingOrgIds.has(String(h.orgId));
});

console.log(`AT/CH Hosts nicht in venue-seeds.json: ${targetHosts.length}`);

let added = 0, failed = 0;

for (const host of targetHosts) {
  const countryCode = (host.country || "").toLowerCase().includes("austria") ? "Austria" : "Switzerland";
  process.stdout.write(`  ${host.name} (${host.location}, ${countryCode})... `);

  await sleep(DELAY_MS);
  let geo = null;
  try {
    geo = await geocode(host.name, host.location || "", countryCode);
    if (!geo) geo = await geocode(host.location || host.name, countryCode, "");
  } catch (e) {
    console.log(`FEHLER: ${e.message}`);
    failed++;
    continue;
  }

  if (!geo) {
    console.log("nicht gefunden");
    failed++;
    continue;
  }

  const id = slugify(host.name);
  const seed = {
    id,
    name: host.name,
    city: host.location || "",
    lat: geo.lat,
    lng: geo.lng,
    hostIds: [id],
    source: "geocoded-nominatim-dach",
    myrcmOrgId: String(host.orgId),
    aliases: [`myrcm-${host.orgId}`, host.name, host.location || ""].filter(Boolean)
  };
  seeds.push(seed);
  added++;
  console.log(`OK (${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)})`);
}

await writeFile("venue-seeds.json", JSON.stringify(seeds, null, 2), "utf8");
console.log(`\nFertig: ${added} hinzugefügt, ${failed} fehlgeschlagen. venue-seeds.json hat jetzt ${seeds.length} Einträge.`);
