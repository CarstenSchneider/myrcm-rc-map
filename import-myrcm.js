import * as cheerio from "cheerio";
import { readFile, writeFile } from "node:fs/promises";

const hostListFile = "myrcm-hosts-germany.json";
const currentYear = new Date().getFullYear();
const allowedYears = [currentYear, currentYear + 1];

const requestTimeoutMs = 10000;
const retryCount = 1;

const trainingTerms = [
  "training",
  "trainings",
  "practice"
];

const excludedHostTerms = [
  "kartbahn",
  "kart bahn",
  "kart-center",
  "kartcenter",
  "karting",
  "go-kart",
  "gokart",
  "motodrom"
];

const excludedEventTerms = [
  "kartbahn",
  "kart bahn",
  "karting",
  "standby"
];

const invalidEventNames = [
  "sign up to this event",
  "registration",
  "book in",
  "login"
];

function isExcludedHost(host) {
  const text = `${host.name} ${host.location}`.toLowerCase();
  return excludedHostTerms.some(term => text.includes(term));
}

function isExcludedEvent(name) {
  const lower = name.toLowerCase();
  return excludedEventTerms.some(term => lower.includes(term));
}

function normalizeText(text = "") {
  return text.replace(/\s+/g, " ").trim();
}

function parseDate(value) {
  const text = normalizeText(value);
  const match = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function hasTrainingName(name) {
  const lower = name.toLowerCase();

  if (/\bgastfahrer/i.test(lower)) return false;
  if (/\bgastfahrertag/i.test(lower)) return false;
  if (/\bgastfahrtag/i.test(lower)) return false;
  if (/\bgastklasse/i.test(lower)) return false;

  return trainingTerms.some(term => lower.includes(term));
}

function isInvalidEventName(text) {
  const lower = normalizeText(text).toLowerCase();
  return invalidEventNames.includes(lower);
}

function absoluteUrl(href) {
  if (!href) return "";
  return new URL(href, "https://www.myrcm.ch").toString();
}

function eventIdFromUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url, "https://www.myrcm.ch");
    return parsed.searchParams.get("dId[E]");
  } catch {
    return null;
  }
}

function registrationUrl(url) {
  const eventId = eventIdFromUrl(url);

  if (!eventId) return url;

  const target = new URL("https://www.myrcm.ch/myrcm/main");
  target.searchParams.set("hId[1]", "bkg");
  target.searchParams.set("dId[E]", eventId);
  target.searchParams.set("pLa", "en");

  return target.toString();
}

function searchUrlsForEvent(eventUrl, host) {
  const eventId = eventIdFromUrl(eventUrl);
  if (!eventId) return [];

  const dFiCandidates = [
    host.location,
    host.name,
    host.name?.replace(/\be\.?\s*v\.?\b/gi, ""),
    ""
  ]
    .map(value => normalizeText(value || ""))
    .filter((value, index, list) => list.indexOf(value) === index);

  return dFiCandidates.map(dFi => {
    const target = new URL("https://www.myrcm.ch/myrcm/main");
    target.searchParams.set("hId[1]", "search");
    target.searchParams.set("dId[E]", eventId);
    target.searchParams.set("pLa", "en");

    if (dFi) {
      target.searchParams.set("dFi", dFi);
    }

    return target.toString();
  });
}

async function fetchText(url, attempt = 0) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 myrcm-rc-map importer"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    if (attempt < retryCount) {
      return fetchText(url, attempt + 1);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function cleanEventNameCandidate(text, host) {
  const normalized = normalizeText(text);

  if (!normalized) return "";
  if (parseDate(normalized)) return "";
  if (/^(deu|ger|germany|deutschland)$/i.test(normalized)) return "";
  if (/^\d+$/.test(normalized)) return "";
  if (normalized.toLowerCase().includes("registration")) return "";
  if (isInvalidEventName(normalized)) return "";
  if (normalized === host.name) return "";
  if (normalized === host.location) return "";
  if (normalized === host.country) return "";

  return normalized;
}

function chooseEventNameFromCells(cells, host) {
  for (const text of cells) {
    const candidate = cleanEventNameCandidate(text, host);
    if (candidate) return candidate;
  }

  return "";
}

