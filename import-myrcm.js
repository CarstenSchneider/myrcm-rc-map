import * as cheerio from "cheerio";
import { access, readFile, writeFile } from "node:fs/promises";

const hostListFile = "myrcm-hosts-germany.json";
const hostsFile = "hosts.json";
const venuesFile = "venues.json";
const venueSeedsFile = "venue-seeds.json";
const venueUnmatchedFile = "venue-unmatched.json";
const hostLimit = Number(process.env.MYRCM_HOST_LIMIT || 0);
const currentYear = new Date().getFullYear();
const allowedYears = [currentYear - 1, currentYear, currentYear + 1];

const requestTimeoutMs = 8000;
const retryCount = 1;
const detailConcurrency = 5;
const fullImportAttemptCount = 3;
const fullImportRetryDelayMs = 30000;

function oneYearAgoString() {
  // Import window: races older than 365 days are ignored.
  // Hosts with no races left after this filter are skipped entirely.
  const oneYearAgo = new Date();
  oneYearAgo.setDate(oneYearAgo.getDate() - 365);
  return oneYearAgo.toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function markRetryable(error, url) {
  error.retryable = true;
  error.url = url;
  return error;
}

const trainingTerms = [
  "training",
  "trainings",
  "practice"
];

const excludedHostTerms = [
  "kart",
  "karts",
  "kartbahn",
  "kart bahn",
  "kart-center",
  "kartcenter",
  "karting",
  "kartracing",
  "kart racing",
  "kartrennen",
  "kart rennen",
  "go-kart",
  "gokart",
  "kartodrom",
  "kart-o-drom",
  "kartarena",
  "kart arena",
  "motodrom"
];

const excludedEventTerms = [
  "kart",
  "karts",
  "kartbahn",
  "kart bahn",
  "kart-center",
  "kartcenter",
  "karting",
  "kartracing",
  "kart racing",
  "kartrennen",
  "kart rennen",
  "go-kart",
  "gokart",
  "kartodrom",
  "kart-o-drom",
  "kartarena",
  "kart arena",
  "motodrom",
  "standby"
];

const invalidEventNames = [
  "sign up to this event",
  "registration",
  "book in",
  "login",
  "log in",
  "online"
];

function normalizeText(text = "") {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isExcludedHost(host) {
  const text = [
    host.name,
    host.location,
    host.city,
    host.url,
    host.website,
    host.web
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return excludedHostTerms.some(term => text.includes(term));
}

function isExcludedEvent(name) {
  const lower = name.toLowerCase();
  return excludedEventTerms.some(term => lower.includes(term));
}

function parseDate(value) {
  const text = normalizeText(value);
  const match = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseDateTime(value) {
  const text = normalizeText(value);
  const match = text.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!match) return null;

  return {
    date: `${match[3]}-${match[2]}-${match[1]}`,
    time: `${match[4] || "00"}:${match[5] || "00"}`
  };
}

function registrationInfoFromText(text) {
  const normalized = normalizeText(text);
  const lower = normalized.toLowerCase();

  if (!normalized) {
    return {
      registrationStatus: "open",
      registrationOpens: null
    };
  }

  if (lower.includes("sign up to this event")) {
    return {
      registrationStatus: "open",
      registrationOpens: null
    };
  }

  if (
    lower.includes("booking not possible") ||
    lower.includes("will be activated")
  ) {
    const parsed = parseDateTime(normalized);

    return {
      registrationStatus: parsed ? "upcoming" : "closed",
      registrationOpens: parsed?.date || null
    };
  }

  if (
    lower.includes("registration closed") ||
    lower.includes("booking closed") ||
    lower.includes("closed")
  ) {
    return {
      registrationStatus: "closed",
      registrationOpens: null
    };
  }

  const parsed = parseDateTime(normalized);

  if (parsed) {
    const today = new Date().toISOString().slice(0, 10);

    if (parsed.date > today) {
      return {
        registrationStatus: "upcoming",
        registrationOpens: parsed.date
      };
    }

    return {
      registrationStatus: "closed",
      registrationOpens: null
    };
  }

  return {
    registrationStatus: "open",
    registrationOpens: null
  };
}

function registrationNote(info) {
  if (info.registrationStatus === "login_required") {
    return "Anmeldung bei MyRCM nur nach Login sichtbar.";
  }

  if (info.registrationStatus === "upcoming" && info.registrationOpens) {
    return `Nennung ab ${info.registrationOpens.split("-").reverse().join(".")}`;
  }

  if (info.registrationStatus === "closed") {
    return "Nennung geschlossen.";
  }

  return null;
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

function registrationUrl(eventId) {
  if (!eventId) return "";

  const target = new URL("https://www.myrcm.ch/myrcm/main");
  target.searchParams.set("hId[1]", "bkg");
  target.searchParams.set("dId[E]", eventId);
  target.searchParams.set("pLa", "en");

  return target.toString();
}

function registrationListUrl(eventId) {
  if (!eventId) return "";

  const target = new URL("https://www.myrcm.ch/myrcm/main");
  target.searchParams.set("hId[1]", "bkg");
  target.searchParams.set("dId[E]", eventId);
  target.searchParams.set("dLt", "reg");
  target.searchParams.set("pLa", "en");
  target.searchParams.set("lType", "rList");

  return target.toString();
}

function orgEventDetailUrl(host, eventId) {
  if (!eventId || !host.orgId) return null;

  const target = new URL("https://www.myrcm.ch/myrcm/main");
  target.searchParams.set("dId[O]", host.orgId);
  target.searchParams.set("pLa", "en");
  target.searchParams.set("dId[E]", eventId);
  target.searchParams.set("tId", "E");
  target.searchParams.set("hId[1]", "org");

  return target.toString();
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

    throw markRetryable(error, url);
  } finally {
    clearTimeout(timeout);
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

  if (lower.includes("berlin touring masters") || /\bbtm\b/i.test(name)) {
    series.push("BTM");
  }

  if (lower.includes("euro touring series") || /\bets\b/i.test(name)) {
    series.push("ETS");
  }

  if (lower.includes("ostmasters")) {
    series.push("Ostmasters");
  }

  if (lower.includes("rck kleinserie")) {
    series.push("RCK Kleinserie");
  }

  if (lower.includes("rck challenge")) {
    series.push("RCK Challenge");
  }

  if (lower.includes("sk-lauf") || lower.includes("sk lauf") || lower.includes("sportkreis")) {
    series.push("SK");
  }

  if (lower.includes("tamico offroad cup") || lower.includes("tamico")) {
    series.push("Tamico Offroad Cup");
  }

  if (lower.includes("tamiya euro cup") || /\btec\b/i.test(name)) {
    series.push("TEC");
  }

  if (lower.includes("tonisport onroad series") || /\btos\b/i.test(name)) {
    series.push("TOS");
  }

  return Array.from(new Set(series));
}

function raceId(venueId, from, myrcmEventId, name) {
  const suffix = myrcmEventId ? `myrcm-event-${myrcmEventId}` : slugify(name);
  return `${venueId}-${from}-${suffix}`;
}

function hostToVenueId(host) {
  return `myrcm-${host.orgId}-${slugify(host.name)}`;
}

function labelValueMap($) {
  const labels = {};

  $("p").each((_, paragraph) => {
    const paragraphText = normalizeText($(paragraph).text());

    $(paragraph)
      .find(".label")
      .each((_, labelElement) => {
        const label = normalizeText($(labelElement).text()).replace(/:$/, "");
        const valueElement = $(labelElement).next(".value");
        const value = valueElement.length
          ? normalizeText(valueElement.text())
          : normalizeText(paragraphText.replace(`${label}:`, ""));

        if (label) {
          labels[label.toLowerCase()] = value;
        }
      });
  });

  return labels;
}

function firstUsefulHeading($, host) {
  const hostName = normalizeText(host.name);
  const headings = $("h1, h2, h3")
    .toArray()
    .map(heading => normalizeText($(heading).text()))
    .filter(Boolean);

  return (
    headings.find(heading => {
      if (heading === hostName) return false;
      if (heading === host.location) return false;
      if (/^myrcm/i.test(heading)) return false;
      if (isInvalidEventName(heading)) return false;
      return true;
    }) || ""
  );
}

function extractClassesFromDetailPage($) {
  const classes = [];

  $("p").each((_, paragraph) => {
    const labelText = normalizeText($(paragraph).find(".label").first().text()).toLowerCase();

    if (!labelText.startsWith("sections")) return;

    $(paragraph)
      .find("a")
      .each((_, link) => {
        const label = normalizeText($(link).text()).replace(/^→\s*/, "");

        if (!label) return;
        if (label === "?") return;

        classes.push(label);
      });
  });

  return Array.from(new Set(classes));
}

function parseDateRangeFromLabels(labels) {
  const data = labels.data || labels.date || "";
  const dates = [...data.matchAll(/(\d{2})\.(\d{2})\.(\d{4})/g)].map(match => {
    return `${match[3]}-${match[2]}-${match[1]}`;
  });

  return {
    from: dates[0] || null,
    to: dates[1] || dates[0] || null
  };
}

function extractEventDetail(html, host, eventId, listFallback = {}) {
  const $ = cheerio.load(html);
  const labels = labelValueMap($);
  const dateRange = parseDateRangeFromLabels(labels);
  const heading = firstUsefulHeading($, host);
  const classes = extractClassesFromDetailPage($);
  const fullText = normalizeText($.text());

  const name =
    heading ||
    listFallback.name ||
    `MyRCM Event ${eventId}`;

  const from =
    dateRange.from ||
    listFallback.from ||
    null;

  const to =
    dateRange.to ||
    listFallback.to ||
    from;

  const registrationRequiresLogin = /sign up to this event/i.test(fullText);

  return {
    name,
    from,
    to,
    classes,
    registrationRequiresLogin
  };
}

function documentTypeFromText(value = "") {
  const lower = value.toLowerCase();

  if (
    /\btender\b/.test(lower) ||
    lower.includes("ausschreibung") ||
    lower.includes("invitation") ||
    lower.includes("announcement") ||
    lower.includes("notice")
  ) {
    return "announcement";
  }

  if (
    /\brule\b/.test(lower) ||
    lower.includes("reglement") ||
    lower.includes("regel") ||
    lower.includes("rules") ||
    lower.includes("regulations") ||
    lower.includes("technical")
  ) {
    return "rules";
  }

  if (
    lower.includes("zeitplan") ||
    lower.includes("timetable") ||
    lower.includes("schedule") ||
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

function documentSourceLabelFromLink($, link) {
  const linkText = normalizeText($(link).text());
  const row = $(link).closest("tr");

  if (row.length) {
    const cells = row.find("td, th").toArray();
    const linkCellIndex = cells.findIndex(cell => $(cell).find(link).length > 0);

    if (linkCellIndex > 0) {
      const beforeCells = cells.slice(0, linkCellIndex).map(cell => normalizeText($(cell).text()));
      const beforeText = normalizeText(beforeCells.join(" ")).replace(/:$/, "");

      if (beforeText) return beforeText;
    }
  }

  const parentText = normalizeText($(link).parent().text());
  const beforeLinkText = normalizeText(parentText.replace(linkText, "")).replace(/:$/, "");

  if (/^(rule|tender|rules|documents?|reglement|ausschreibung)$/i.test(beforeLinkText)) {
    return beforeLinkText;
  }

  const previousText = normalizeText($(link).prev().text()).replace(/:$/, "");

  if (previousText) return previousText;

  return "";
}

function extractDocumentsFromHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  const documents = [];

  $("a").each((_, link) => {
    const href = $(link).attr("href") || "";
    const linkText = normalizeText($(link).text());
    const titleText = normalizeText($(link).attr("title") || "");
    const sourceLabel = documentSourceLabelFromLink($, link);
    const hrefText = decodeURIComponent(href).replace(/[+_-]+/g, " ");
    const combinedText = normalizeText(`${sourceLabel} ${linkText} ${titleText} ${hrefText}`);

    if (!href || !combinedText.toLowerCase().includes(".pdf")) return;

    const url = new URL(href, pageUrl || "https://www.myrcm.ch").toString();
    const type = documentTypeFromText(combinedText);
    const label = documentLabelFromType(type);
    const fileName = linkText || href.split("/").pop() || label;

    documents.push({
      type,
      label,
      sourceLabel: sourceLabel || null,
      fileName,
      url
    });
  });

  return documents;
}

function mergeDocuments(...documentLists) {
  const documents = new Map();

  for (const list of documentLists) {
    for (const document of list || []) {
      if (!document?.url) continue;
      documents.set(document.url, document);
    }
  }

  return Array.from(documents.values()).sort((a, b) => {
    const order = {
      announcement: 1,
      rules: 2,
      schedule: 3,
      document: 4
    };

    return (order[a.type] || 99) - (order[b.type] || 99) || a.label.localeCompare(b.label);
  });
}


async function loadPreviousRaces(fileName = "races.json") {
  try {
    await access(fileName);
    const raw = await readFile(fileName, "utf8");
    const races = JSON.parse(raw);

    return Array.isArray(races) ? races : [];
  } catch {
    return [];
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

function buildVenueLookup(venues) {
  const lookup = new Map();

  for (const venue of venues || []) {
    if (!venue?.id) continue;

    lookup.set(String(venue.id), venue);

    for (const alias of Array.isArray(venue.aliases) ? venue.aliases : []) {
      if (alias) lookup.set(String(alias), venue);
    }
  }

  return lookup;
}

function buildVenueSeedLookup(venueSeeds = []) {
  const lookup = new Map();

  for (const seed of venueSeeds || []) {
    if (!seed?.id) continue;

    lookup.set(String(seed.id), seed);

    if (seed.myrcmOrgId) {
      lookup.set(`myrcm-${seed.myrcmOrgId}`, seed);
    }

    for (const hostId of Array.isArray(seed.hostIds) ? seed.hostIds : []) {
      if (hostId) lookup.set(`host:${hostId}`, seed);
    }

    for (const alias of Array.isArray(seed.aliases) ? seed.aliases : []) {
      if (alias) lookup.set(String(alias), seed);
    }
  }

  return lookup;
}

function venueSeedForMyRcmHost(venueSeedLookup, host) {
  if (!host?.orgId) return null;

  const myRcmKey = `myrcm-${host.orgId}`;

  return (
    venueSeedLookup.get(myRcmKey) ||
    venueSeedLookup.get(String(host.venueId || "")) ||
    null
  );
}

function venueFromSeed(seed) {
  if (!seed?.id) return null;

  return {
    id: seed.id,
    name: seed.name || seed.id,
    city: seed.city || "",
    lat: seed.lat ?? null,
    lng: seed.lng ?? null,
    aliases: Array.isArray(seed.aliases) ? seed.aliases : [],
    hostIds: Array.isArray(seed.hostIds) ? seed.hostIds : [],
    source: seed.source || "venue-seeds"
  };
}

function normalizedVenueMatchText(value = "") {
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

function venueSearchTerms(seed = {}) {
  const terms = [
    seed.name,
    seed.id,
    seed.city,
    seed.location,
    seed.address,
    seed.postalCode,
    ...(Array.isArray(seed.aliases) ? seed.aliases : [])
  ]
    .filter(Boolean)
    .map(normalizedVenueMatchText)
    .filter(term => term.length >= 4);

  return Array.from(new Set(terms)).sort((a, b) => b.length - a.length);
}

function isHostDefaultVenueSeed(seed = {}, hostRecord = {}, host = {}) {
  const hostIds = Array.isArray(seed.hostIds) ? seed.hostIds.map(String) : [];
  const orgId = myRcmOrgIdFromHost(host);

  return Boolean(
    hostIds.includes(String(hostRecord.id || "")) ||
    (orgId && String(seed.myrcmOrgId || "") === String(orgId))
  );
}

function detectVenueSeedFromRaceText(venueSeeds = [], raceText = "", hostRecord = {}, host = {}) {
  const text = normalizedVenueMatchText(raceText);
  if (!text) return null;

  const matches = [];

  for (const seed of venueSeeds || []) {
    if (!seed?.id) continue;

    for (const term of venueSearchTerms(seed)) {
      if (!term) continue;

      const pattern = new RegExp(`(^|\\s)${term.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(\\s|$)`, "i");

      if (!pattern.test(text)) continue;

      matches.push({
        seed,
        term,
        score:
          term.length +
          (seed.aliases?.some(alias => normalizedVenueMatchText(alias) === term) ? 20 : 0) +
          (normalizedVenueMatchText(seed.name || "") === term ? 10 : 0) +
          (isHostDefaultVenueSeed(seed, hostRecord, host) ? -5 : 0)
      });
    }
  }

  if (!matches.length) return null;

  matches.sort((a, b) => b.score - a.score || b.term.length - a.term.length);

  return matches[0].seed || null;
}

function detectVenueSeedForRace(venueSeeds = [], detail = {}, eventLink = {}, hostRecord = {}, host = {}, defaultVenueSeed = null) {
  const raceText = [
    detail.name,
    eventLink.fallbackName,
    host.location,
    host.city
  ]
    .filter(Boolean)
    .join(" ");

  const explicitVenueSeed = detectVenueSeedFromRaceText(venueSeeds, raceText, hostRecord, host);

  if (explicitVenueSeed) return explicitVenueSeed;

  return defaultVenueSeed || null;
}

function preferredHostId(previous = {}, next = {}) {
  const previousId = String(previous.id || "");
  const nextId = String(next.id || "");

  if (!previousId) return nextId;
  if (!nextId) return previousId;

  if (previousId.startsWith("myrcm-") && !nextId.startsWith("myrcm-")) {
    return nextId;
  }

  return previousId;
}

function preferredHostName(previous = {}, next = {}) {
  const previousName = String(previous.name || "").trim();
  const nextName = String(next.name || "").trim();

  if (!previousName) return nextName;
  if (!nextName) return previousName;

  if (/^myrcm\s+\d+$/i.test(previousName)) return nextName;
  if (previous.id && String(previous.id).startsWith("myrcm-") && next.id && !String(next.id).startsWith("myrcm-")) {
    return nextName;
  }

  return previousName;
}

function mergeHostRecord(previous = {}, next = {}) {
  return {
    ...previous,
    ...next,
    id: preferredHostId(previous, next),
    name: preferredHostName(previous, next),
    website: previous.website || next.website || "",
    myrcmOrgId: previous.myrcmOrgId || next.myrcmOrgId || ""
  };
}

function hostMergeKey(host) {
  if (host?.myrcmOrgId) return `myrcm:${host.myrcmOrgId}`;
  if (host?.id) return `id:${host.id}`;
  return null;
}

function mergeHosts(existingHosts = [], importedHosts = []) {
  const byKey = new Map();

  for (const host of [...(existingHosts || []), ...(importedHosts || [])]) {
    const key = hostMergeKey(host);
    if (!key) continue;

    const previous = byKey.get(key) || {};
    byKey.set(key, mergeHostRecord(previous, host));
  }

  return Array.from(byKey.values()).sort((a, b) => {
    return String(a.name || a.id).localeCompare(String(b.name || b.id));
  });
}

function existingHostForMyRcmHost(existingHosts = [], host) {
  const orgId = myRcmOrgIdFromHost(host);
  if (!orgId) return null;

  const matches = (existingHosts || []).filter(existingHost => String(existingHost?.myrcmOrgId || "") === orgId);

  if (!matches.length) return null;

  return matches.find(existingHost => !String(existingHost.id || "").startsWith("myrcm-")) || matches[0];
}

function unmatchedRecordForMyRcmHost(host, hostRecord, reason) {
  return {
    hostId: hostRecord.id,
    hostName: hostRecord.name,
    source: "myrcm",
    myrcmOrgId: myRcmOrgIdFromHost(host),
    possibleVenue: normalizeText(host.location || host.city || ""),
    reason
  };
}

function mergeUnmatched(existing = [], imported = []) {
  const byKey = new Map();

  for (const item of existing || []) {
    const key = `${item.source || ""}|${item.hostId || ""}|${item.myrcmOrgId || ""}|${item.possibleVenue || ""}`;
    byKey.set(key, item);
  }

  for (const item of imported || []) {
    const key = `${item.source || ""}|${item.hostId || ""}|${item.myrcmOrgId || ""}|${item.possibleVenue || ""}`;
    byKey.set(key, item);
  }

  return Array.from(byKey.values()).sort((a, b) => {
    return String(a.hostName || a.hostId).localeCompare(String(b.hostName || b.hostId));
  });
}

function venueConfigForId(venueLookup, venueId) {
  if (!venueId) return null;

  const id = String(venueId);

  if (venueLookup.has(id)) return venueLookup.get(id);

  for (const [matchId, venue] of venueLookup.entries()) {
    if (id.startsWith(`${matchId}-`)) return venue;
  }

  return null;
}

function hostIdFromMyRcmHost(host, venueSeed = null) {
  if (host.hostId) return String(host.hostId);

  const seedHostId = Array.isArray(venueSeed?.hostIds)
    ? venueSeed.hostIds.find(Boolean)
    : null;

  if (seedHostId) return String(seedHostId);

  return slugify(host.name || `myrcm-${host.orgId}`);
}

function hostNameFromMyRcmHost(host) {
  return normalizeText(host.hostName || host.name || `MyRCM ${host.orgId}`);
}

function myRcmOrgIdFromHost(host) {
  return host.orgId ? String(host.orgId) : "";
}

function hostRecordFromMyRcmHost(host, venueSeed = null, existingHost = null) {
  const importedHost = {
    id: hostIdFromMyRcmHost(host, venueSeed),
    name: hostNameFromMyRcmHost(host),
    website: host.website || host.web || "",
    myrcmOrgId: myRcmOrgIdFromHost(host)
  };

  if (!existingHost) return importedHost;

  return mergeHostRecord(existingHost, importedHost);
}

function hostFieldsForMyRcmRace(host, venueSeed = null) {
  const hostRecord = hostRecordFromMyRcmHost(host, venueSeed);

  return {
    hostId: hostRecord.id,
    hostName: hostRecord.name
  };
}

function raceSignature(race) {
  return [
    race.venueId,
    race.name,
    race.from,
    race.to
  ]
    .filter(Boolean)
    .join("|")
    .toLowerCase();
}

function applyFirstSeen(races, previousRaces, today = new Date().toISOString().slice(0, 10)) {
  const previousById = new Map();
  const previousBySignature = new Map();

  for (const race of previousRaces || []) {
    if (race?.id) {
      previousById.set(race.id, race);
    }

    const signature = raceSignature(race);
    if (signature) {
      previousBySignature.set(signature, race);
    }
  }

  return races.map(race => {
    const previous =
      previousById.get(race.id) ||
      previousBySignature.get(raceSignature(race));

    return {
      ...race,
      firstSeen: previous?.firstSeen || today
    };
  });
}


function registrationTextFromRow($, row) {
  const cells = $(row)
    .find("td")
    .toArray()
    .map(cell => normalizeText($(cell).text()));

  if (!cells.length) return "";

  const explicit = cells.find(cell =>
    /sign up to this event|booking not possible|will be activated|registration closed|booking closed/i.test(cell)
  );

  if (explicit) return explicit;

  const dateTimeCell = cells.find(cell =>
    /\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}/.test(cell)
  );

  return dateTimeCell || "";
}

function parseRegistrationCountInfo(value) {
  const text = normalizeText(value);

  if (!text) {
    return {
      registrationCount: null,
      registrationDisplay: null
    };
  }

  const numberMatches = text.match(/\d+/g);

  if (!numberMatches?.length) {
    return {
      registrationCount: null,
      registrationDisplay: null
    };
  }

  const registrationCount = Number(numberMatches[0]);
  const registrationDisplay = text.replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");

  return {
    registrationCount: Number.isFinite(registrationCount) ? registrationCount : null,
    registrationDisplay
  };
}

function registrationCountInfoFromRow($, row) {
  const cells = $(row)
    .find("td")
    .toArray();

  if (!cells.length) {
    return {
      registrationCount: null,
      registrationDisplay: null
    };
  }

  const table = $(row).closest("table");
  const headers = table
    .find("tr")
    .first()
    .find("th, td")
    .toArray()
    .map(cell => normalizeText($(cell).text()).toLowerCase());

  const countIndex = headers.findIndex(header => {
    return header === "count" || header === "entries" || header === "nennungen";
  });

  if (countIndex >= 0 && countIndex < cells.length) {
    return parseRegistrationCountInfo($(cells[countIndex]).text());
  }

  return {
    registrationCount: null,
    registrationDisplay: null
  };
}

function registrationCountFromRegistrationListText(text) {
  const normalized = normalizeText(text);

  if (!normalized) return null;

  const resultMatch = normalized.match(/Results\s+\d+\s*-\s*\d+\s+from\s+(\d+)/i);
  if (resultMatch) {
    const count = Number(resultMatch[1]);
    if (Number.isFinite(count)) return count;
  }

  const participantMatches = [...normalized.matchAll(/Number\s+of\s+participants\s*:?\s*(\d+)/gi)];
  if (participantMatches.length) {
    const total = participantMatches.reduce((sum, match) => sum + Number(match[1] || 0), 0);
    if (Number.isFinite(total)) return total;
  }

  const driverMatches = [...normalized.matchAll(/Anzahl\s+Fahrer\s*:?\s*(\d+)/gi)];
  if (driverMatches.length) {
    const total = driverMatches.reduce((sum, match) => sum + Number(match[1] || 0), 0);
    if (Number.isFinite(total)) return total;
  }

  return null;
}


function cleanRegistrationClassName(name, entries = null) {
  let cleaned = normalizeText(name)
    .replace(/^section\s*:?\s*/i, "")
    .replace(/^klasse\s*:?\s*/i, "")
    .trim();

  const trailingCountMatch = cleaned.match(/\s*\((\d+)\)\s*$/);

  if (trailingCountMatch) {
    const trailingCount = Number(trailingCountMatch[1]);

    if (entries === null || entries === undefined || trailingCount === Number(entries)) {
      cleaned = cleaned.replace(/\s*\(\d+\)\s*$/, "").trim();
    }
  }

  return cleaned;
}

function classesFromRegistrationListText(rawText) {
  const lines = String(rawText)
    .split(/\r?\n/)
    .map(line => normalizeText(line))
    .filter(Boolean);

  const classes = [];
  const seen = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    let name = null;
    let entries = null;

    const sameLineMatch = line.match(/^(.+?)\s*-\s*(?:Number\s+of\s+participants|Anzahl\s+Fahrer)\s*:?\s*(\d+)$/i);
    if (sameLineMatch) {
      name = sameLineMatch[1];
      entries = Number(sameLineMatch[2]);
    } else if (/^(?:Number\s+of\s+participants|Anzahl\s+Fahrer)\s*:?\s*\d+$/i.test(lines[index + 1] || "")) {
      const countMatch = lines[index + 1].match(/(\d+)/);
      name = line;
      entries = countMatch ? Number(countMatch[1]) : null;
      index += 1;
    }

    if (!name || !Number.isFinite(entries)) continue;

    name = cleanRegistrationClassName(name, entries);
    const key = name.toLowerCase();

    if (!name || seen.has(key)) continue;

    classes.push({ name, entries });
    seen.add(key);
  }

  return classes;
}

function mergeRegistrationClasses(detailClasses = [], registrationClasses = []) {
  const byKey = new Map();

  for (const item of detailClasses || []) {
    const name = typeof item === "string" ? item : item?.name;
    if (!name) continue;

    const cleanedName = cleanRegistrationClassName(name);
    const key = cleanedName.toLowerCase();

    byKey.set(key, cleanedName);
  }

  for (const item of registrationClasses || []) {
    const name = item?.name;
    if (!name) continue;

    const cleanedName = cleanRegistrationClassName(name, item.entries);
    const key = cleanedName.toLowerCase();

    byKey.set(key, {
      name: cleanedName,
      entries: item.entries
    });
  }

  return Array.from(byKey.values());
}

async function enrichFromRegistrationList(eventId, fallback = {}) {
  const url = registrationListUrl(eventId);

  if (!url) return fallback;

  try {
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    const rawText = $.text();
    const registrationCount = registrationCountFromRegistrationListText(rawText);
    const classes = classesFromRegistrationListText(rawText);

    return {
      registrationCount:
        registrationCount !== null && registrationCount !== undefined
          ? registrationCount
          : fallback.registrationCount ?? null,
      registrationDisplay:
        registrationCount !== null && registrationCount !== undefined
          ? String(registrationCount)
          : fallback.registrationDisplay ?? null,
      classes: mergeRegistrationClasses(fallback.classes || [], classes),
      registrationListUrl: url
    };
  } catch (error) {
    if (error.retryable) throw error;

    console.warn(`  Nennliste konnte nicht gelesen werden: ${url}`);
    console.warn(`    ${error.message}`);
    return fallback;
  }
}

function extractEventLinksFromHostPage(html, host) {
  const $ = cheerio.load(html);
  const events = new Map();
  const today = new Date().toISOString().slice(0, 10);
  let totalEventIds = 0;
  let skippedPastEvents = 0;
  let skippedWrongYearEvents = 0;

  $("a").each((_, link) => {
    const href = $(link).attr("href") || "";
    const url = absoluteUrl(href);
    const eventId = eventIdFromUrl(url);

    if (!eventId) return;

    totalEventIds += 1;

    const row = $(link).closest("tr");
    const rowText = normalizeText(row.text());
    const linkText = normalizeText($(link).text());
    const registrationText = registrationTextFromRow($, row);
    const registrationCountInfo = registrationCountInfoFromRow($, row);

    const dates = [...rowText.matchAll(/(\d{2})\.(\d{2})\.(\d{4})/g)].map(match => {
      return `${match[3]}-${match[2]}-${match[1]}`;
    });

    const fallbackFrom = dates[0] || null;
    const fallbackTo = dates[1] || dates[0] || null;

    if (fallbackTo && fallbackTo < oneYearAgoString()) {
      skippedPastEvents += 1;
      return;
    }

    if (fallbackFrom) {
      const fallbackYear = Number(fallbackFrom.slice(0, 4));

      if (!allowedYears.includes(fallbackYear)) {
        skippedWrongYearEvents += 1;
        return;
      }
    }

    const fallbackName =
      !isInvalidEventName(linkText) && !parseDate(linkText)
        ? linkText
        : "";

    if (!events.has(eventId)) {
      events.set(eventId, {
        eventId,
        url,
        fallbackName,
        fallbackFrom,
        fallbackTo,
        registrationText,
        registrationCount: registrationCountInfo.registrationCount,
        registrationDisplay: registrationCountInfo.registrationDisplay
      });
    } else {
      const existing = events.get(eventId);

      if (!existing.fallbackName && fallbackName) {
        existing.fallbackName = fallbackName;
      }

      if (!existing.fallbackFrom && fallbackFrom) {
        existing.fallbackFrom = fallbackFrom;
        existing.fallbackTo = fallbackTo;
      }

      if (!existing.registrationText && registrationText) {
        existing.registrationText = registrationText;
      }

      if (existing.registrationCount === null && registrationCountInfo.registrationCount !== null) {
        existing.registrationCount = registrationCountInfo.registrationCount;
      }

      if (!existing.registrationDisplay && registrationCountInfo.registrationDisplay) {
        existing.registrationDisplay = registrationCountInfo.registrationDisplay;
      }
    }
  });

  return {
    events: [...events.values()],
    totalEventIds,
    skippedPastEvents,
    skippedWrongYearEvents
  };
}

function shouldSkipRace(race) {
  if (!race.name) return true;
  if (isInvalidEventName(race.name)) return true;
  if (isExcludedEvent(race.name)) return true;
  if (hasTrainingName(race.name)) return true;

  const venueText = `${race.venueName || ""} ${race.venueLocation || ""}`.toLowerCase();
  if (excludedHostTerms.some(term => venueText.includes(term))) return true;

  if (
    race.classes?.length === 1 &&
    isInvalidEventName(race.classes[0])
  ) {
    return true;
  }

  if (!race.from || !race.to) return true;

  if (race.to < race.from) return true;

  if (race.to < oneYearAgoString()) return true;

  const raceYear = Number(race.from.slice(0, 4));
  if (!allowedYears.includes(raceYear)) return true;

  return false;
}

async function runLimited(items, limit, worker) {
  const results = [];
  let index = 0;

  async function next() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => next()
  );

  await Promise.all(workers);

  return results;
}

async function parseSingleEvent(eventLink, host, hostRecord, venueSeed, venueSeeds, total, index) {
  const detailUrl = orgEventDetailUrl(host, eventLink.eventId);
  const regUrl = registrationUrl(eventLink.eventId);

  if (!detailUrl) return null;

  try {
    const detailHtml = await fetchText(detailUrl);
    const detail = extractEventDetail(detailHtml, host, eventLink.eventId, {
      name: eventLink.fallbackName,
      from: eventLink.fallbackFrom,
      to: eventLink.fallbackTo
    });

    const detectedVenueSeed = detectVenueSeedForRace(
      venueSeeds,
      detail,
      eventLink,
      hostRecord,
      host,
      venueSeed
    );
    const venue = venueFromSeed(detectedVenueSeed);
    const venueId = venue?.id || null;

    const detailDocuments = extractDocumentsFromHtml(detailHtml, detailUrl);
    let registrationDocuments = [];

    if (regUrl) {
      try {
        const registrationHtml = await fetchText(regUrl);
        registrationDocuments = extractDocumentsFromHtml(registrationHtml, regUrl);
      } catch (error) {
        if (error.retryable) throw error;

        console.warn(`  Nennseite konnte nicht nach PDFs geprüft werden: ${regUrl}`);
        console.warn(`    ${error.message}`);
      }
    }

    const documents = mergeDocuments(detailDocuments, registrationDocuments);

    const registrationInfo = registrationInfoFromText(eventLink.registrationText);
    const registrationStatus = registrationInfo.registrationStatus;

    const registrationListInfo = await enrichFromRegistrationList(eventLink.eventId, {
      registrationCount: eventLink.registrationCount,
      registrationDisplay: eventLink.registrationDisplay,
      classes: detail.classes
    });

    const finalRegistrationInfo = {
      registrationStatus,
      registrationOpens: registrationInfo.registrationOpens
    };

    const hostFields = {
      hostId: hostRecord.id,
      hostName: hostRecord.name
    };
    const raceLocationKey = venueId || hostFields.hostId;

    const race = {
      id: raceId(raceLocationKey, detail.from, eventLink.eventId, detail.name),
      venueId,
      venueName: venue?.name || null,
      venueLocation: venue?.city || null,
      hostId: hostFields.hostId,
      hostName: hostFields.hostName,
      name: detail.name,
      from: detail.from,
      to: detail.to,
      series: detectSeries(detail.name),
      source: "myrcm",
      url: regUrl || detailUrl,
      detailUrl,
      registrationListUrl: registrationListInfo.registrationListUrl,
      registrationStatus,
      registrationOpens: registrationInfo.registrationOpens,
      registrationRequiresLogin: registrationStatus === "login_required",
      registrationCount: registrationListInfo.registrationCount,
      registrationDisplay: registrationListInfo.registrationDisplay,
      note: registrationNote(finalRegistrationInfo),
      classes: registrationListInfo.classes,
      documents
    };

    if (shouldSkipRace(race)) return null;

    if ((index + 1) % 10 === 0 || index + 1 === total) {
      console.log(`    ${index + 1}/${total} Event-Details verarbeitet`);
    }

    return race;
  } catch (error) {
    console.warn(`  Event-Detail konnte nicht geladen werden: ${detailUrl}`);
    console.warn(`    ${error.message}`);
    throw error;
  }
}

async function parseEvents(html, host, hostRecord, venueSeed, venueSeeds) {
  const eventLinkResult = extractEventLinksFromHostPage(html, host);
  const eventLinks = eventLinkResult.events;

  console.log(`  ${eventLinkResult.totalEventIds} Event-IDs gefunden`);

  if (eventLinkResult.skippedPastEvents || eventLinkResult.skippedWrongYearEvents) {
    console.log(
      `  ${eventLinkResult.skippedPastEvents} alte Events und ${eventLinkResult.skippedWrongYearEvents} Events ausserhalb ${allowedYears.join("/")} uebersprungen`
    );
  }

  if (!eventLinks.length) {
    console.log("  Keine aktuellen Events fuer Detailprüfung");
    return [];
  }

  console.log(`  ${eventLinks.length} aktuelle Event-Details werden geprueft`);

  const races = await runLimited(
    eventLinks,
    detailConcurrency,
    (eventLink, index) => parseSingleEvent(eventLink, host, hostRecord, venueSeed, venueSeeds, eventLinks.length, index)
  );

  return races.filter(Boolean);
}

async function loadHosts() {
  const raw = await readFile(hostListFile, "utf8");
  const hosts = JSON.parse(raw);

  const filteredHosts = hosts
    .filter(host => host.orgId && host.name)
    .filter(host => Number(host.eventCount || 0) > 0)
    .filter(host => !isExcludedHost(host))
    .map(host => ({
      ...host,
      url:
        host.url ||
        `https://www.myrcm.ch/myrcm/main?hId[1]=org&dId[O]=${host.orgId}&pLa=en`
    }));

  if (hostLimit > 0) {
    console.log(
      `Host-Limit aktiv: ${Math.min(hostLimit, filteredHosts.length)} von ${filteredHosts.length} Hosts`
    );

    return filteredHosts.slice(0, hostLimit);
  }

  return filteredHosts;
}

async function runImportOnce() {
  const hosts = await loadHosts();
  const existingHosts = await readJsonIfExists(hostsFile, []);
  const venueSeeds = await readJsonIfExists(venueSeedsFile, []);
  const existingUnmatched = await readJsonIfExists(venueUnmatchedFile, []);
  const venueSeedLookup = buildVenueSeedLookup(venueSeeds);
  const previousRaces = await loadPreviousRaces();
  const allRaces = [];
  const importedHosts = [];
  const importedUnmatched = [];

  console.log(`${hosts.length} deutsche Hosts mit Events geladen`);

  for (const host of hosts) {
    const venueSeed = venueSeedForMyRcmHost(venueSeedLookup, host);
    const existingHost = existingHostForMyRcmHost(existingHosts, host);
    const hostRecord = hostRecordFromMyRcmHost(host, venueSeed, existingHost);

    console.log(`Lade MyRCM: ${host.name} (${host.orgId})`);

    let html;

    try {
      html = await fetchText(host.url);
    } catch (error) {
      console.warn(`  Netzwerkfehler bei Host: ${host.name}`);
      console.warn(`    ${error.message}`);
      throw error;
    }

    const races = await parseEvents(html, host, hostRecord, venueSeed, venueSeeds);

    if (!races.length) {
      console.log("  Host wird uebersprungen, weil kein Rennen im aktuellen Importzeitraum gefunden wurde");
      continue;
    }

    importedHosts.push(hostRecord);

    if (races.some(race => !race.venueId)) {
      importedUnmatched.push(
        unmatchedRecordForMyRcmHost(
          host,
          hostRecord,
          "no confirmed venue for at least one current MyRCM race"
        )
      );
    }

    console.log(`  ${races.length} Rennen gefunden`);

    allRaces.push(...races);
  }

  let unique = Array.from(
    new Map(allRaces.map(race => [race.id, race])).values()
  ).sort((a, b) => {
    return a.from.localeCompare(b.from) || a.name.localeCompare(b.name);
  });

  unique = applyFirstSeen(unique, previousRaces);

  const mergedHosts = mergeHosts(existingHosts, importedHosts);
  const mergedUnmatched = mergeUnmatched(existingUnmatched, importedUnmatched);

  await writeFile(
    hostsFile,
    JSON.stringify(mergedHosts, null, 2) + "\n",
    "utf8"
  );

  await writeFile(
    venueUnmatchedFile,
    JSON.stringify(mergedUnmatched, null, 2) + "\n",
    "utf8"
  );

  await writeFile(
    "races.json",
    JSON.stringify(unique, null, 2) + "\n",
    "utf8"
  );

  const racesWithDocuments = unique.filter(race => race.documents?.length);
  const venuesWithDocuments = new Set(racesWithDocuments.map(race => race.venueId));
  const documentTypeCounts = unique.reduce((counts, race) => {
    for (const document of race.documents || []) {
      counts[document.type] = (counts[document.type] || 0) + 1;
    }

    return counts;
  }, {});
  const totalDocuments = Object.values(documentTypeCounts).reduce((sum, count) => sum + count, 0);

  console.log(`hosts.json geschrieben: ${mergedHosts.length} Hosts`);
  console.log(`venue-unmatched.json geschrieben: ${mergedUnmatched.length} offene Venue-Zuordnungen`);
  console.log(`races.json geschrieben: ${unique.length} Rennen`);
  console.log("PDF-Statistik:");
  console.log(`  PDF-Dokumente insgesamt: ${totalDocuments}`);
  console.log(`  Rennen mit PDFs: ${racesWithDocuments.length}`);
  console.log(`  Vereine mit PDFs: ${venuesWithDocuments.size}`);
  console.log(`  Ausschreibungen: ${documentTypeCounts.announcement || 0}`);
  console.log(`  Reglements: ${documentTypeCounts.rules || 0}`);
  console.log(`  Zeitplaene: ${documentTypeCounts.schedule || 0}`);
  console.log(`  Sonstige PDFs: ${documentTypeCounts.document || 0}`);
}

async function main() {
  for (let attempt = 1; attempt <= fullImportAttemptCount; attempt += 1) {
    try {
      if (attempt > 1) {
        console.log(`Import-Neustart ${attempt}/${fullImportAttemptCount}`);
      }

      await runImportOnce();
      return;
    } catch (error) {
      console.error(`Import fehlgeschlagen (${attempt}/${fullImportAttemptCount}).`);
      console.error(error.message || error);

      if (attempt >= fullImportAttemptCount) {
        throw error;
      }

      console.log(`Kompletter Import wird in ${Math.round(fullImportRetryDelayMs / 1000)} Sekunden neu gestartet.`);
      await sleep(fullImportRetryDelayMs);
    }
  }
}

main().catch(error => {
  console.error("Import endgültig fehlgeschlagen. races.json wird nicht aktualisiert.");
  console.error(error);
  process.exit(1);
});
