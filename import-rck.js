import * as cheerio from "cheerio";
import { access, readFile, writeFile } from "node:fs/promises";

const importerVersion = "import-rck-v4-classes-groups-upcoming";

const sources = [
  {
    id: "rck-kleinserie",
    rckSeries: "kleinserie",
    seriesLabel: "RCK Kleinserie",
    titlePrefix: "RCK Kleinserie",
    url: "https://kleinserie.rck-solutions.de/indexgo.php"
  },
  {
    id: "rck-challenge",
    rckSeries: "challenge",
    seriesLabel: "RCK Challenge",
    titlePrefix: "RCK Challenge",
    url: "https://challenge.rck-solutions.de/indexgo.php"
  }
];

const venuesFile = "venues.json";
const existingRacesFile = "races.json";

const outputFile = "rck-races.json";
const duplicatesFile = "rck-duplicates.json";
const unmatchedVenuesFile = "rck-unmatched-venues.json";

const requestTimeoutMs = 8000;
const retryCount = 1;

const groupLabels = ["mitte", "nord", "west", "süd", "sued", "ost"];

function normalizeText(text = "") {
  return String(text)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const match = normalizeText(value).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
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

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    if (attempt < retryCount) return fetchText(url, attempt + 1);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonIfExists(fileName, fallback = []) {
  try {
    await access(fileName);
    return JSON.parse(await readFile(fileName, "utf8"));
  } catch {
    return fallback;
  }
}

function cleanRckLocation(location = "") {
  return normalizeText(location)
    .replace(/coming\s*soon/gi, "")
    .replace(/^bitte\s+einloggen.*$/i, "")
    .trim();
}

function hasComingSoon(rawLocation = "") {
  return /coming\s*soon/i.test(String(rawLocation));
}

function normalizeRckLocation(location = "") {
  const aliases = {
    "hann munden": "hann munden",
    "hann muenden": "hann munden",
    "hann munden nachtrennen": "hann munden",
    "wächtersbach": "wachtersbach",
    "waechtersbach": "wachtersbach",
    "rheda wiedenbruck": "rheda wiedenbruck",
    "rheda-wiedenbruck": "rheda wiedenbruck",
    "ibbenburen": "ibbenburen",
    "ibbenbueren": "ibbenburen"
  };

  const key = normalizeKey(cleanRckLocation(location));
  return aliases[key] || key;
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

function matchVenueByLocation(location, venues) {
  const locationKey = normalizeRckLocation(location);
  if (!locationKey) return null;

  const exactCity = venues.find(venue => cityFromVenue(venue) === locationKey);
  if (exactCity) return exactCity;

  const exactName = venues.find(venue => normalizeKey(venue.name) === locationKey);
  if (exactName) return exactName;

  return venues.find(venue => {
    const haystack = venueSearchText(venue);
    const city = cityFromVenue(venue);
    if (!city) return false;
    return haystack.includes(locationKey) || locationKey.includes(city);
  }) || null;
}

function documentTypeFromText(value = "") {
  const lower = value.toLowerCase();

  if (
    lower.includes("ausschreibung") ||
    lower.includes("tender") ||
    lower.includes("invitation") ||
    lower.includes("announcement")
  ) return "announcement";

  if (
    lower.includes("reglement") ||
    lower.includes("regel") ||
    lower.includes("rules") ||
    lower.includes("technical")
  ) return "rules";

  if (
    lower.includes("zeitplan") ||
    lower.includes("schedule") ||
    lower.includes("timetable") ||
    lower.includes("ablauf")
  ) return "schedule";

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
    $(link).parent().text(),
    $(link).closest("td").text()
  ];

  $(link).find("img").each((_, img) => {
    textParts.push($(img).attr("alt"));
    textParts.push($(img).attr("title"));
    textParts.push($(img).attr("src"));
  });

  return normalizeText(textParts.filter(Boolean).join(" "));
}

function extractDocumentsFromCell($, cell, baseUrl) {
  const documents = [];
  const seenUrls = new Set();

  $(cell).find("a").each((_, link) => {
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

  $(cell).find("a").each((_, link) => {
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

    if (
      href.includes(".pdf") ||
      href.includes("indexnl.php") ||
      href.includes("indexn.php")
    ) {
      $(link).remove();
    }
  });

  clone.find("img").remove();

  return normalizeText(clone.text());
}

function registrationCountFromNennlisteText(text) {
  const match = text.match(/Gesamtanzahl\s+Nennungen:\s*(\d+)/i);
  if (!match) return null;

  const count = Number(match[1]);
  return Number.isFinite(count) ? count : null;
}

function classesFromNennlisteText(rawText) {
  const lines = String(rawText)
    .split(/\r?\n/)
    .map(line => normalizeText(line))
    .filter(Boolean);

  const classes = [];
  const seen = new Set();

  for (const line of lines) {
    const match = line.match(/^(.+?)\s*-\s*Anzahl\s+Fahrer:\s*(\d+)$/i);
    if (!match) continue;

    const name = normalizeText(match[1]);
    const entries = Number(match[2]);

    if (!name || !Number.isFinite(entries)) continue;

    const key = normalizeKey(name);
    if (seen.has(key)) continue;

    classes.push({ name, entries });
    seen.add(key);
  }

  return classes;
}

async function enrichFromRegistrationPage(race) {
  if (!race.url || race.url === race.detailUrl) return race;

  try {
    const html = await fetchText(race.url);
    const $ = cheerio.load(html);
    const normalizedText = normalizeText($.text());
    const registrationCount = registrationCountFromNennlisteText(normalizedText);
    const classes = classesFromNennlisteText($.text());

    return {
      ...race,
      registrationCount: registrationCount ?? race.registrationCount,
      registrationDisplay:
        registrationCount !== null && registrationCount !== undefined
          ? String(registrationCount)
          : race.registrationDisplay,
      classes
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
        const location = cleanRckLocation(rawLocation);
        if (!normalizeRckLocation(location)) return;

        const documents = extractDocumentsFromCell($, cell, source.url);
        const registrationUrl = extractRegistrationUrlFromCell($, cell, source.url);
        const comingSoon = hasComingSoon(rawLocation) || (!registrationUrl && documents.length === 0);

        const venue = matchVenueByLocation(location, venues);
        const venueId = venue?.id || `rck-unmatched-${slugify(location)}`;
        const venueName = venue?.name || location;
        const venueLocation = venue?.city || venue?.location || location;

        const groupLabel = group === "sued" ? "Süd" : group.charAt(0).toUpperCase() + group.slice(1);
        const name = `${source.titlePrefix} ${groupLabel} - ${location}`;
        const id = `${venueId}-${date}-${slugify(source.id)}-${slugify(groupLabel)}-${slugify(location)}`;

        races.push({
          importerVersion,
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
          rckSeries: source.rckSeries,
          url: registrationUrl || source.url,
          detailUrl: source.url,
          registrationStatus: registrationUrl ? "open" : "upcoming",
          registrationOpens: null,
          registrationRequiresLogin: false,
          registrationSource: "rck",
          registrationCount: null,
          registrationDisplay: null,
          comingSoon,
          note: registrationUrl ? null : "Nennung folgt.",
          rckGroup: groupLabel,
          rckGroups: [groupLabel],
          rckLocation: location,
          classes: [],
          documents
        });
      });
    }
  });

  return races;
}

