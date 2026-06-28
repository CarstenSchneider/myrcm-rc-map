#!/usr/bin/env node
// Fetches rccar-online.de/veranstaltungen and writes rcco-races.json + rcco-venues.json.
// Run: node import-rcco.js

import * as cheerio from "cheerio";
import { readFile, writeFile, access } from "node:fs/promises";

const RCCO_URL = "https://rccar-online.de/veranstaltungen";
const TIMEOUT_MS = 15000;
const OUTPUT_RACES = "rcco-races.json";
const OUTPUT_VENUES = "rcco-venues.json";

function normalizeKey(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value = "") {
  return normalizeKey(value).replace(/\s+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function normalizeDate(str = "") {
  const m = str.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RCRaceMap/1.0)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonIfExists(file, fallback = []) {
  try {
    await access(file);
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function parseRcco(html) {
  const $ = cheerio.load(html);
  const events = [];

  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 4) return;

    const dateRaw = $(cells[0]).text().trim().split("\n")[0].trim();
    const date = normalizeDate(dateRaw);
    if (!date) return;

    const clubName = $(cells[1]).text().trim();
    const raceName = $(cells[2]).text().trim().split("\n")[0].trim();
    // classes column varies by table structure; prefer 5th cell, fall back to 4th
    const classesRaw = $(cells.length > 4 ? cells[4] : cells[3]).text().trim();
    const track = $(cells[cells.length - 2]).text().trim();

    if (!clubName || !raceName) return;

    const classes = classesRaw
      .split(/[,\n]+/)
      .map(s => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    events.push({ date, dateRaw, clubName, raceName, classes, track });
  });

  return events;
}

function matchHost(clubName, hosts) {
  const key = normalizeKey(clubName);
  return hosts.find(h => {
    const hKey = normalizeKey(h.name || "");
    return hKey && (hKey === key || key.includes(hKey) || hKey.includes(key));
  }) || null;
}

function matchVenueForHost(host, venues) {
  return venues.find(v => Array.isArray(v.hostIds) && v.hostIds.includes(host.id)) || null;
}

async function main() {
  const [hosts, venues, seeds] = await Promise.all([
    readJsonIfExists("hosts.json"),
    readJsonIfExists("venues.json"),
    readJsonIfExists("venue-seeds.json"),
  ]);

  const seedByHostId = new Map(
    seeds
      .filter(s => s.hostId?.startsWith("rcco-") && s.lat != null && s.lng != null)
      .map(s => [s.hostId, s])
  );

  console.log(`Lade rccar-online.de…`);
  const html = await fetchHtml(RCCO_URL);
  const events = parseRcco(html);
  console.log(`${events.length} Events geparst`);

  if (events.length === 0) {
    throw new Error("Sanity-Check fehlgeschlagen: 0 Events geparst — Seitenstruktur geändert?");
  }

  const rccoVenues = [];
  const rccoVenueIds = new Set();
  let countMatched = 0, countSeeded = 0, countUnmatched = 0;

  const races = events.map(ev => {
    const rccoHostId = `rcco-${slugify(ev.clubName)}`;

    // Try to reuse an existing MyRCM/DMC host + venue by normalized name match
    const existingHost = matchHost(ev.clubName, hosts);
    const existingVenue = existingHost ? matchVenueForHost(existingHost, venues) : null;

    let hostId, hostName, venueId, venueName, venueLocation;

    if (existingVenue) {
      hostId = existingHost.id;
      hostName = existingHost.name;
      venueId = existingVenue.id;
      venueName = existingVenue.name;
      venueLocation = existingVenue.city || null;
      countMatched++;
    } else {
      hostId = rccoHostId;
      hostName = ev.clubName;

      // Check for admin-entered seed (via "Koordinaten prüfen" tab)
      const seed = seedByHostId.get(rccoHostId);
      if (seed) {
        venueId = rccoHostId;
        venueName = seed.hostName || ev.clubName;
        venueLocation = seed.city || null;
        countSeeded++;

        if (!rccoVenueIds.has(rccoHostId)) {
          rccoVenueIds.add(rccoHostId);
          rccoVenues.push({
            id: rccoHostId,
            name: seed.hostName || ev.clubName,
            city: seed.city || null,
            lat: seed.lat,
            lng: seed.lng,
            hostIds: [rccoHostId],
            source: "rcco-seed",
          });
        }
      } else {
        venueId = null;
        venueName = ev.track || null;
        venueLocation = null;
        countUnmatched++;
      }
    }

    // Stable ID: source + hostId (normalized club) + date; append name slug if needed
    const id = `rcco-${slugify(ev.clubName)}-${ev.date}`;

    return {
      id,
      venueId,
      venueName,
      venueLocation,
      hostId,
      hostName,
      name: ev.raceName,
      from: ev.date,
      to: ev.date,
      series: [],
      classes: ev.classes,
      source: "rcco",
      url: RCCO_URL,
      registrationStatus: null,
      registrationOpens: null,
    };
  });

  // Deduplicate by id (same club, same date → keep last)
  const byId = new Map(races.map(r => [r.id, r]));
  const unique = Array.from(byId.values()).sort((a, b) => a.from.localeCompare(b.from) || a.hostName.localeCompare(b.hostName));

  console.log(`Venue-Matches: ${countMatched} MyRCM-Match, ${countSeeded} via Seed, ${countUnmatched} ohne Koordinaten`);

  await writeFile(OUTPUT_RACES, JSON.stringify(unique, null, 2) + "\n");
  console.log(`Geschrieben: ${OUTPUT_RACES} (${unique.length} Rennen)`);

  await writeFile(OUTPUT_VENUES, JSON.stringify(rccoVenues, null, 2) + "\n");
  console.log(`Geschrieben: ${OUTPUT_VENUES} (${rccoVenues.length} Venues)`);
}

main().catch(e => { console.error(e); process.exit(1); });
