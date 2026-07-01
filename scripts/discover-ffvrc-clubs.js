#!/usr/bin/env node
/**
 * Scrapes FFVRC "Trouver un club" department pages and enriches ffvrc-venues.json
 * with addresses, website URLs, and practice venue coordinates.
 * Extracts the structured `arrayCarte` JSON embedded in each dept page — no CSS selectors.
 * Runs on render.com where ffvrc.fr is accessible.
 * Usage: node scripts/discover-ffvrc-clubs.js
 */

import { readFile, writeFile } from "node:fs/promises";

const BASE = "https://www.ffvrc.fr";
const VENUES_FILE = "ffvrc-venues.json";
const TIMEOUT_MS = 15000;
const CONCURRENCY = 3;

const DEPARTMENTS = {
  "01":"ain","02":"aisne","03":"allier","04":"alpes-de-haute-provence",
  "05":"hautes-alpes","06":"alpes-maritimes","07":"ardeche","08":"ardennes",
  "09":"ariege","10":"aube","11":"aude","12":"aveyron","13":"bouches-du-rhone",
  "14":"calvados","15":"cantal","16":"charente","17":"charente-maritime",
  "18":"cher","19":"correze","2A":"corse-du-sud","2B":"haute-corse",
  "21":"cote-dor","22":"cotes-darmor","23":"creuse","24":"dordogne",
  "25":"doubs","26":"drome","27":"eure","28":"eure-et-loir","29":"finistere",
  "30":"gard","31":"haute-garonne","32":"gers","33":"gironde","34":"herault",
  "35":"ille-et-vilaine","36":"indre","37":"indre-et-loire","38":"isere",
  "39":"jura","40":"landes","41":"loir-et-cher","42":"loire","43":"haute-loire",
  "44":"loire-atlantique","45":"loiret","46":"lot","47":"lot-et-garonne",
  "48":"lozere","49":"maine-et-loire","50":"manche","51":"marne",
  "52":"haute-marne","53":"mayenne","54":"meurthe-et-moselle","55":"meuse",
  "56":"morbihan","57":"moselle","58":"nievre","59":"nord","60":"oise",
  "61":"orne","62":"pas-de-calais","63":"puy-de-dome","64":"pyrenees-atlantiques",
  "65":"hautes-pyrenees","66":"pyrenees-orientales","67":"bas-rhin","68":"haut-rhin",
  "69":"rhone","70":"haute-saone","71":"saone-et-loire","72":"sarthe",
  "73":"savoie","74":"haute-savoie","75":"paris","76":"seine-maritime",
  "77":"seine-et-marne","78":"yvelines","79":"deux-sevres","80":"somme",
  "81":"tarn","82":"tarn-et-garonne","83":"var","84":"vaucluse",
  "85":"vendee","86":"vienne","87":"haute-vienne","88":"vosges",
  "89":"yonne","90":"territoire-de-belfort","91":"essonne","92":"hauts-de-seine",
  "93":"seine-saint-denis","94":"val-de-marne","95":"val-doise",
  "971":"guadeloupe","972":"martinique","973":"guyane","974":"la-reunion",
  "976":"mayotte","991":"monaco",
};

async function fetchHtml(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; rcracemap-importer/1.0; +https://rcracemap.com)" },
    });
    clearTimeout(timer);
    if (!res.ok) { console.warn(`  HTTP ${res.status} ${url}`); return null; }
    return await res.text();
  } catch (e) {
    clearTimeout(timer);
    console.warn(`  ERROR ${url}: ${e.message}`);
    return null;
  }
}

function slugify(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function normalizeForMatch(s) {
  return (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// Extract the `arrayCarte` JSON variable embedded in the page HTML.
// Uses bracket counting so nested objects/arrays don't break parsing.
function extractArrayCarte(html) {
  const marker = "var arrayCarte = ";
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) return null;

  let pos = html.indexOf("[", startIdx + marker.length);
  if (pos === -1) return null;

  let depth = 0, inStr = false, strChar = "", escape = false;
  for (let i = pos; i < html.length; i++) {
    const c = html[i];
    if (escape) { escape = false; continue; }
    if (inStr) {
      if (c === "\\") { escape = true; continue; }
      if (c === strChar) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; strChar = c; continue; }
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(pos, i + 1)); }
        catch (e) { console.warn(`  JSON parse error: ${e.message}`); return null; }
      }
    }
  }
  return null;
}