function uniqueArray(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function mergeDocuments(aDocuments = [], bDocuments = []) {
  const documentsByUrl = new Map();

  for (const document of [...aDocuments, ...bDocuments]) {
    if (!document?.url) continue;
    documentsByUrl.set(document.url, document);
  }

  return Array.from(documentsByUrl.values());
}

function mergeClasses(aClasses = [], bClasses = []) {
  const byName = new Map();

  for (const item of [...aClasses, ...bClasses]) {
    if (!item?.name) continue;
    const key = normalizeKey(item.name);
    const existing = byName.get(key);

    if (!existing || Number(item.entries || 0) > Number(existing.entries || 0)) {
      byName.set(key, {
        name: item.name,
        entries: Number(item.entries || 0)
      });
    }
  }

  return Array.from(byName.values());
}

function mergeRckGroups(a, b) {
  return uniqueArray([
    ...(a.rckGroups || []),
    a.rckGroup,
    ...(b.rckGroups || []),
    b.rckGroup
  ]);
}

function mergedRckName(race, groups) {
  const location = race.rckLocation || race.venueLocation || race.venueName;
  const seriesName = race.series?.[0] || "RCK";
  return `${seriesName} ${groups.join("/")} - ${location}`;
}

function mergeRckRace(a, b) {
  const rckGroups = mergeRckGroups(a, b);
  const documents = mergeDocuments(a.documents, b.documents);
  const classes = mergeClasses(a.classes, b.classes);

  const registrationCount =
    b.registrationCount !== null && b.registrationCount !== undefined
      ? b.registrationCount
      : a.registrationCount;

  const registrationDisplay =
    b.registrationDisplay ||
    a.registrationDisplay ||
    (registrationCount !== null && registrationCount !== undefined ? String(registrationCount) : null);

  const preferredUrl =
    b.url && b.url !== b.detailUrl
      ? b.url
      : a.url && a.url !== a.detailUrl
        ? a.url
        : b.url || a.url;

  const isOpen = a.registrationStatus === "open" || b.registrationStatus === "open";

  return {
    ...a,
    importerVersion,
    name: rckGroups.length > 1 ? mergedRckName(a, rckGroups) : a.name,
    sources: uniqueArray([...(a.sources || [a.source]), ...(b.sources || [b.source])]),
    url: preferredUrl,
    registrationStatus: isOpen ? "open" : "upcoming",
    note: isOpen ? null : "Nennung folgt.",
    comingSoon: !isOpen && (a.comingSoon || b.comingSoon),
    registrationCount,
    registrationDisplay,
    rckGroups,
    classes,
    documents
  };
}

function rckInternalKey(race) {
  const venueKey = race.venueId || normalizeRckLocation(race.rckLocation);
  return [race.from, race.rckSeries, venueKey].join("|");
}

function mergeRckInternally(races) {
  const grouped = new Map();

  for (const race of races) {
    const key = rckInternalKey(race);
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, race);
      continue;
    }

    grouped.set(key, mergeRckRace(existing, race));
  }

  return Array.from(grouped.values());
}

