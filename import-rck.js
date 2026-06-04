import * as cheerio from "cheerio";
import { access, readFile, writeFile } from "node:fs/promises";

const sources = [
  {
    id: "rck-kleinserie",
    seriesLabel: "RCK Kleinserie",
    titlePrefix: "RCK Kleinserie",
    url: "https://kleinserie.rck-solutions.de/indexgo.php",
    classes: [
      "RCK GT-Sport",
      "RCK LMH",
      "RCK Porsche-Cup",
      "RCK VTA",
      "RCK M-Chassis"
    ]
  }

  /*
    Add more RCK sources later if their HTML structure matches.

    Example:
    {
      id: "rck-challenge",
      seriesLabel: "RCK Challenge",
      titlePrefix: "RCK Challenge",
      url: "https://challenge.rck-solutions.de/indexgo.php",
      classes: []
    }
  */
];

const venuesFile = "venues.json";
const existingRacesFile = "races.json";

const outputFile = "rck-races.json";
const duplicatesFile = "rck-duplicates.json";
const unmatchedVenuesFile = "rck-unmatched-venues.json";

const requestTimeoutMs = 8000;
const retryCount = 1;

const groupLabels = [
  "mitte",
  "nord",
  "west",
  "süd",
  "sued",
  "ost"
];

