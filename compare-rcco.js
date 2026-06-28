#!/usr/bin/env node
// Fetches all events from rccar-online.de/veranstaltungen and compares with our race data.
// Run via GitHub Actions (check-rcco.yml) since rccar-online.de blocks server proxies.

import * as cheerio from "cheerio";
import { readFileSync, writeFileSync } from "fs";

const RCCO_URL = "https://rccar-online.de/veranstaltungen";
const TIMEOUT_MS = 15000;

function normalizeClub(name = "") {
  return name.toLowerCase()
    .replace(/\be\.?\s*v\.?\b/g, "")
    .replace(/[^a-z0-9äöüß]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(str = "") {
  // "05.07.2026" → "2026-07-05"
  const m = str.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : str;
}

async function fetchRcco() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RCCO_URL, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RCRaceMap/1.0)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseRcco(html) {
  const $ = cheerio.load(html);
  const events = [];

  // Find all table rows with event data (skip header rows)
  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 4) return;

    const dateCell = $(cells[0]).text().trim();
    const clubCell = $(cells[1]).text().trim();
    const nameCell = $(cells[2]).text().trim();
    const classesCell = $(cells[4] || cells[3]).text().trim();
    const trackCell = $(cells[cells.length - 2]).text().trim();

    if (!dateCell.match(/\d{2}\.\d{2}\.\d{4}/)) return;

    // Date cell may have multiple lines (start date on first line)
    const dateStr = dateCell.split("\n")[0].trim();

    events.push({
      date: normalizeDate(dateStr),
      dateRaw: dateStr,
      club: clubCell,
      clubNorm: normalizeClub(clubCell),
      name: nameCell.split("\n")[0].trim(),
      classes: classesCell.replace(/\s+/g, " ").trim(),
      track: trackCell,
    });
  });

  return events;
}

function loadOurRaces() {
  const races = [];
  for (const file of ["races.json", "rck-races.json", "dmc-races.json"]) {
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      races.push(...data);
    } catch { /* file may not exist */ }
  }
  return races;
}

function loadHosts() {
  try {
    return JSON.parse(readFileSync("hosts.json", "utf8"));
  } catch { return []; }
}

function run() {
  console.log("Lade unsere Renndaten...");
  const ourRaces = loadOurRaces();
  const hosts = loadHosts();
  const hostNames = hosts.map(h => ({ name: h.name, norm: normalizeClub(h.name) }));

  console.log(`Unsere Rennen: ${ourRaces.length}`);

  // Build lookup: date+clubNorm → our races
  const ourByDate = new Map();
  for (const r of ourRaces) {
    const date = r.date?.slice(0, 10) || "";
    const key = date;
    if (!ourByDate.has(key)) ourByDate.set(key, []);
    ourByDate.get(key).push(r);
  }

  // Build host name lookup
  const ourHostNorms = new Set(hostNames.map(h => h.norm));

  fetchRcco().then(html => {
    console.log("rccar-online.de geladen, parse Events...");
    const rccoEvents = parseRcco(html);
    console.log(`rccar-online.de Events: ${rccoEvents.length}\n`);

    const matched = [];
    const unmatched = [];
    const unknownClubs = new Set();

    for (const ev of rccoEvents) {
      // Check if club is known
      const clubKnown = ourHostNorms.has(ev.clubNorm) ||
        [...ourHostNorms].some(n => n.includes(ev.clubNorm) || ev.clubNorm.includes(n));

      // Check if we have a race on same date from same club area
      const sameDate = ourByDate.get(ev.date) || [];
      const dateMatch = sameDate.length > 0;

      if (clubKnown || dateMatch) {
        matched.push({ ...ev, clubKnown, dateMatch, sameDateCount: sameDate.length });
      } else {
        unmatched.push(ev);
        unknownClubs.add(ev.club);
      }
    }

    console.log(`=== Ergebnis ===`);
    console.log(`Gesamt rccar-online.de: ${rccoEvents.length}`);
    console.log(`Wahrscheinlich bereits bekannt: ${matched.length}`);
    console.log(`Möglicherweise NEU (Verein unbekannt + kein Datum-Match): ${unmatched.length}`);

    if (unmatched.length > 0) {
      console.log(`\n--- Unbekannte Vereine ---`);
      for (const club of unknownClubs) {
        console.log(`  ${club}`);
      }
      console.log(`\n--- Potentiell neue Rennen ---`);
      for (const ev of unmatched) {
        console.log(`  ${ev.dateRaw} | ${ev.club} | ${ev.name} | ${ev.track}`);
      }
    }

    writeFileSync("rcco-compare.json", JSON.stringify({ rccoEvents, matched, unmatched }, null, 2) + "\n");
    console.log(`\nrcco-compare.json geschrieben`);
  }).catch(e => {
    console.error("Fehler:", e.message);
    process.exit(1);
  });
}

run();