function orgIdFromValue(value) {
  if (!value || typeof value !== "string") return null;

  const decoded = decodeURIComponent(value);

  let match = decoded.match(/myrcm-(\d+)/i);
  if (match) return match[1];

  match = decoded.match(/dId\[O\]=(\d+)/i);
  if (match) return match[1];

  match = decoded.match(/dId%5BO%5D=(\d+)/i);
  if (match) return match[1];

  return null;
}

function raceOrgId(race) {
  return (
    orgIdFromValue(race?.venueId) ||
    orgIdFromValue(race?.id) ||
    orgIdFromValue(race?.detailUrl) ||
    orgIdFromValue(race?.url) ||
    null
  );
}

function looksLikeSameRckRace(a, b) {
  if (!a || !b) return false;
  if (!a.from || !b.from || a.from !== b.from) return false;

  const aOrg = raceOrgId(a);
  const bOrg = raceOrgId(b);

  if (aOrg && bOrg && aOrg === bOrg) return true;
  if (a.venueId && b.venueId && a.venueId === b.venueId) return true;

  const aLocation = normalizeKey([
    a.venueName,
    a.venueLocation,
    a.rckLocation
  ].filter(Boolean).join(" "));

  const bLocation = normalizeKey([
    b.venueName,
    b.venueLocation,
    b.rckLocation
  ].filter(Boolean).join(" "));

  if (!aLocation || !bLocation) return false;

  const locationMatch =
    aLocation.includes(bLocation) ||
    bLocation.includes(aLocation);

  if (!locationMatch) return false;

  const aText = normalizeKey([a.name, ...(a.series || [])].join(" "));
  const bText = normalizeKey([b.name, ...(b.series || [])].join(" "));

  return aText.includes("rck") || bText.includes("rck");
}

function mergeDuplicate(existingRace, rckRace) {
  return {
    ...existingRace,
    importerVersion,
    sources: uniqueArray([
      ...(existingRace.sources || [existingRace.source].filter(Boolean)),
      ...(rckRace.sources || [rckRace.source].filter(Boolean))
    ]),
    registrationSource: "rck",
    rckUrl: rckRace.url,
    url:
      rckRace.url && rckRace.url !== rckRace.detailUrl
        ? rckRace.url
        : existingRace.url,
    registrationStatus:
      rckRace.registrationStatus === "open"
        ? "open"
        : existingRace.registrationStatus,
    registrationCount:
      rckRace.registrationCount !== null && rckRace.registrationCount !== undefined
        ? rckRace.registrationCount
        : existingRace.registrationCount,
    registrationDisplay:
      rckRace.registrationDisplay || existingRace.registrationDisplay,
    classes:
      Array.isArray(existingRace.classes) && existingRace.classes.length
        ? existingRace.classes
        : rckRace.classes,
    documents: mergeDocuments(existingRace.documents, rckRace.documents),
    rckGroups: uniqueArray([
      ...(existingRace.rckGroups || []),
      ...(rckRace.rckGroups || []),
      rckRace.rckGroup
    ]),
    rckMatch: {
      id: rckRace.id,
      series: rckRace.rckSeries,
      group: rckRace.rckGroup,
      groups: rckRace.rckGroups || [],
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

  const internallyMerged = mergeRckInternally(importedRaces)
    .sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));

  const duplicates = [];
  const newRaces = [];

  for (const rckRace of internallyMerged) {
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

  const unmatchedVenues = internallyMerged
    .filter(race => race.venueId?.startsWith("rck-unmatched-"))
    .map(race => ({
      venueId: race.venueId,
      rckSeries: race.rckSeries,
      rckLocation: race.rckLocation,
      venueName: race.venueName,
      raceId: race.id,
      raceName: race.name,
      from: race.from
    }));

  await writeFile(outputFile, JSON.stringify(newRaces, null, 2) + "\n", "utf8");
  await writeFile(duplicatesFile, JSON.stringify(duplicates, null, 2) + "\n", "utf8");
  await writeFile(unmatchedVenuesFile, JSON.stringify(unmatchedVenues, null, 2) + "\n", "utf8");

  console.log(`Importer: ${importerVersion}`);
  console.log(`RCK neue Rennen geschrieben: ${newRaces.length} -> ${outputFile}`);
  console.log(`RCK Dopplungen geschrieben: ${duplicates.length} -> ${duplicatesFile}`);
  console.log(`RCK ungematchte Venues geschrieben: ${unmatchedVenues.length} -> ${unmatchedVenuesFile}`);
  console.log(`RCK rohe Termine: ${importedRaces.length}`);
  console.log(`RCK intern zusammengeführt: ${internallyMerged.length}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