function chooseEventNameFromLinks($, row, host, eventId) {
  const candidates = [];

  $(row).find("a").each((_, link) => {
    const href = $(link).attr("href") || "";
    const text = normalizeText($(link).text());

    if (!href.includes(`dId[E]=${eventId}`) && !href.includes(`dId%5BE%5D=${eventId}`)) {
      return;
    }

    const candidate = cleanEventNameCandidate(text, host);
    if (candidate) candidates.push(candidate);
  });

  return candidates[0] || "";
}

function extractEventNameFromSearchPage(html, eventId, host) {
  const $ = cheerio.load(html);

  let bestCandidate = "";

  $("tr").each((_, row) => {
    if (bestCandidate) return;

    const rowHtml = $.html(row);
    if (!rowHtml.includes(`dId[E]=${eventId}`) && !rowHtml.includes(`dId%5BE%5D=${eventId}`)) {
      return;
    }

    const linkCandidate = chooseEventNameFromLinks($, row, host, eventId);
    if (linkCandidate) {
      bestCandidate = linkCandidate;
      return;
    }

    const cells = $(row)
      .find("td")
      .toArray()
      .map(cell => normalizeText($(cell).text()));

    bestCandidate = chooseEventNameFromCells(cells, host);
  });

  if (bestCandidate) return bestCandidate;

  const title = normalizeText($("title").text());
  const titleCandidate = cleanEventNameCandidate(title.replace(/^MyRCM\s*[-–]\s*/i, ""), host);

  if (titleCandidate) return titleCandidate;

  return "";
}

async function resolveEventName(originalName, eventUrl, host, cells) {
  if (originalName && !isInvalidEventName(originalName)) {
    return {
      name: originalName,
      nameRequiresLogin: false
    };
  }

  const eventId = eventIdFromUrl(eventUrl);
  const fallbackUrls = searchUrlsForEvent(eventUrl, host);

  if (!eventId || !fallbackUrls.length) {
    console.warn(`WARN: Eventname nicht auflösbar (${host.name})`);
    console.warn(`      Zellen: ${JSON.stringify(cells)}`);

    return {
      name: `MyRCM Event ${eventId || "ohne ID"}`,
      nameRequiresLogin: true
    };
  }

  for (const fallbackUrl of fallbackUrls) {
    try {
      const html = await fetchText(fallbackUrl);
      const resolvedName = extractEventNameFromSearchPage(html, eventId, host);

      if (resolvedName) {
        console.warn(`INFO: Eventname per Search-Fallback gelesen: ${resolvedName} (${host.name})`);
        return {
          name: resolvedName,
          nameRequiresLogin: false
        };
      }
    } catch (error) {
      console.warn(`WARN: Search-Fallback fehlgeschlagen (${host.name}, dId[E]=${eventId}): ${error.message}`);
      console.warn(`      URL: ${fallbackUrl}`);
    }
  }

  console.warn(`WARN: Login-pflichtiger Event ohne öffentlich lesbaren Namen (${host.name}, dId[E]=${eventId})`);
  console.warn(`      Zellen: ${JSON.stringify(cells)}`);

  return {
    name: `MyRCM Event ${eventId}`,
    nameRequiresLogin: true
  };
}

async function loadEventClasses(url) {
  if (!url) return [];

  const classUrl = registrationUrl(url);

  try {
    const html = await fetchText(classUrl);
    const $ = cheerio.load(html);

    const sectionClasses = [];

    $('select[name="Section"] option').each((_, option) => {
      const value = $(option).attr("value");
      const label = normalizeText($(option).text());

      if (!value) return;
      if (!label) return;
      if (label === "?") return;

      sectionClasses.push(label);
    });

    return Array.from(new Set(sectionClasses));
  } catch (error) {
    console.warn(`  Klassen konnten nicht geladen werden: ${classUrl}`);
    return [];
  }
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
}

function detectSeries(name) {
  const lower = name.toLowerCase();
  const series = [];

  if (lower.includes("berlin touring masters") || lower.includes("btm")) {
    series.push("BTM");
  }

  if (lower.includes("tamiya euro cup") || lower.includes("tamiya")) {
    series.push("TEC");
  }

  if (lower.includes("sk-lauf") || lower.includes("sk lauf")) {
    series.push("SK");
  }

  if (lower.includes("speed masters")) {
    series.push("Speed Masters");
  }

  if (lower.includes("rck kleinserie")) {
    series.push("RCK Kleinserie");
  }

  if (lower.includes("rck challenge")) {
    series.push("RCK Challenge");
  }

  if (lower.includes("ostmasters")) {
    series.push("Ostmasters");
  }

  return Array.from(new Set(series));
}

