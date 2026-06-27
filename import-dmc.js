import { readFile, writeFile } from "node:fs/promises";

const RC_CLOUD_URL = "https://api.rc-cloud.de/germany";
const OUTPUT_FILE = "dmc-races.json";
const TIMEOUT_MS = 20000;

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

async function fetchGermany() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RC_CLOUD_URL, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "rcracemap-importer/1.0"
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} von ${RC_CLOUD_URL}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadVenues() {
  try {
    return JSON.parse(await readFile("venues.json", "utf8"));
  } catch { return []; }
}

async function loadHosts() {
  try {
    return JSON.parse(await readFile("hosts.json", "utf8"));
  } catch { return []; }
}

function matchVenue(locationText, venues, hosts) {
  if (!locationText) return null;
  const key = normalizeKey(locationText);

  // Try matching host name first → then find venue via hostId
  const host = hosts.find(h => {
    const hKey = normalizeKey(h.name || "");
    return hKey && (hKey === key || key.includes(hKey) || hKey.includes(key));
  });

  if (host) {
    const venue = venues.find(v =>
      Array.isArray(v.hostIds) && v.hostIds.includes(host.id)
    );
    if (venue) return venue;
  }

  // Fall back: match against venue aliases
  return venues.find(v => {
    const searchText = normalizeKey([
      v.name, v.city, ...(v.aliases || [])
    ].filter(Boolean).join(" "));
    return searchText.includes(key) || key.includes(normalizeKey(v.name || ""));
  }) || null;
}

async function main() {
  console.log(`Lade ${RC_CLOUD_URL} …`);
  let page;
  try {
    page = await fetchGermany();
  } catch (e) {
    console.error(`Fehler: ${e.message}`);
    process.exit(1);
  }

  console.log(`Stand: ${page.lastUpdate}`);

  const venues = await loadVenues();
  const hosts = await loadHosts();

  const dmcRaces = [];
  let totalSeen = 0;
  let dmcCount = 0;

  for (const dateEntry of (page.dates ?? [])) {
    const dateEnd = dateEntry.dateEnd; // ISO date string
    for (const cat of (dateEntry.categories ?? [])) {
      for (const race of (cat.races ?? [])) {
        totalSeen++;
        if (race.source !== "DMC") continue;
        dmcCount++;

        const location = race.location || "";
        const venue = matchVenue(location, venues, hosts);
        const hostSlug = slugify(location);
        const id = `dmc-${hostSlug}-${race.date || dateEnd}`;

        const series = (race.series ?? []).map(s => s.id).filter(Boolean);

        dmcRaces.push({
          id,
          venueId: venue?.id ?? null,
          venueName: venue?.name ?? null,
          venueLocation: venue?.city ?? null,
          hostId: venue?.hostIds?.[0] ?? `dmc-${hostSlug}`,
          hostName: location,
          name: race.title || "DMC Rennen",
          from: race.date || dateEnd,
          to: dateEnd,
          series,
          classes: [],
          source: "dmc",
          url: null,
          registrationStatus: null,
          registrationOpens: null
        });
      }
    }
  }

  console.log(`Gesamt: ${totalSeen} Rennen, davon ${dmcCount} DMC`);
  console.log(`Venue-Matches: ${dmcRaces.filter(r => r.venueId).length} / ${dmcRaces.length}`);

  await writeFile(OUTPUT_FILE, JSON.stringify(dmcRaces, null, 2) + "\n");
  console.log(`Geschrieben: ${OUTPUT_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