function normalizeText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function normalizeKey(value = "") {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(value = "") {
  return normalizeKey(value)
    .replace(/\s+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function parseDate(value) {
  const text = normalizeText(value);
  const match = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;

  return `${match[3]}-${match[2]}-${match[1]}`;
}

function formatDateForId(date) {
  return date || "unknown-date";
}

function absoluteUrl(href, baseUrl) {
  if (!href) return null;

  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

async function fetchText(url, attempt = 0) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 rck-rc-map importer"
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

async function readJsonIfExists(fileName, fallback = []) {
  try {
    await access(fileName);
    const raw = await readFile(fileName, "utf8");
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return fallback;
  }
}

function venueSearchText(venue = {}) {
  return normalizeKey([
    venue.id,
    venue.name,
    venue.city,
    venue.location,
    venue.address,
    venue.venueName,
    venue.venueLocation
  ].filter(Boolean).join(" "));
}

function cityFromVenue(venue = {}) {
  return normalizeKey(
    venue.city ||
    venue.location ||
    venue.address ||
    venue.name ||
    ""
  );
}

const manualVenueAliases = {
  "hann munden": "hann munden",
  "hann muenden": "hann munden",
  "hann munden nachtrennen": "hann munden",
  "wächtersbach": "wachtersbach",
  "waechtersbach": "wachtersbach",
  "rheda wiedenbruck": "rheda wiedenbruck",
  "rheda-wiedenbruck": "rheda wiedenbruck"
};

function normalizeRckLocation(location = "") {
  let key = normalizeKey(location)
    .replace(/^coming soon\s+/, "")
    .replace(/\bnachtrennen\b/g, "")
    .replace(/\bwm warmup\b/g, "wm warmup")
    .trim();

  key = manualVenueAliases[key] || key;

  return key;
}

function matchVenueByLocation(location, venues) {
  const locationKey = normalizeRckLocation(location);

  if (!locationKey) return null;
  if (locationKey === "coming soon") return null;

  const exactCity = venues.find(venue => cityFromVenue(venue) === locationKey);
  if (exactCity) return exactCity;

  const exactName = venues.find(venue => normalizeKey(venue.name) === locationKey);
  if (exactName) return exactName;

  const contains = venues.find(venue => {
    const haystack = venueSearchText(venue);
    return haystack.includes(locationKey) || locationKey.includes(cityFromVenue(venue));
  });

  return contains || null;
}

function documentTypeFromText(value = "") {
  const lower = value.toLowerCase();

  if (
    lower.includes("ausschreibung") ||
    lower.includes("tender") ||
    lower.includes("invitation") ||
    lower.includes("announcement")
  ) {
    return "announcement";
  }

  if (
    lower.includes("reglement") ||
    lower.includes("regel") ||
    lower.includes("rules") ||
    lower.includes("technical")
  ) {
    return "rules";
  }

  if (
    lower.includes("zeitplan") ||
    lower.includes("schedule") ||
    lower.includes("timetable") ||
    lower.includes("ablauf")
  ) {
    return "schedule";
  }

  return "document";
}

function documentLabelFromType(type) {
  if (type === "announcement") return "Ausschreibung";
  if (type === "rules") return "Reglement";
  if (type === "schedule") return "Zeitplan";
  return "PDF";
}

function documentSourceText($, link) {
  const textParts = [
    $(link).text(),
    $(link).attr("title"),
    $(link).attr("alt"),
    $(link).closest("a").text(),
    $(link).parent().text(),
    $(link).closest("td").text()
  ];

  $(link)
    .find("img")
    .each((_, img) => {
      textParts.push($(img).attr("alt"));
      textParts.push($(img).attr("title"));
      textParts.push($(img).attr("src"));
    });

  return normalizeText(textParts.filter(Boolean).join(" "));
}

function extractDocumentsFromCell($, cell, baseUrl) {
  const documents = [];
  const seenUrls = new Set();

  $(cell)
    .find("a")
    .each((_, link) => {
      const href = $(link).attr("href") || "";
      const url = absoluteUrl(href, baseUrl);

      if (!url || seenUrls.has(url)) return;

      const text = documentSourceText($, link);
      const lower = `${href} ${text}`.toLowerCase();

      if (!lower.includes(".pdf")) return;

      const type = documentTypeFromText(lower);
      const fileName = decodeURIComponent(url.split("/").pop() || "").split("?")[0];

      documents.push({
        type,
        label: documentLabelFromType(type),
        sourceLabel: text || null,
        fileName: fileName || documentLabelFromType(type),
        url
      });

      seenUrls.add(url);
    });

  return documents;
}

function extractRegistrationUrlFromCell($, cell, baseUrl) {
  const candidates = [];

  $(cell)
    .find("a")
    .each((_, link) => {
      const href = $(link).attr("href") || "";
      const url = absoluteUrl(href, baseUrl);
      const text = documentSourceText($, link).toLowerCase();
      const lowerHref = href.toLowerCase();

      if (!url) return;

      if (
        lowerHref.includes("indexnl.php") ||
        lowerHref.includes("indexn.php") ||
        lowerHref.includes("nenn") ||
        text.includes("nenn") ||
        text.includes("registration") ||
        text.includes("anmeldung")
      ) {
        candidates.push(url);
      }
    });

  return candidates[0] || null;
}

function extractLocationText($, cell) {
  const clone = $(cell).clone();

  clone.find("script, style").remove();

  clone.find("a").each((_, link) => {
    const href = ($(link).attr("href") || "").toLowerCase();
    if (href.includes(".pdf") || href.includes("indexnl.php") || href.includes("indexn.php")) {
      $(link).remove();
    }
  });

  clone.find("img").remove();

  const text = normalizeText(clone.text())
    .replace(/^coming soon\s+/i, "coming soon ")
    .trim();

  return text;
}

function isUsefulLocation(text) {
  const normalized = normalizeRckLocation(text);
  if (!normalized) return false;
  if (normalized === "coming soon") return false;
  return true;
}

function classLabelsFromNennlisteText(text) {
  const classes = [];

  for (const match of text.matchAll(/([A-Za-z0-9ÄÖÜäöüß:\- ]+?)\s*-\s*Anzahl Fahrer:/g)) {
    const label = normalizeText(match[1]);
    if (!label) continue;
    if (/gesamtanzahl/i.test(label)) continue;
    classes.push(label);
  }

  return Array.from(new Set(classes));
}

function registrationCountFromNennlisteText(text) {
  const match = text.match(/Gesamtanzahl\s+Nennungen:\s*(\d+)/i);
  if (!match) return null;

  const count = Number(match[1]);
  return Number.isFinite(count) ? count : null;
}

async function enrichFromRegistrationPage(race) {
  if (!race.url) return race;

  try {
    const html = await fetchText(race.url);
    const $ = cheerio.load(html);
    const text = normalizeText($.text());

    const registrationCount = registrationCountFromNennlisteText(text);
    const classes = classLabelsFromNennlisteText(text);

    return {
      ...race,
      registrationCount: registrationCount ?? race.registrationCount,
      registrationDisplay:
        registrationCount !== null && registrationCount !== undefined
          ? String(registrationCount)
          : race.registrationDisplay,
      classes: classes.length ? classes : race.classes
    };
  } catch (error) {
    console.warn(`  RCK-Nennliste konnte nicht gelesen werden: ${race.url}`);
    console.warn(`    ${error.message}`);
    return race;
  }
}

function extractRacesFromTable(html, source, venues) {
  const $ = cheerio.load(html);
  const races = [];

  $("table").each((_, table) => {
    const rows = $(table).find("tr").toArray();
    if (!rows.length) return;

    let headers = [];

    for (const row of rows) {
      const headerCells = $(row).find("th, td").toArray();
      const possibleHeaders = headerCells.map(cell => normalizeText($(cell).text()).toLowerCase());

      if (
        possibleHeaders.includes("datum") &&
        possibleHeaders.some(header => groupLabels.includes(header))
      ) {
        headers = possibleHeaders;
        continue;
      }

      if (!headers.length) continue;

      const cells = $(row).find("td, th").toArray();
      if (cells.length < 2) continue;

      const date = parseDate($(cells[0]).text());
      if (!date) continue;

      cells.slice(1).forEach((cell, index) => {
        const group = headers[index + 1] || "";
        if (!groupLabels.includes(group)) return;

        const rawLocation = extractLocationText($, cell);
        if (!isUsefulLocation(rawLocation)) return;

        const location = rawLocation.replace(/^coming soon\s+/i, "").trim();
        const venue = matchVenueByLocation(location, venues);
        const venueId = venue?.id || `rck-unmatched-${slugify(location)}`;
        const venueName = venue?.name || location;
        const venueLocation = venue?.city || venue?.location || location;

        const documents = extractDocumentsFromCell($, cell, source.url);
        const registrationUrl = extractRegistrationUrlFromCell($, cell, source.url);

        const groupLabel = group === "sued" ? "Süd" : group.charAt(0).toUpperCase() + group.slice(1);
        const name = `${source.titlePrefix} ${groupLabel} - ${location}`;
        const id = `${venueId}-${formatDateForId(date)}-${slugify(source.id)}-${slugify(groupLabel)}-${slugify(location)}`;

        races.push({
          id,
          venueId,
          venueName,
          venueLocation,
          name,
          from: date,
          to: date,
          series: [source.seriesLabel],
          source: source.id,
          sources: [source.id],
          url: registrationUrl || source.url,
          detailUrl: source.url,
          registrationStatus: registrationUrl ? "open" : "external",
          registrationOpens: null,
          registrationRequiresLogin: false,
          registrationSource: "rck",
          registrationCount: null,
          registrationDisplay: null,
          rckGroup: groupLabel,
          rckLocation: location,
          classes: source.classes,
          documents
        });
      });
    }
  });

  return races;
}

function raceSignature(race) {
  return [
    race.venueId,
    race.from,
    race.to,
    normalizeKey((race.series || []).join(" ")),
    normalizeKey(race.name).replace(/\brck\b/g, "").replace(/\bkleinserie\b/g, "").trim()
  ]
    .filter(Boolean)
    .join("|");
}

function looksLikeSameRckRace(a, b) {
  if (!a || !b) return false;
  if (!a.from || !b.from || a.from !== b.from) return false;
  if (a.to && b.to && a.to !== b.to) return false;
  if (a.venueId && b.venueId && a.venueId !== b.venueId) return false;

  const aText = normalizeKey([
    a.name,
    ...(a.series || [])
  ].join(" "));

  const bText = normalizeKey([
    b.name,
    ...(b.series || [])
  ].join(" "));

  const rckA = aText.includes("rck");
  const rckB = bText.includes("rck");

  if (rckA || rckB) return true;

  const sharedWords = aText
    .split(" ")
    .filter(word => word.length > 3 && bText.includes(word));

  return sharedWords.length >= 2;
}

function mergeDuplicate(existingRace, rckRace) {
  const existingDocuments = Array.isArray(existingRace.documents) ? existingRace.documents : [];
  const rckDocuments = Array.isArray(rckRace.documents) ? rckRace.documents : [];

  const documentsByUrl = new Map();
  for (const document of [...existingDocuments, ...rckDocuments]) {
    if (!document?.url) continue;
    documentsByUrl.set(document.url, document);
  }

  return {
    ...existingRace,
    sources: Array.from(new Set([...(existingRace.sources || [existingRace.source].filter(Boolean)), rckRace.source])),
    registrationSource: rckRace.registrationSource,
    url: rckRace.url || existingRace.url,
    registrationStatus:
      rckRace.registrationStatus === "open"
        ? "open"
        : existingRace.registrationStatus,
    registrationCount: rckRace.registrationCount ?? existingRace.registrationCount,
    registrationDisplay: rckRace.registrationDisplay ?? existingRace.registrationDisplay,
    classes:
      Array.isArray(existingRace.classes) && existingRace.classes.length
        ? existingRace.classes
        : rckRace.classes,
    documents: Array.from(documentsByUrl.values()),
    rckMatch: {
      id: rckRace.id,
      group: rckRace.rckGroup,
      location: rckRace.rckLocation
    }
  };
}

async function main() {
  const venues = await readJsonIfExists(venuesFile, []);
  const existingRaces = await readJsonIfExists(existingRacesFile, []);

  const importedRaces = [];

  for (const source of sources) {
    console.log(`Lade RCK: ${source.seriesLabel}`);

    let html;

    try {
      html = await fetchText(source.url);
    } catch (error) {
      console.warn(`  RCK-Quelle konnte nicht geladen werden: ${source.url}`);
      console.warn(`    ${error.message}`);
      continue;
    }

    const races = extractRacesFromTable(html, source, venues);

    console.log(`  ${races.length} RCK-Termine gefunden`);

    for (let index = 0; index < races.length; index += 1) {
      if ((index + 1) % 10 === 0 || index + 1 === races.length) {
        console.log(`  ${index + 1}/${races.length} RCK-Termine angereichert`);
      }

      importedRaces.push(await enrichFromRegistrationPage(races[index]));
    }
  }

  const uniqueImported = Array.from(
    new Map(importedRaces.map(race => [race.id, race])).values()
  ).sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));

  const duplicates = [];
  const newRaces = [];

  for (const rckRace of uniqueImported) {
    const existing = existingRaces.find(existingRace => looksLikeSameRckRace(existingRace, rckRace));

    if (existing) {
      duplicates.push({
        existingRaceId: existing.id,
        rckRaceId: rckRace.id,
        merged: mergeDuplicate(existing, rckRace),
        rck: rckRace
      });
    } else {
      newRaces.push(rckRace);
    }
  }

  const unmatchedVenues = uniqueImported
    .filter(race => race.venueId?.startsWith("rck-unmatched-"))
    .map(race => ({
      venueId: race.venueId,
      rckLocation: race.rckLocation,
      venueName: race.venueName,
      raceId: race.id,
      raceName: race.name,
      from: race.from
    }));

  await writeFile(outputFile, JSON.stringify(newRaces, null, 2) + "\n", "utf8");
  await writeFile(duplicatesFile, JSON.stringify(duplicates, null, 2) + "\n", "utf8");
  await writeFile(unmatchedVenuesFile, JSON.stringify(unmatchedVenues, null, 2) + "\n", "utf8");

  console.log(`RCK neue Rennen geschrieben: ${newRaces.length} -> ${outputFile}`);
  console.log(`RCK Dopplungen geschrieben: ${duplicates.length} -> ${duplicatesFile}`);
  console.log(`RCK ungematchte Venues geschrieben: ${unmatchedVenues.length} -> ${unmatchedVenuesFile}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