function eventId(venueId, name, from, eventUrl) {
  const myrcmEventId = eventIdFromUrl(eventUrl);
  const suffix = myrcmEventId ? `myrcm-event-${myrcmEventId}` : slugify(name);
  return `${venueId}-${from}-${suffix}`;
}

function hostToVenueId(host) {
  return `myrcm-${host.orgId}-${slugify(host.name)}`;
}

async function parseEvents(html, host) {
  const $ = cheerio.load(html);
  const races = [];
  const venueId = host.venueId || hostToVenueId(host);

  const rows = $("tr").toArray();

  for (const row of rows) {
    const cells = $(row)
      .find("td")
      .toArray()
      .map(cell => normalizeText($(cell).text()));

    if (cells.length < 4) continue;

    const links = $(row).find("a").toArray();
    const href = links.length ? $(links[links.length - 1]).attr("href") : "";
    const url = absoluteUrl(href) || host.url;

    const myrcmEventId = eventIdFromUrl(url);
    if (!myrcmEventId) continue;

    const dateCells = cells.map(parseDate);

    const validDateIndexes = dateCells
      .map((date, index) => (date ? index : -1))
      .filter(index => index >= 0);

    if (!validDateIndexes.length) continue;

    const from = dateCells[validDateIndexes[0]];
    const to = dateCells[validDateIndexes[1]] || from;

    if (to < from) {
      console.warn(`WARN: Enddatum liegt vor Startdatum (${host.name})`);
      console.warn(`      from=${from}, to=${to}`);
      console.warn(`      Zellen: ${JSON.stringify(cells)}`);
      continue;
    }

    const today = new Date().toISOString().slice(0, 10);

    if (to < today) continue;

    const raceYear = Number(from.slice(0, 4));
    if (!allowedYears.includes(raceYear)) continue;

    const rawName = chooseEventNameFromCells(cells, host);
    const resolved = await resolveEventName(rawName, url, host, cells);
    const name = resolved.name;

    if (!name) continue;
    if (hasTrainingName(name)) continue;
    if (isExcludedEvent(name)) continue;

    const registrationRequiresLogin =
      resolved.nameRequiresLogin ||
      cells.some(text => /sign up to this event/i.test(text));

    races.push({
      id: eventId(venueId, name, from, url),
      venueId,
      venueName: host.name,
      venueLocation: host.location,
      name,
      from,
      to,
      series: detectSeries(name),
      source: "myrcm",
      url,
      registrationRequiresLogin,
      note: registrationRequiresLogin
        ? "Anmeldung bei MyRCM nur nach Login sichtbar."
        : null
    });
  }

  return races;
}

async function enrichRacesWithClasses(races) {
  const enriched = [];

  for (const race of races) {
    const classes = await loadEventClasses(race.url);

    enriched.push({
      ...race,
      classes
    });
  }

  return enriched;
}

async function loadHosts() {
  const raw = await readFile(hostListFile, "utf8");
  const hosts = JSON.parse(raw);

  return hosts
    .filter(host => host.orgId && host.name)
    .filter(host => Number(host.eventCount || 0) > 0)
    .filter(host => !isExcludedHost(host))
    .map(host => ({
      ...host,
      url:
        host.url ||
        `https://www.myrcm.ch/myrcm/main?hId[1]=org&dId[O]=${host.orgId}&pLa=en`
    }));
}

async function main() {
  const hosts = await loadHosts();
  const allRaces = [];

  console.log(`${hosts.length} deutsche Hosts mit Events geladen`);

  for (const host of hosts) {
    console.log(`Lade MyRCM: ${host.name} (${host.orgId})`);

    let html;

    try {
      html = await fetchText(host.url);
    } catch (error) {
      console.warn(`  Übersprungen wegen Netzwerkfehler: ${host.name}`);
      continue;
    }

    const races = await parseEvents(html, host);
    const enrichedRaces = await enrichRacesWithClasses(races);

    console.log(`  ${enrichedRaces.length} Rennen gefunden`);

    allRaces.push(...enrichedRaces);
  }

  const unique = Array.from(
    new Map(allRaces.map(race => [race.id, race])).values()
  ).sort((a, b) => {
    return a.from.localeCompare(b.from) || a.name.localeCompare(b.name);
  });

  await writeFile(
    "races.json",
    JSON.stringify(unique, null, 2) + "\n",
    "utf8"
  );

  console.log(`races.json geschrieben: ${unique.length} Rennen`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