function normalizeUrl(raw) {
  if (!raw) return "";
  const s = raw.trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return `https://${s}`;
}

function joinAddress(...parts) {
  return parts.map(p => (p || "").trim()).filter(Boolean).join(", ");
}

async function scrapeDept(deptNum, slug) {
  const url = `${BASE}/fr/clubs/trouver-un-club/trouver-un-club-resultats/DEPT${deptNum}-${slug}.html`;
  const html = await fetchHtml(url);
  if (!html) return [];

  const structures = extractArrayCarte(html);
  if (!structures || structures.length === 0) {
    const text = (html || "").replace(/\s+/g, " ").trim().slice(0, 200);
    console.log(`  [${deptNum}] no arrayCarte. Text: ${text}`);
    return [];
  }

  return structures.map(s => {
    const code = (s.StructureCode || "").trim();
    const name = (s.StructureNom || "").trim();

    // Practice venues with real track coordinates
    const practiceVenues = Object.values(s.LieuDePratique || {})
      .filter(v => v.LocLat && v.LocLong && v.LocLat !== 0 && v.LocLong !== 0)
      .map(v => ({
        label: (v.Libelle || "").trim(),
        lat: v.LocLat,
        lng: v.LocLong,
        address: joinAddress(v.AdresseCompA, v.AdresseCompB, v.AdresseCompC),
        city: `${(v.AdresseCodePostalFR || "").trim()} ${(v.AdresseCommune || "").trim()}`.trim(),
      }));

    // Track address: prefer practice venue address over club postal address
    const pv = practiceVenues[0];
    const trackAddress = pv
      ? joinAddress(pv.address, pv.city)
      : joinAddress(
          joinAddress(s.AdresseCompA, s.AdresseCompB, s.AdresseCompC),
          `${(s.AdresseCodePostalFR || "").trim()} ${(s.AdresseCommune || "").trim()}`.trim()
        );

    return {
      code,
      name,
      hostId: code ? `ffvrc-${code}` : `ffvrc-${slugify(name)}`,
      website: normalizeUrl(s.AdresseWeb),
      phone: (s.AdresseTel || "").trim(),
      address: trackAddress,
      lat: pv ? pv.lat : null,
      lng: pv ? pv.lng : null,
    };
  });
}

async function runBatch(items, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    results.push(...await Promise.all(batch.map(fn)));
    if (i + CONCURRENCY < items.length) await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

async function main() {
  console.log("=== FFVRC Club Discovery ===");

  let venues = [];
  try { venues = JSON.parse(await readFile(VENUES_FILE, "utf8")); }
  catch { console.warn("Could not read", VENUES_FILE); }

  // Index by id/hostId for fast lookup by club code
  const venueById = new Map(venues.map(v => [v.id || v.hostId, v]));
  const venueByName = new Map(venues.map(v => [normalizeForMatch(v.name), v]));
  const deptEntries = Object.entries(DEPARTMENTS);

  console.log(`Scraping ${deptEntries.length} departments...`);

  const allClubs = [];
  const results = await runBatch(deptEntries, async ([deptNum, slug]) => {
    const clubs = await scrapeDept(deptNum, slug);
    if (clubs.length > 0) console.log(`  [${deptNum}] ${clubs.length} clubs`);
    return clubs;
  });
  for (const batch of results) allClubs.push(...batch);

  console.log(`\nTotal clubs scraped: ${allClubs.length}`);

  let updated = 0, coordsAdded = 0;
  for (const club of allClubs) {
    const venue = venueById.get(club.hostId) || venueByName.get(normalizeForMatch(club.name));
    if (!venue) continue;

    let changed = false;
    if (club.website && !venue.website) { venue.website = club.website; changed = true; }
    if (club.phone && !venue.phone) { venue.phone = club.phone; changed = true; }
    if (club.address && !venue.address) { venue.address = club.address; changed = true; }

    // Add practice venue coordinates if not already geocoded
    if (club.lat && club.lng && venue.lat == null) {
      venue.lat = club.lat;
      venue.lng = club.lng;
      if (!venue.address && club.address) { venue.address = club.address; }
      changed = true;
      coordsAdded++;
      console.log(`  ✓ coords ${venue.name}: ${club.lat}, ${club.lng}`);
    }

    if (changed) updated++;
  }

  await writeFile(VENUES_FILE, JSON.stringify(venues, null, 2) + "\n");
  console.log(`\nUpdated ${updated} venues (${coordsAdded} got coordinates). Wrote ${VENUES_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
