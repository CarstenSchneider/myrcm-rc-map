import { readFile, writeFile } from "node:fs/promises";
import { load } from "cheerio";
import { safeWriteJson } from "./import-utils.js";

const CALENDAR_URL = "https://www.ffvrc.fr/fr/calendrier.html";
const INSCRIPTION_URL = "https://ffvrcweb.fr/inscription/index.php";
const RACES_FILE = "races.json";
const SEEDS_FILE = "venue-seeds.json";
const OUTPUT_RACES = "ffvrc-races.json";
const OUTPUT_VENUES = "ffvrc-venues.json";

const FR_MONTHS = {
  Janvier: 1, Février: 2, Mars: 3, Avril: 4, Mai: 5, Juin: 6,
  Juillet: 7, Août: 8, Septembre: 9, Octobre: 10, Novembre: 11, Décembre: 12,
};
// For inscription page parsing (lowercase French month names)
const FR_MONTHS_LC = Object.fromEntries(
  Object.entries(FR_MONTHS).map(([k, v]) => [k.toLowerCase().replace(/é/g, "e").replace(/û/g, "u"), v])
);

function slugify(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function normalizeMatchKey(value = "") {
  return slugify(value).replace(/-+/g, " ").trim();
}

async function fetchCalendar(year, type) {
  const params = new URLSearchParams({
    "CrxCal[typemanif]": type,
    "CrxCal[dateDebut]": `01/01/${year}`,
    "CrxCal[dateFin]": `31/12/${year}`,
    "CrxCal[discipline]": "",
    "CrxCal[manifchampid]": "",
  });
  const res = await fetch(CALENDAR_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (compatible; rcracemap-importer/1.0; +https://rcracemap.com)",
    },
    body: params.toString(),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`FFVRC calendar ${type}/${year}: HTTP ${res.status}`);
  return res.text();
}

function parseCalendar(html, year) {
  const $ = load(html);
  const events = [];

  $(".panel-event").each((_, el) => {
    const $el = $(el);
    const mnfId = $el.find(".panel-heading").attr("id");
    if (!mnfId?.startsWith("MNF-")) return;

    const jour = parseInt($el.find(".jour").text().trim(), 10);
    const moisStr = $el.find(".mois").text().trim();
    const month = FR_MONTHS[moisStr];
    if (!month || isNaN(jour)) return;
    const dateFrom = `${year}-${String(month).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;

    const title = $el.find(".event-libelle").text().trim();
    const souslibelle = $el.find(".event-souslibelle").text().trim();
    const classes = $el.find(".label-cat").map((_, e) => $(e).text().trim()).get().filter(Boolean);
    const league = $el.find(".label-default").last().text().trim();

    // "CODE - CLUB NAME - POSTAL CITY"
    const parts = souslibelle.split(" - ").map(s => s.trim()).filter(Boolean);
    const clubCode = parts[0] || "";
    const clubName = parts[1] || souslibelle;
    const locationStr = parts[2] || "";
    const postalMatch = locationStr.match(/^(\d{5})\s*(.*)?$/);
    const postalCode = postalMatch ? postalMatch[1] : null;
    const city = postalMatch ? (postalMatch[2] || "").trim() : locationStr;

    // Google Maps coords from "Itinéraire" link
    let lat = null, lng = null;
    const mapsHref = $el.find('a[href*="maps.google.com"], a[href*="google.com/maps"]').attr("href") || "";
    const coordMatch = mapsHref.match(/daddr=(-?[0-9.]+),(-?[0-9.]+)/);
    if (coordMatch) {
      lat = parseFloat(coordMatch[1]);
      lng = parseFloat(coordMatch[2]);
    }

    const hostId = `ffvrc-${slugify(clubCode || clubName)}`;

    events.push({ mnfId, hostId, clubCode, clubName, city, postalCode, title, dateFrom, classes, league, lat, lng });
  });

  return events;
}

async function fetchOpenRegistrations() {
  // "23 août 2026 - CAMM MACON - Piste 1/5" → Set of "DATE|clubKey"
  const openKeys = new Set();
  try {
    const res = await fetch(INSCRIPTION_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; rcracemap-importer/1.0)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      console.warn(`FFVRC inscription: HTTP ${res.status} (non-fatal)`);
      return openKeys;
    }
    const html = await res.text();
    const $ = load(html);
    $('h2').each((_, h2) => {
      if (!$(h2).text().includes("inscrire")) return;
      $(h2).next("ul").find("a").each((_, a) => {
        const label = $(a).text().trim().toLowerCase();
        // "23 août 2026 - club name - category"
        const m = label.match(/^(\d{1,2})\s+(\S+)\s+(\d{4})\s*-\s*(.+?)(?:\s*-\s*.+)?$/);
        if (!m) return;
        const day = parseInt(m[1], 10);
        const mStr = m[2].normalize("NFKD").replace(/[̀-ͯ]/g, "");
        const month = FR_MONTHS_LC[mStr];
        const yr = parseInt(m[3], 10);
        if (!month) return;
        const date = `${yr}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        openKeys.add(`${date}|${normalizeMatchKey(m[4])}`);
      });
    });
  } catch (e) {
    console.warn("FFVRC inscription fetch failed (non-fatal):", e.message);
  }
  return openKeys;
}

