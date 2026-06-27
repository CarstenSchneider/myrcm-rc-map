import { readFile, writeFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { load } from "cheerio";
import { safeWriteJson, warnIfSparse } from "./import-utils.js";

const DMC_URL = "https://dmc-online.com/wordpress/termine/dmc-termine/";
const DMC_DIRECTORY_SOURCES = [
  { url: "https://www.dmc-online.com/NeueSeite/pages/organisationOrtsvereineResult.php?sk=1", label: "SK Mitte" },
  { url: "https://www.dmc-online.com/NeueSeite/pages/organisationOrtsvereineResult.php?sk=2", label: "SK Nord" },
  { url: "https://www.dmc-online.com/NeueSeite/pages/organisationOrtsvereineResult.php?sk=3", label: "SK West" },
  { url: "https://www.dmc-online.com/NeueSeite/pages/organisationOrtsvereineResult.php?sk=4", label: "SK Süd" },
  { url: "https://www.dmc-online.com/NeueSeite/pages/organisationOrtsvereineResult.php?sk=5", label: "SK Ost" },
];
const OUTPUT_FILE = "dmc-races.json";
const DMC_VENUES_FILE = "dmc-venues.json";
const TIMEOUT_MS = 30000;
const PDF_TIMEOUT_MS = 20000;

// Match registration links inside PDF text
const REGISTRATION_URL_RE = /https?:\/\/(?:www\.)?(?:rccar-online\.de\/[^\s<>"')\]]+|rccar-nennungen\.de\/[^\s<>"')\]]+)/gi;

// Non-DACH TLDs — clubs with these website domains are filtered out
const NON_DACH_TLDS = /\.(?:nl|be|fr|pl|cz|sk|hu|it|es|dk|se|no|fi|gb|uk)(?:\/|$)/i;

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

function translatePraedikat(code) {
  const c = String(code || "").trim().toUpperCase();
  if (c.startsWith("FR")) return "Freundschaftsrennen";
  if (c.startsWith("SM")) return "Sportkreismeisterschaft";
  if (c.startsWith("DM")) return "Deutsche Meisterschaft";
  if (c.startsWith("PRAES")) return "Präsidiumsveranstaltung";
  return code || "DMC Rennen";
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

// Build two lookup maps: byName (normalizedName → entry) and byOvNr (ovNr → entry)
async function fetchDmcClubDirectory() {
  const byName = new Map();
  const byOvNr = new Map();
  console.log("Lade DMC Vereinsverzeichnis …");

  for (const { url, label } of DMC_DIRECTORY_SOURCES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; rcracemap-importer/1.0)",
          "Accept": "text/html,application/xhtml+xml",
        },
      });
      if (!res.ok) {
        console.warn(`  ${label}: HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      const entries = parseClubDirectory(html, label);
      console.log(`  ${label}: ${entries.length} Vereine`);
      for (const entry of entries) {
        byName.set(normalizeKey(entry.name), entry);
        if (entry.ovNr) byOvNr.set(entry.ovNr, entry);
      }
    } catch (e) {
      console.warn(`  ${label}: ${e.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  console.log(`Vereinsverzeichnis geladen: ${byName.size} Vereine`);
  return { byName, byOvNr };
}

function parseClubDirectory(html, label = "") {
  const $ = load(html);
  const entries = [];

  // Strategy 1: Old DMC site — table.verein
  // Columns: PLZ(0) | Ortsverein(1) | OV-Nr.(2) | Teamleiter(3) | Ort(4) | Internet(5) | E-Mail(6)
  $("table.verein tr").each((_, tr) => {
    if ($(tr).hasClass("titleRow")) return;
    const cells = $(tr).find("td");
    if (cells.length < 6) return;
    const name = $(cells[1]).text().trim();
    if (!name || name.length < 3) return;
    const ovNr = $(cells[2]).text().trim() || null;
    const cityRaw = $(cells[4]).text().replace(/\s+/g, " ").trim();
    const city = cityRaw.split(" ").filter(p => !/^\d+$/.test(p)).join(" ").trim() || null;
    const website = $(cells[5]).find("a[href]").first().attr("href") || null;
    entries.push({ name, ovNr, city, website: website || null });
  });
  if (entries.length > 0) return entries;

  // Strategy 2: Generic table rows with ≥2 columns (header rows filtered by text pattern)
  $("table tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 2) return;
    const name = $(cells[0]).text().trim() || $(cells[1]).text().trim();
    if (!name || name.length < 3 || /^(PLZ|OV|Verein|Club|Name|Ortsverein)/i.test(name)) return;
    const website = $(tr).find("a[href]").first().attr("href") || null;
    entries.push({ name, ovNr: null, city: null, website: website || null });
  });
  if (entries.length > 0) return entries;

  // Strategy 3: WordPress content-area links
  $("article a[href], .entry-content a[href], .wp-block-group a[href], main a[href]").each((_, a) => {
    const name = $(a).text().trim();
    const href = $(a).attr("href") || null;
    if (!name || name.length < 3) return;
    entries.push({ name, ovNr: null, city: null, website: href });
  });
  if (entries.length > 0) return entries;

  // Nothing found — write body HTML to debug file for inspection
  const bodyHtml = ($("body").html() || $.html()).replace(/\s+/g, " ").trim();
  try { appendFileSync("dmc-debug-html.json", JSON.stringify({ label, bodyHtml }) + "\n"); } catch { }
  return entries;
}

function parseTable(html, clubDirectory) {
  const $ = load(html);
  const rows = [];
  let debugLogged = false;

  $("table tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 6) return;

    const clubName = $(cells[5]).text().trim();
    if (!clubName || /^(Referent|Sportkreisvorsitzender|Schriftf[uü]hrer|DMC e\.V\. Gesch)/i.test(clubName)) return;

    const ovNr = $(cells[4]).text().trim() || null;
    // OV-Nr. match is exact; fall back to normalized name match
    const dirEntry = (ovNr ? clubDirectory.byOvNr.get(ovNr) : null)
      || clubDirectory.byName.get(normalizeKey(clubName));

    // Club website: calendar inline link (cells[5]) is the most reliable source
    const calendarWebsiteHref = $(cells[5]).find("a[href]").first().attr("href") || null;
    const clubWebsite = calendarWebsiteHref || dirEntry?.website || null;

    // Filter non-DACH clubs via website TLD (calendar link or directory)
    if (clubWebsite && NON_DACH_TLDS.test(clubWebsite)) {
      console.log(`  Übersprungen (nicht DACH): ${clubName} → ${clubWebsite}`);
      return;
    }

    const dateFrom = parseGermanDate($(cells[0]).text().trim());
    if (!dateFrom) return;

    const dateToRaw = parseGermanDate($(cells[1]).text().trim());
    const dateTo = dateToRaw || dateFrom;

    const title = $(cells[2]).text().trim();
    // ovNr already extracted above for directory lookup
    const city = dirEntry?.city || $(cells[6]).text().trim() || null;

    // Ausschreibung PDF
    const ausschreibungHref = $(cells[8]).find("a[href]").first().attr("href") || null;

    // Nennformular: cells[9] if present — skip generic myrcm booking pages without event ID
    const rawNennformular = cells.length > 9
      ? $(cells[9]).find("a[href]").first().attr("href") || null
      : null;
    const nennformularHref = rawNennformular && !/myrcm\.ch\/myrcm\/main\?hId\[1\]=bkg&pLa=/.test(rawNennformular)
      ? rawNennformular
      : null;

    rows.push({ dateFrom, dateTo, title, clubName, ovNr, city, clubWebsite, ausschreibungHref, nennformularHref });
  });

  return rows;
}

async function loadPdfParse() {
  try {
    const imported = await import("pdf-parse/lib/pdf-parse.js");
    return imported.default || imported;
  } catch {
    try {
      const imported = await import("pdf-parse");
      return imported.default || imported;
    } catch {
      return null;
    }
  }
}

async function fetchPdfBuffer(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PDF_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/pdf,*/*",
        "Referer": DMC_URL,
      },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function extractRegistrationUrlFromPdf(pdfUrl, pdfParse) {
  if (!pdfUrl || !pdfParse) return null;
  const buffer = await fetchPdfBuffer(pdfUrl);
  if (!buffer) return null;
  try {
    const result = await pdfParse(buffer);
    const text = result?.text || "";
    const matches = [...text.matchAll(REGISTRATION_URL_RE)];
    return matches[0]?.[0]?.replace(/[.,;]+$/, "") || null;
  } catch {
    return null;
  }
}

async function loadVenues() {
  try { return JSON.parse(await readFile("venues.json", "utf8")); }
  catch { return []; }
}

async function loadHosts() {
  try { return JSON.parse(await readFile("hosts.json", "utf8")); }
  catch { return []; }
}

async function loadVenueSeeds() {
  try { return JSON.parse(await readFile("venue-seeds.json", "utf8")); }
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

  // Load club directory first (needed for non-DACH filtering + websites)
  const clubDirectory = await fetchDmcClubDirectory();

  console.log(`Lade DMC-Kalender ${year} …`);
  let html;
  try {
    html = await fetchDmcCalendar(year);
  } catch (e) {
    console.error(`Fehler: ${e.message}`);
    process.exit(1);
  }

  const entries = parseTable(html, clubDirectory);
  console.log(`Einträge geparst: ${entries.length}`);
  if (entries.length < 50) {
    throw new Error(`Sanity-Check fehlgeschlagen: nur ${entries.length} Kalendereinträge geparst — Seitenstruktur geändert?`);
  }

  const venues = await loadVenues();
  const hosts = await loadHosts();
  const seeds = await loadVenueSeeds();

  // Build lookup: dmc-hostId → seed entry (only if seed has coordinates)
  const seedByHostId = new Map(
    seeds
      .filter(s => s.hostId?.startsWith("dmc-") && s.lat != null && s.lng != null)
      .map(s => [s.hostId, s])
  );

  // Extract registration URLs from ausschreibung PDFs (cached by URL)
  const pdfParse = await loadPdfParse();
  const pdfCache = new Map(); // pdfUrl → registrationUrl | null
  const uniquePdfUrls = [...new Set(entries.map(e => e.ausschreibungHref).filter(Boolean))];
  console.log(`PDFs zu prüfen: ${uniquePdfUrls.length}`);
  for (const pdfUrl of uniquePdfUrls) {
    const regUrl = await extractRegistrationUrlFromPdf(pdfUrl, pdfParse);
    pdfCache.set(pdfUrl, regUrl);
    if (regUrl) console.log(`  Nennung: ${regUrl}`);
  }
  const foundCount = [...pdfCache.values()].filter(Boolean).length;
  console.log(`Nennungslinks gefunden: ${foundCount} / ${uniquePdfUrls.length}`);

  const dmcVenues = [];
  const dmcVenueIds = new Set();

  const races = entries.map(entry => {
    const venue = matchVenue(entry.clubName, venues, hosts);
    const hostSlug = slugify(entry.clubName);
    // Use OV-Nummer as stable ID when available, fall back to slugified name
    const dmcHostId = entry.ovNr ? `dmc-ov-${entry.ovNr}` : `dmc-${hostSlug}`;
    const seed = !venue ? (seedByHostId.get(dmcHostId) || seedByHostId.get(`dmc-${hostSlug}`)) : null;

    if (seed && !dmcVenueIds.has(dmcHostId)) {
      dmcVenueIds.add(dmcHostId);
      dmcVenues.push({
        id: dmcHostId,
        name: seed.hostName || entry.clubName,
        city: entry.city || null,
        lat: seed.lat,
        lng: seed.lng,
        hostIds: [dmcHostId],
        source: "dmc-seed",
      });
    }

    // Registration URL: prefer direct Nennformular link from table, then PDF-extracted URL
    const pdfRegistrationUrl = entry.ausschreibungHref ? (pdfCache.get(entry.ausschreibungHref) || null) : null;
    const registrationUrl = entry.nennformularHref || pdfRegistrationUrl || null;

    const documents = entry.ausschreibungHref
      ? [{ url: entry.ausschreibungHref, type: "announcement", label: "Ausschreibung" }]
      : [];

    return {
      id: `dmc-${hostSlug}-${entry.dateFrom}`,
      venueId: venue?.id ?? (seed ? dmcHostId : null),
      venueName: venue?.name ?? (seed ? (seed.hostName || entry.clubName) : null),
      venueLocation: venue?.city ?? entry.city ?? null,
      hostId: venue?.hostIds?.[0] ?? dmcHostId,
      hostName: entry.clubName,
      hostCity: entry.city || null,
      hostWebsite: entry.clubWebsite || null,
      dmcOvNr: entry.ovNr || null,
      name: translatePraedikat(entry.title),
      from: entry.dateFrom,
      to: entry.dateTo,
      series: [],
      classes: [],
      source: "dmc",
      url: registrationUrl,
      registrationStatus: registrationUrl ? "open" : null,
      registrationOpens: null,
      documents,
    };
  });

  console.log(`Venue-Matches: ${races.filter(r => r.venueId).length} / ${races.length} (davon ${dmcVenues.length} via Seed)`);
  warnIfSparse(races, ["from", "hostName"], { label: OUTPUT_FILE });
  await safeWriteJson(races, OUTPUT_FILE, { minCount: 50, minFraction: 0.7, label: OUTPUT_FILE });
  await writeFile(DMC_VENUES_FILE, JSON.stringify(dmcVenues, null, 2) + "\n");
  console.log(`Geschrieben: ${DMC_VENUES_FILE} (${dmcVenues.length} Venues)`);
}

main().catch(e => { console.error(e); process.exit(1); });
