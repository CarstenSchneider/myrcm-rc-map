import { readFile, writeFile } from "node:fs/promises";
import { load } from "cheerio";

const DMC_URL = "https://dmc-online.com/wordpress/termine/dmc-termine/";
const OUTPUT_FILE = "dmc-races.json";
const DMC_VENUES_FILE = "dmc-venues.json";
const TIMEOUT_MS = 30000;
const PDF_TIMEOUT_MS = 20000;

// Match registration links inside PDF text
const REGISTRATION_URL_RE = /https?:\/\/(?:www\.)?(?:rccar-online\.de\/[^\s<>"')\]]+|rccar-nennungen\.de\/[^\s<>"')\]]+)/gi;

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

function parseTable(html) {
  const $ = load(html);
  const rows = [];
  let debugLogged = false;

  $("table tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 6) return;

    const clubName = $(cells[5]).text().trim();
    if (!clubName || /^(Referent|Sportkreisvorsitzender|Schriftf[uü]hrer|DMC e\.V\. Gesch)/i.test(clubName)) return;

    const dateFrom = parseGermanDate($(cells[0]).text().trim());
    if (!dateFrom) return;

    // Log first data row to understand column structure
    if (!debugLogged) {
      debugLogged = true;
      const allCells = cells.toArray().map((td, i) => ({
        i,
        text: $(td).text().trim().slice(0, 60),
        links: $(td).find("a[href]").toArray().map(a => $(a).attr("href")).filter(Boolean),
      }));
      console.log("Spaltenstruktur (erste Zeile):", JSON.stringify(allCells, null, 2));
    }

    const dateToRaw = parseGermanDate($(cells[1]).text().trim());
    const dateTo = dateToRaw || dateFrom;

    const title = $(cells[2]).text().trim();

    // Club website: link on club name cell
    const clubWebsiteHref = $(cells[5]).find("a[href]").first().attr("href") || null;

    // Ausschreibung PDF
    const ausschreibungHref = $(cells[8]).find("a[href]").first().attr("href") || null;

    // Nennformular: check cells[9] if present
    const nennformularHref = cells.length > 9
      ? $(cells[9]).find("a[href]").first().attr("href") || null
      : null;

    rows.push({ dateFrom, dateTo, title, clubName, clubWebsiteHref, ausschreibungHref, nennformularHref });
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
    const dmcHostId = `dmc-${hostSlug}`;
    const seed = !venue ? seedByHostId.get(dmcHostId) : null;

    if (seed && !dmcVenueIds.has(dmcHostId)) {
      dmcVenueIds.add(dmcHostId);
      dmcVenues.push({
        id: dmcHostId,
        name: seed.hostName || entry.clubName,
        city: null,
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
      venueLocation: venue?.city ?? null,
      hostId: venue?.hostIds?.[0] ?? dmcHostId,
      hostName: entry.clubName,
      hostWebsite: entry.clubWebsiteHref || null,
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
  await writeFile(OUTPUT_FILE, JSON.stringify(races, null, 2) + "\n");
  console.log(`Geschrieben: ${OUTPUT_FILE}`);
  await writeFile(DMC_VENUES_FILE, JSON.stringify(dmcVenues, null, 2) + "\n");
  console.log(`Geschrieben: ${DMC_VENUES_FILE} (${dmcVenues.length} Venues)`);
}

main().catch(e => { console.error(e); process.exit(1); });
