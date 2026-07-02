import * as cheerio from "cheerio";
import { access, readFile, writeFile } from "node:fs/promises";
import { safeWriteJson, warnIfSparse } from "./import-utils.js";

const hostListFile = "myrcm-hosts-dach.json";
const beneluxHostListFile = "myrcm-hosts-benelux.json";
const czHostListFile = "myrcm-hosts-cz.json";
const hostsFile = "hosts.json";
const venuesFile = "venues.json";
const venueSeedsFile = "venue-seeds.json";
const venueUnmatchedFile = "venue-unmatched.json";
const seriesFile = "series.json";
const hostLimit = Number(process.env.MYRCM_HOST_LIMIT || 0);
const countryOnly = process.env.MYRCM_COUNTRY_ONLY || "";
const currentYear = new Date().getFullYear();
const allowedYears = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];

const requestTimeoutMs = 8000;
const retryCount = 1;
const detailConcurrency = 5;
const fullImportAttemptCount = 3;
const fullImportRetryDelayMs = 30000;

function twoYearsAgoString() {
  // Import window: races older than 2 years are ignored.
  // Hosts with no races left after this filter are skipped entirely.
  const twoYearsAgo = new Date();
  twoYearsAgo.setDate(twoYearsAgo.getDate() - 730);
  return twoYearsAgo.toISOString().slice(0, 10);
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

// MyRCM org IDs to exclude permanently (e.g. slot car series)
const excludedMyrcmOrgIds = new Set([
  "60453", // Slottis Supreme Masters — slot car series
  "4",     // RC-Timing — MyRCM test account (publishes only test events)
]);

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

const slotcarSignalTerms = [
  "slotcar",
  "slot car",
  "slotcars",
  "slot cars",
  "carrera explorer cup",
  "carrea explorer cup",
  "ssm-deutschland.de"
];

const ignoredUnmatchedHostTerms = [
  "ets",
  "euro touring series",
  "fs-timing",
  "md-timing",
  "ub.timing",
  "ub timing",
  "kloft-timing",
  "kloft timing",
  "schneider-timing",
  "schneider timing",
  "time4fun",
  "trackside",
  "tonisport",
  "toni sport",
  "sator events",
  "süddeutschland-cup",
  "suddeutschland-cup",
  "nitro süd",
  "nitro sud",
  "conrad electronic",
  "lrp electronic",
  "dershoemaker",
  "der shoemaker",
  "catz-sports",
  "catz sports",
  "team dabo",
  "rc racers + toys shop",
  "rc racers toys shop",
  "rc-car shop racecrew",
  "rc car shop racecrew",
  "heiner martin"
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

function textIncludesAnyTerm(text = "", terms = []) {
  const lower = String(text ?? "").toLowerCase();
  return terms.some(term => lower.includes(term));
}

function raceTextForSlotcarDetection(race = {}) {
  const classesText = Array.isArray(race.classes)
    ? race.classes.map(item => typeof item === "string" ? item : [item?.name, item?.entries].filter(Boolean).join(" ")).join(" ")
    : "";

  const documentsText = Array.isArray(race.documents)
    ? race.documents.map(document => [
        document?.type,
        document?.label,
        document?.sourceLabel,
        document?.fileName,
        document?.url
      ].filter(Boolean).join(" ")).join(" ")
    : "";

  return [
    race.name,
    race.series,
    classesText,
    documentsText,
    race.url,
    race.detailUrl,
    race.registrationListUrl
  ].filter(Boolean).join(" ");
}

function hasSlotcarSignal(race = {}) {
  return textIncludesAnyTerm(raceTextForSlotcarDetection(race), slotcarSignalTerms);
}

function normalizedIgnoredHostText(value = "") {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9+.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isIgnoredUnmatchedHost(hostOrRecord = {}) {
  const text = normalizedIgnoredHostText([
    hostOrRecord.hostName,
    hostOrRecord.name,
    hostOrRecord.hostId,
    hostOrRecord.id,
    hostOrRecord.possibleVenue
  ].filter(Boolean).join(" "));

  return ignoredUnmatchedHostTerms.some(term => {
    const normalizedTerm = normalizedIgnoredHostText(term);
    return normalizedTerm && text.includes(normalizedTerm);
  });
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

  if (/^test\s/i.test(name) || lower.includes("test event")) return true;

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

async function isMyrcmReachable() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch("https://www.myrcm.ch/", {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 myrcm-rc-map importer" }
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function fetchText(url, attempt = 0) {
  const controller = new AbortController();
  const timeoutPromise = new Promise((_, reject) => {
    const t = setTimeout(() => {
      controller.abort();
      reject(new Error(`Timeout after ${requestTimeoutMs}ms: ${url}`));
    }, requestTimeoutMs);
    // Allow Node to exit even if this timer is still pending
    t.unref?.();
  });

  try {
    const response = await Promise.race([
      fetch(url, {
        signal: controller.signal,
        headers: { "user-agent": "Mozilla/5.0 myrcm-rc-map importer" }
      }),
      timeoutPromise
    ]);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const textPromise = response.text();
    return await Promise.race([textPromise, new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Body read timeout: ${url}`)), requestTimeoutMs).unref?.()
    )]);
  } catch (error) {
    controller.abort();
    if (attempt < retryCount) {
      return fetchText(url, attempt + 1);
    }

    throw markRetryable(error, url);
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

function normalizedSeriesMatchText(value = "") {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function seriesLabel(seriesDefinition = {}) {
  return (
    seriesDefinition.displayName ||
    (seriesDefinition.shortName
      ? `${seriesDefinition.name} (${seriesDefinition.shortName})`
      : seriesDefinition.name) ||
    seriesDefinition.id
  );
}

function seriesAliases(seriesDefinition = {}) {
  return Array.from(new Set([
    seriesDefinition.name,
    seriesDefinition.shortName,
    seriesDefinition.displayName,
    ...(Array.isArray(seriesDefinition.aliases) ? seriesDefinition.aliases : [])
  ].filter(Boolean)));
}

function regexEscape(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasSeriesAliasMatch(text, alias) {
  const normalizedText = normalizedSeriesMatchText(text);
  const normalizedAlias = normalizedSeriesMatchText(alias);

  if (!normalizedText || !normalizedAlias) return false;

  const pattern = new RegExp(`(^|\\s)${regexEscape(normalizedAlias)}(\\s|$)`, "i");
  return pattern.test(normalizedText);
}

function detectSeries(name, classes = [], seriesCatalog = []) {
  const textParts = [
    name,
    ...(Array.isArray(classes)
      ? classes.map(item => typeof item === "string" ? item : item?.name)
      : [])
  ].filter(Boolean);

  const combinedText = textParts.join(" | ");

  if (Array.isArray(seriesCatalog) && seriesCatalog.length) {
    const detected = [];

    for (const seriesDefinition of seriesCatalog) {
      if (!seriesDefinition?.id && !seriesDefinition?.name) continue;

      const matched = seriesAliases(seriesDefinition).some(alias => hasSeriesAliasMatch(combinedText, alias));
      if (!matched) continue;

      detected.push(seriesLabel(seriesDefinition));
    }

    return Array.from(new Set(detected));
  }

  // Fallback for old repositories without series.json.
  const lower = String(name || "").toLowerCase();
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

  if (lower.includes("rck challenge") || lower.includes("rck-challenge")) {
    series.push("RCK Challenge");
  }

  if (lower.includes("sk-lauf") || lower.includes("sk lauf") || lower.includes("sportkreis")) {
    series.push("SK");
  }

  if (lower.includes("tamico offroad cup") || lower.includes("tamico-offroad-cup")) {
    series.push("Tamico Offroad Cup");
  }

  if (lower.includes("tamiya euro cup") || lower.includes("tamiya euro-cup") || /\btec\b/i.test(name)) {
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

  const eventLabel = labels["event"] && labels["event"] !== "?" ? labels["event"] : null;
  const name =
    eventLabel ||
    listFallback.name ||
    heading ||
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
  const linkLabel = (labels["link"] || "").trim();
  const venueWebsite = /^https?:\/\//i.test(linkLabel) ? linkLabel : null;
  // "host" label on MyRCM event pages may show the hosting club (e.g. "Racing Center Parndorf")
  // for travelling series where the organizer differs from the physical venue host.
  const hostLabel = (labels["host"] || "").trim() || null;

  return {
    name,
    from,
    to,
    classes,
    registrationRequiresLogin,
    venueWebsite,
    hostLabel
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
    if (!seed) continue;

    // Seeds created via admin-commit may lack an id — still index by myrcmOrgId
    if (seed.id) {
      lookup.set(String(seed.id), seed);
    }

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

// Match a MyRCM host to a default venue seed only when the seed explicitly references the host.
// This uses myrcmOrgId, hostIds and direct venue ids. Race-name based venue detection still has priority per race.
function venueSeedForMyRcmHost(venueSeedLookup, host, hostRecord = null) {
  if (!host) return null;

  const myRcmKey = host.orgId ? `myrcm-${host.orgId}` : null;
  const hostRecordKey = hostRecord?.id ? `host:${hostRecord.id}` : null;
  const directVenueId = host.venueId ? String(host.venueId) : null;
  const directVenueKey = directVenueId ? `host:${directVenueId}` : null;

  return (
    (myRcmKey && venueSeedLookup.get(myRcmKey)) ||
    (hostRecordKey && venueSeedLookup.get(hostRecordKey)) ||
    (directVenueId && venueSeedLookup.get(directVenueId)) ||
    (directVenueKey && venueSeedLookup.get(directVenueKey)) ||
    null
  );
}

function seedId(seed) {
  // admin-commit entries may lack an id — derive one from myrcmOrgId as fallback
  return seed?.id || (seed?.myrcmOrgId ? `myrcm-${seed.myrcmOrgId}` : null);
}

function venueFromSeed(seed) {
  const id = seedId(seed);
  if (!id) return null;

  return {
    id,
    name: seed.name || seed.hostName || id,
    city: seed.city || "",
    lat: seed.lat ?? null,
    lng: seed.lng ?? null,
    aliases: Array.isArray(seed.aliases) ? seed.aliases : [],
    hostIds: Array.isArray(seed.hostIds) ? seed.hostIds : [],
    source: seed.source || "venue-seeds"
  };
}

function venueRecordFromSeed(seed) {
  const id = seedId(seed);
  if (!id) return null;

  return {
    id,
    name: seed.name || seed.hostName || id,
    city: seed.city || "",
    lat: seed.lat ?? null,
    lng: seed.lng ?? null,
    address: seed.address || "",
    postalCode: seed.postalCode || "",
    website: seed.website || "",
    aliases: Array.isArray(seed.aliases) ? seed.aliases : [],
    hostIds: Array.isArray(seed.hostIds) ? seed.hostIds : [],
    myrcmOrgId: seed.myrcmOrgId || "",
    source: seed.source || "venue-seeds",
    verified: seed.verified !== false,
    ...(seed.country ? { country: seed.country } : {}),
    ...(seed.locationUnknown ? { locationUnknown: true } : {})
  };
}

function hasValidCoordinates(venue) {
  if (!venue) return false;

  const lat = Number(venue.lat);
  const lng = Number(venue.lng);

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= 44 &&
    lat <= 59 &&
    lng >= -5 &&
    lng <= 25
  );
}

function mergeVenueRecords(previous = {}, next = {}) {
  return {
    ...previous,
    ...next,
    id: previous.id || next.id,
    name: next.name || previous.name || next.id || previous.id,
    city: next.city || previous.city || "",
    lat: next.lat ?? previous.lat ?? null,
    lng: next.lng ?? previous.lng ?? null,
    address: next.address || previous.address || "",
    postalCode: next.postalCode || previous.postalCode || "",
    website: next.website || previous.website || "",
    aliases: Array.from(new Set([
      ...(Array.isArray(previous.aliases) ? previous.aliases : []),
      ...(Array.isArray(next.aliases) ? next.aliases : [])
    ].filter(Boolean))),
    hostIds: Array.from(new Set([
      ...(Array.isArray(previous.hostIds) ? previous.hostIds : []),
      ...(Array.isArray(next.hostIds) ? next.hostIds : [])
    ].filter(Boolean))),
    myrcmOrgId: next.myrcmOrgId || previous.myrcmOrgId || "",
    source: next.source || previous.source || "venues",
    verified: next.verified !== false && previous.verified !== false
  };
}

function mergeVenueSeedsIntoVenues(existingVenues = [], venueSeeds = []) {
  const byId = new Map();

  for (const venue of existingVenues || []) {
    if (!venue?.id) continue;
    byId.set(String(venue.id), venue);
  }

  for (const seed of venueSeeds || []) {
    const venue = venueRecordFromSeed(seed);
    if (!venue?.id || (!hasValidCoordinates(venue) && !seed.locationUnknown)) continue;

    const id = String(venue.id);
    byId.set(id, mergeVenueRecords(byId.get(id) || {}, venue));
  }

  return Array.from(byId.values()).sort((a, b) => {
    return String(a.name || a.id).localeCompare(String(b.name || b.id));
  });
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
    seed.address,
    ...(Array.isArray(seed.aliases)
      ? seed.aliases.filter(alias => {
          const value = normalizedVenueMatchText(alias);
          return value.length >= 4 && value !== normalizedVenueMatchText(seed.city || "");
        })
      : [])
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
    if (!seed?.id && !seed?.hostId) continue;
    if (seed.skipTextMatch) continue;

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

// Country codes (ISO 3166-1 alpha-2) that are outside DACH.
// Used to detect travelling-series races held abroad (e.g. ETS ROUND 2 TRENCIN SK).
const nonDachCountryCodes = /(?:^|[\s/,])(SK|CZ|PL|HU|FR|NL|BE|IT|SI|HR|RS|GB|UK|ES|PT|SE|NO|DK|FI|RO|BG|LU|LT|LV|EE|GR|TR|UA|RU)\s*$/i;

function raceNameIndicatesNonDach(name) {
  return nonDachCountryCodes.test(name || "");
}

// Travelling-series organizers whose home venue must NEVER be auto-assigned.
// These hosts organize races at many different venues across Europe.
// Only races whose name explicitly matches a known venue seed get a venueId.
// Also: detail.hostLabel for these hosts always returns the organizer's own name
// (not the physical venue), so it is excluded from venue-matching text.
const travellingSeriesOrgIds = new Set([
  "24531", // ToniSport GmbH — ENS, ETS, TOS (Arena33/Andernach)
  "2047",  // ETS (Euro RC Series) — ENS, ETS, TOS, Euro Offroad Series
]);

function detectVenueSeedForRace(venueSeeds = [], detail = {}, eventLink = {}, hostRecord = {}, host = {}, defaultVenueSeed = null) {
  const isTravellingSeries = travellingSeriesOrgIds.has(String(host.orgId || ""));

  const raceText = [
    detail.name,
    eventLink.fallbackName,
    // hostLabel shows the physical hosting club — but for travelling series it always
    // returns the organizer's own name (e.g. "Arena33"), so exclude it there.
    isTravellingSeries ? null : detail.hostLabel,
  ]
    .filter(Boolean)
    .join(" ");

  const explicitVenueSeed = detectVenueSeedFromRaceText(venueSeeds, raceText, hostRecord, host);

  if (explicitVenueSeed) return { seed: explicitVenueSeed, wasExplicit: true, isTravellingSeries };

  // Travelling series: never fall back to the organizer's home venue.
  // Use ets-international as catch-all for rounds with no matched venue.
  if (isTravellingSeries) {
    const fallback = venueSeeds.find(s => (s.id || s.hostId) === "ets-international") || null;
    return { seed: fallback, wasExplicit: false, isTravellingSeries };
  }

  // Non-DACH country fallback: if no venue seed found, use a country-level placeholder.
  const countryFallbackVenueId = { "Czech Republic": "cz-general", "Czechia": "cz-general" }[host.country || ""];
  if (countryFallbackVenueId && !defaultVenueSeed) {
    const fallback = venueSeeds.find(s => (s.id || s.hostId) === countryFallbackVenueId) || null;
    return { seed: fallback, wasExplicit: false, isTravellingSeries: false };
  }

  return { seed: defaultVenueSeed || null, wasExplicit: false, isTravellingSeries: false };
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

  // MyRCM unmatched entries are rebuilt from the current import on every run.
  // This prevents stale venue-unmatched records from surviving after a host/venue match was fixed.
  for (const item of existing || []) {
    if (item?.source === "myrcm") continue;

    const key = `${item.source || ""}|${item.hostId || ""}|${item.myrcmOrgId || ""}|${item.possibleVenue || ""}`;
    byKey.set(key, item);
  }

  for (const item of imported || []) {
    if (item?.source === "myrcm" && isIgnoredUnmatchedHost(item)) continue;

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
  const countryMap = { "Austria": "AT", "Switzerland": "CH", "Germany": "DE", "Netherlands": "NL", "Belgium": "BE", "Luxembourg": "LU", "Czech Republic": "CZ", "Czechia": "CZ" };
  const importedHost = {
    id: hostIdFromMyRcmHost(host, venueSeed),
    name: hostNameFromMyRcmHost(host),
    website: host.website || host.web || "",
    myrcmOrgId: myRcmOrgIdFromHost(host),
    ...(host.country && countryMap[host.country] ? { country: countryMap[host.country] } : {})
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

    if (fallbackTo && fallbackTo < twoYearsAgoString()) {
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

  if (race.to < twoYearsAgoString()) return true;

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

async function parseSingleEvent(eventLink, host, hostRecord, venueSeed, venueSeeds, seriesCatalog, total, index) {
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

    const { seed: detectedVenueSeed, wasExplicit, isTravellingSeries } = detectVenueSeedForRace(
      venueSeeds,
      detail,
      eventLink,
      hostRecord,
      host,
      venueSeed
    );
    // For races clearly held outside DACH (name ends with a non-DACH country code like
    // "RUCPHEN / NL", "TRENCIN SK"), use null — unless it's a travelling series race
    // (ETS/ENS/TOS) or we have an explicit venue seed for this host.
    // If detectedVenueSeed is set, the host is known (local club or text-matched venue)
    // and the seed is the ground truth — don't null it out based on the race name.
    const isNonDach = !isTravellingSeries && !detectedVenueSeed && raceNameIndicatesNonDach(detail.name || eventLink.fallbackName);
    const venue = isNonDach ? null : venueFromSeed(detectedVenueSeed);
    const venueId = venue?.id || null;

    const detailDocuments = extractDocumentsFromHtml(detailHtml, detailUrl);
    let registrationDocuments = [];
    let bookingPageClosed = false;

    if (regUrl) {
      try {
        const registrationHtml = await fetchText(regUrl);
        registrationDocuments = extractDocumentsFromHtml(registrationHtml, regUrl);
        const regLower = registrationHtml.toLowerCase();
        if (
          regLower.includes("booking not possible") ||
          regLower.includes("registration closed") ||
          regLower.includes("booking closed")
        ) {
          bookingPageClosed = true;
        }
      } catch (error) {
        console.warn(`  Nennseite konnte nicht nach PDFs geprüft werden: ${regUrl}`);
        console.warn(`    ${error.message}`);
      }
    }

    const documents = mergeDocuments(detailDocuments, registrationDocuments);

    const registrationInfo = registrationInfoFromText(eventLink.registrationText);
    // "sign up to this event" in the list means login-required, not truly open.
    // Don't let the booking page (which says "booking not possible" for non-logged-in users)
    // override this to "closed".
    const isSignupRequired = /sign up to this event/i.test(eventLink.registrationText || "") || detail.registrationRequiresLogin;
    // Don't override "upcoming" with "closed": booking page shows "Booking not possible"
    // for races whose registration hasn't opened yet — that's not the same as closed.
    const registrationStatus = isSignupRequired
      ? "login_required"
      : (bookingPageClosed && registrationInfo.registrationStatus !== "upcoming")
        ? "closed"
        : registrationInfo.registrationStatus;

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
      venueWebsite: detail.venueWebsite || null,
      hostId: hostFields.hostId,
      hostName: hostFields.hostName,
      name: detail.name,
      from: detail.from,
      to: detail.to,
      series: detectSeries(detail.name, registrationListInfo.classes, seriesCatalog),
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
    if (await isMyrcmReachable()) {
      console.warn("  MyRCM noch erreichbar — Event wird übersprungen.");
      return null;
    }
    console.warn("  MyRCM nicht erreichbar — Import wird abgebrochen.");
    throw error;
  }
}

async function parseEvents(html, host, hostRecord, venueSeed, venueSeeds, seriesCatalog = []) {
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
    (eventLink, index) => parseSingleEvent(eventLink, host, hostRecord, venueSeed, venueSeeds, seriesCatalog, eventLinks.length, index)
  );

  return races.filter(r => r && !/^test\b/i.test(r.name || ""));
}

async function loadHosts() {
  const raw = await readFile(hostListFile, "utf8");
  let hosts = JSON.parse(raw);

  try {
    const beneluxRaw = await readFile(beneluxHostListFile, "utf8");
    const beneluxHosts = JSON.parse(beneluxRaw);
    const existingOrgIds = new Set(hosts.map(h => String(h.orgId)));
    hosts = [...hosts, ...beneluxHosts.filter(h => !existingOrgIds.has(String(h.orgId)))];
  } catch {
    // benelux file optional
  }

  try {
    const czRaw = await readFile(czHostListFile, "utf8");
    const czHosts = JSON.parse(czRaw);
    const existingOrgIds = new Set(hosts.map(h => String(h.orgId)));
    hosts = [...hosts, ...czHosts.filter(h => !existingOrgIds.has(String(h.orgId)))];
  } catch {
    // cz file optional
  }

  const filteredHosts = hosts
    .filter(host => host.orgId && host.name)
    .filter(host => Number(host.eventCount || 0) > 0)
    .filter(host => !excludedMyrcmOrgIds.has(String(host.orgId)))
    .filter(host => !isExcludedHost(host))
    .map(host => ({
      ...host,
      url:
        host.url ||
        `https://www.myrcm.ch/myrcm/main?hId[1]=org&dId[O]=${host.orgId}&pLa=en`
    }));

  if (countryOnly) {
    const _countryMap = { "Austria": "AT", "Switzerland": "CH", "Germany": "DE", "Netherlands": "NL", "Belgium": "BE", "Luxembourg": "LU", "Czech Republic": "CZ", "Czechia": "CZ" };
    const byCountry = filteredHosts.filter(h => _countryMap[h.country] === countryOnly);
    console.log(`Country-Filter (${countryOnly}): ${byCountry.length} von ${filteredHosts.length} Hosts`);
    return byCountry;
  }

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
  const existingVenues = await readJsonIfExists(venuesFile, []);
  const venueSeeds = await readJsonIfExists(venueSeedsFile, []);
  const seriesCatalog = await readJsonIfExists(seriesFile, []);
  const existingUnmatched = await readJsonIfExists(venueUnmatchedFile, []);
  const venueSeedLookup = buildVenueSeedLookup(venueSeeds);
  const previousRaces = await loadPreviousRaces();
  const allRaces = [];
  const importedHosts = [];
  const importedUnmatched = [];

  console.log(`${hosts.length} Hosts mit Events geladen`);
  console.log(`${Array.isArray(seriesCatalog) ? seriesCatalog.length : 0} kuratierte Serien geladen`);

  for (const host of hosts) {
    const existingHost = existingHostForMyRcmHost(existingHosts, host);
    const preliminaryHostRecord = hostRecordFromMyRcmHost(host, null, existingHost);
    const venueSeed = venueSeedForMyRcmHost(venueSeedLookup, host, preliminaryHostRecord);
    const hostRecord = hostRecordFromMyRcmHost(host, venueSeed, existingHost);

    console.log(`Lade MyRCM: ${host.name} (${host.orgId})`);

    let html;

    try {
      html = await fetchText(host.url);
    } catch (error) {
      console.warn(`  Netzwerkfehler bei Host: ${host.name}`);
      console.warn(`    ${error.message}`);
      if (await isMyrcmReachable()) {
        console.warn("  MyRCM noch erreichbar — Host wird übersprungen.");
        continue;
      }
      console.warn("  MyRCM nicht erreichbar — Import wird abgebrochen.");
      throw error;
    }

    const races = await parseEvents(html, host, hostRecord, venueSeed, venueSeeds, seriesCatalog);

    if (!races.length) {
      console.log("  Host wird uebersprungen, weil kein Rennen im aktuellen Importzeitraum gefunden wurde");
      continue;
    }

    const slotcarSignalRace = races.find(hasSlotcarSignal);

    if (slotcarSignalRace) {
      console.log(`  Host wird fuer diesen Importlauf uebersprungen, weil Slotcar-Signal gefunden wurde: ${slotcarSignalRace.name}`);
      continue;
    }

    importedHosts.push(hostRecord);

    const lacksRealVenue = races.some(race => !race.venueId) || !!venueSeed?.locationUnknown;
    if (lacksRealVenue && !isIgnoredUnmatchedHost(hostRecord)) {
      const record = unmatchedRecordForMyRcmHost(
          host,
          hostRecord,
          venueSeed?.locationUnknown ? "locationUnknown venue — no coordinates" : "no confirmed venue for at least one current MyRCM race"
        );
      if (venueSeed?.locationUnknown) record.locationUnknown = true;
      importedUnmatched.push(record);
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

  if (countryOnly) {
    // Keep all previous races from non-imported hosts (e.g. DACH/Benelux when running CZ-only)
    const importedHostIdSet = new Set(importedHosts.map(h => h.id));
    const previousFromOthers = previousRaces.filter(r => !importedHostIdSet.has(r.hostId));
    unique = [...unique, ...previousFromOthers]
      .sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
    console.log(`Country-only merge: ${importedHosts.length} importierte Hosts, ${previousFromOthers.length} Races aus anderen Ländern beibehalten, ${unique.length} total`);
  }

  const mergedHosts = mergeHosts(existingHosts, importedHosts);

  // Backfill country for hosts that exist in the host list but had no races this run
  const countryMap = { "Austria": "AT", "Switzerland": "CH", "Germany": "DE", "Netherlands": "NL", "Belgium": "BE", "Luxembourg": "LU", "Czech Republic": "CZ", "Czechia": "CZ" };
  const orgIdToCountry = new Map(
    hosts
      .filter(h => h.orgId && h.country && countryMap[h.country])
      .map(h => [String(h.orgId), countryMap[h.country]])
  );
  const hostsWithCountry = mergedHosts.map(h => {
    if (!h.country && h.myrcmOrgId) {
      const country = orgIdToCountry.get(String(h.myrcmOrgId));
      if (country) return { ...h, country };
    }
    return h;
  });

  const mergedVenues = mergeVenueSeedsIntoVenues(existingVenues, venueSeeds);
  const mergedUnmatched = mergeUnmatched(existingUnmatched, importedUnmatched);

  // Remove geocoded AT/CH seeds for clubs that have no races in the import window.
  // Skip when running country-only (activeOrgIds would be incomplete and remove valid seeds).
  if (!countryOnly) {
    const activeOrgIds = new Set(importedHosts.map(h => h.myrcmOrgId).filter(Boolean));
    const cleanedVenueSeeds = venueSeeds.filter(s =>
      s.source !== "geocoded-nominatim-dach" || activeOrgIds.has(s.myrcmOrgId)
    );
    const removedSeedCount = venueSeeds.length - cleanedVenueSeeds.length;
    if (removedSeedCount > 0) {
      await writeFile(
        venueSeedsFile,
        JSON.stringify(cleanedVenueSeeds, null, 2) + "\n",
        "utf8"
      );
      console.log(`venue-seeds.json bereinigt: ${removedSeedCount} inaktive Geocoded-Seeds entfernt`);
    }
  }

  await writeFile(
    hostsFile,
    JSON.stringify(hostsWithCountry, null, 2) + "\n",
    "utf8"
  );

  await writeFile(
    venuesFile,
    JSON.stringify(mergedVenues, null, 2) + "\n",
    "utf8"
  );

  await writeFile(
    venueUnmatchedFile,
    JSON.stringify(mergedUnmatched, null, 2) + "\n",
    "utf8"
  );

  warnIfSparse(unique, ["from", "venueId"], { label: "races.json" });
  await safeWriteJson(unique, "races.json", { minCount: 500, minFraction: 0.8, label: "races.json" });

  const racesWithDocuments = unique.filter(race => race.documents?.length);
  const venuesWithDocuments = new Set(racesWithDocuments.map(race => race.venueId));
  const documentTypeCounts = unique.reduce((counts, race) => {
    for (const document of race.documents || []) {
      counts[document.type] = (counts[document.type] || 0) + 1;
    }

    return counts;
  }, {});
  const totalDocuments = Object.values(documentTypeCounts).reduce((sum, count) => sum + count, 0);

  console.log(`hosts.json geschrieben: ${hostsWithCountry.length} Hosts`);
  console.log(`venues.json geschrieben: ${mergedVenues.length} Strecken`);
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