async function main() {
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1];
  const types = ["LIG", "NAT"];

  // Fetch all events (LIG + NAT, current + next year)
  const allEvents = new Map(); // mnfId → event
  for (const year of years) {
    for (const type of types) {
      try {
        console.log(`Fetching FFVRC ${type} ${year}…`);
        const html = await fetchCalendar(year, type);
        const events = parseCalendar(html, year);
        console.log(`  → ${events.length} events`);
        for (const ev of events) {
          if (!allEvents.has(ev.mnfId)) allEvents.set(ev.mnfId, ev);
        }
      } catch (e) {
        console.error(`  Error FFVRC ${type} ${year}: ${e.message}`);
      }
    }
  }

  const events = Array.from(allEvents.values());
  console.log(`Total unique FFVRC events: ${events.length}`);

  // Admin-verified venue seeds (hostId: "ffvrc-*")
  let venueSeeds = [];
  try {
    venueSeeds = JSON.parse(await readFile(SEEDS_FILE, "utf8"));
  } catch { /* first run */ }
  const seededHostIds = new Set(
    venueSeeds
      .filter(s => s.hostId?.startsWith("ffvrc-") && (s.lat != null || s.locationUnknown))
      .map(s => s.hostId)
  );

  // Existing MyRCM+Benelux races for dedup
  let existingRaces = [];
  try {
    existingRaces = JSON.parse(await readFile(RACES_FILE, "utf8"));
  } catch { /* first run */ }
  const existingKeys = new Set(
    existingRaces.map(r => `${normalizeMatchKey(r.hostName || r.venueName || "")}|${r.from || r.dateFrom || ""}`)
  );

  // Open registration keys from inscription page
  const openKeys = await fetchOpenRegistrations();

  // Build auto-venue map (from Google Maps coords in calendar)
  const autoVenues = new Map();
  const partialVenues = new Map(); // no coords but have city/postalCode for admin display
  for (const ev of events) {
    if (ev.lat != null && ev.lng != null && !autoVenues.has(ev.hostId)) {
      autoVenues.set(ev.hostId, {
        id: ev.hostId,
        hostId: ev.hostId,
        name: ev.clubName,
        city: ev.city || null,
        postalCode: ev.postalCode || null,
        lat: ev.lat,
        lng: ev.lng,
        country: "FR",
        source: "ffvrc-calendar",
      });
    } else if (ev.lat == null && !autoVenues.has(ev.hostId) && !partialVenues.has(ev.hostId)) {
      partialVenues.set(ev.hostId, {
        id: ev.hostId,
        hostId: ev.hostId,
        name: ev.clubName,
        city: ev.city || null,
        postalCode: ev.postalCode || null,
        country: "FR",
        source: "ffvrc-calendar",
      });
    }
  }

  // ffvrc-venues.json: placeholder + auto-extracted + partial (no coords, for admin info)
  const ffvrcVenues = [
    { id: "ffvrc-fr", name: "France", locationUnknown: true, country: "FR" },
    ...Array.from(autoVenues.values()),
    ...Array.from(partialVenues.values()).filter(v => !autoVenues.has(v.hostId)),
  ];

  // Build race list
  let dupCount = 0;
  const races = [];
  const seenHostIds = new Set();

  for (const ev of events) {
    // Dedup against MyRCM/Benelux by hostName + date
    const matchKey = `${normalizeMatchKey(ev.clubName)}|${ev.dateFrom}`;
    if (existingKeys.has(matchKey)) {
      dupCount++;
      continue;
    }

    // Determine venueId
    let venueId;
    if (seededHostIds.has(ev.hostId)) {
      venueId = ev.hostId; // admin-verified seed
    } else if (autoVenues.has(ev.hostId)) {
      venueId = ev.hostId; // auto-coords from calendar
    } else {
      venueId = "ffvrc-fr"; // placeholder, shows in list without map pin
    }

    // Registration status
    const regKey = `${ev.dateFrom}|${normalizeMatchKey(ev.clubName)}`;
    const registrationStatus = openKeys.has(regKey) ? "open" : null;

    races.push({
      id: ev.mnfId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      hostId: ev.hostId,
      hostName: ev.clubName,
      venueId,
      name: ev.title,
      from: ev.dateFrom,
      to: ev.dateFrom,
      registrationStatus,
      classes: ev.classes.length ? ev.classes : null,
      series: ev.league ? [ev.league] : null,
      country: "FR",
      source: "ffvrc",
      url: CALENDAR_URL,
    });

    seenHostIds.add(ev.hostId);
  }

  races.sort((a, b) => a.from.localeCompare(b.from) || a.hostName.localeCompare(b.hostName, "fr"));

  if (dupCount > 0) console.log(`Deduped ${dupCount} races already in races.json`);

  await safeWriteJson(races, OUTPUT_RACES, { minCount: 0, minFraction: 0, label: "ffvrc-races.json" });
  await safeWriteJson(ffvrcVenues, OUTPUT_VENUES, { minCount: 1, minFraction: 0, label: "ffvrc-venues.json" });
  console.log(`Done: ${races.length} FFVRC races, ${ffvrcVenues.length - 1} auto-venues`);
}

main().catch(e => { console.error(e); process.exit(1); });
