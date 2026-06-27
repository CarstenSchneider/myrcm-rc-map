import { readFile, writeFile } from "node:fs/promises";
import { load } from "cheerio";

const DMC_URL = "https://dmc-online.com/wordpress/termine/dmc-termine/";
const OUTPUT_FILE = "dmc-races.json";
const TIMEOUT_MS = 30000;

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
    .trim();
}

function slugify(value = "") {
  return normalizeKey(value).replace(/\s+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

// "dd.MM.yyyy" → "YYYY-MM-DD"
function parseGermanDate(str) {
  const m = String(str || "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function fetchDmcCalendar(year) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const body = new URLSearchParams({
    startmonat: "01",
    endmonat: "12",
    jahr: String(year),
    praedikat: "null",
    "klasse[]": "Alle Startklassen",
    submit: "Termine anzeigen",
  });
  try {
    const res = await fetch(DMC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": DMC_URL,
        "User-Agent": "Mozilla/5.0 (compatible; rcracemap-importer/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseTable(html) {
  const $ = load(html);
  const rows = [];

  $("table tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 6) return;

    const clubName = $(cells[5]).text().trim();
    if (!clubName || /^(Referent|Sportkreisvorsitzender)/i.test(clubName)) return;

    const dateFrom = parseGermanDate($(cells[0]).text().trim());
    if (!dateFrom) return;

    const dateToRaw = parseGermanDate($(cells[1]).text().trim());
    const dateTo = dateToRaw || dateFrom;

    const title = $(cells[2]).text().trim();
    const ausschreibungHref = $(cells[8]).find("a[href]").first().attr("href") || null;

    rows.push({ dateFrom, dateTo, title, clubName, ausschreibungHref });
  });

  return rows;
}

async function loadVenues() {
  try { return JSON.parse(await readFile("venues.json", "utf8")); }
  catch { return []; }
}

async function loadHosts() {
  try { return JSON.parse(await readFile("hosts.json", "utf8")); }
  catch { return []; }
}

function matchVenue(clubName, venues, hosts) {
  if (!clubName) return null;
  const key = normalizeKey(clubName);

  const host = hosts.find(h => {
    const hKey = normalizeKey(h.name || "");
    return hKey && (hKey === key || key.includes(hKey) || hKey.includes(key));
  });
  if (host) {
    const venue = venues.find(v => Array.isArray(v.hostIds) && v.hostIds.includes(host.id));
    if (venue) return venue;
  }

  return venues.find(v => {
    const searchText = normalizeKey([v.name, v.city, ...(v.aliases || [])].filter(Boolean).join(" "));
    return searchText.includes(key) || key.includes(normalizeKey(v.name || ""));
  }) || null;
}

async function main() {
  const year = new Date().getFullYear();
  console.log(`Lade DMC-Kalender ${year} …`);

  let html;
  try {
    html = await fetchDmcCalendar(year);
  } catch (e) {
    console.error(`Fehler: ${e.message}`);
    process.exit(1);
  }

  const entries = parseTable(html);
  console.log(`Einträge geparst: ${entries.length}`);

  const venues = await loadVenues();
  const hosts = await loadHosts();

  const races = entries.map(entry => {
    const venue = matchVenue(entry.clubName, venues, hosts);
    const hostSlug = slugify(entry.clubName);
    return {
      id: `dmc-${hostSlug}-${entry.dateFrom}`,
      venueId: venue?.id ?? null,
      venueName: venue?.name ?? null,
      venueLocation: venue?.city ?? null,
      hostId: venue?.hostIds?.[0] ?? `dmc-${hostSlug}`,
      hostName: entry.clubName,
      name: entry.title || "DMC Rennen",
      from: entry.dateFrom,
      to: entry.dateTo,
      series: [],
      classes: [],
      source: "dmc",
      url: entry.ausschreibungHref,
      registrationStatus: null,
      registrationOpens: null,
    };
  });

  console.log(`Venue-Matches: ${races.filter(r => r.venueId).length} / ${races.length}`);
  await writeFile(OUTPUT_FILE, JSON.stringify(races, null, 2) + "\n");
  console.log(`Geschrieben: ${OUTPUT_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
