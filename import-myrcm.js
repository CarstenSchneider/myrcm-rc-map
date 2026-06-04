import * as cheerio from "cheerio";
import { access, readFile, writeFile } from "node:fs/promises";

const hostListFile = "myrcm-hosts-germany.json";
const currentYear = new Date().getFullYear();
const allowedYears = [currentYear, currentYear + 1];

const requestTimeoutMs = 8000;
const retryCount = 1;
const detailConcurrency = 5;

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
  return text.replace(/\s+/g, " ").trim();
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

    throw error;
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

    if (fallbackTo && fallbackTo < today) {
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

  const today = new Date().toISOString().slice(0, 10);
  if (race.to < today) return true;

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

async function parseSingleEvent(eventLink, host, venueId, total, index) {
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

    const detailDocuments = extractDocumentsFromHtml(detailHtml, detailUrl);
    let registrationDocuments = [];

    if (regUrl) {
      try {
        const registrationHtml = await fetchText(regUrl);
        registrationDocuments = extractDocumentsFromHtml(registrationHtml, regUrl);
      } catch (error) {
        console.warn(`  Nennseite konnte nicht nach PDFs geprüft werden: ${regUrl}`);
        console.warn(`    ${error.message}`);
      }
    }

    const documents = mergeDocuments(detailDocuments, registrationDocuments);

    const registrationInfo = registrationInfoFromText(eventLink.registrationText);
    const registrationStatus = registrationInfo.registrationStatus;

    const finalRegistrationInfo = {
      registrationStatus,
      registrationOpens: registrationInfo.registrationOpens
    };

    const race = {
      id: raceId(venueId, detail.from, eventLink.eventId, detail.name),
      venueId,
      venueName: host.name,
      venueLocation: host.location,
      name: detail.name,
      from: detail.from,
      to: detail.to,
      series: detectSeries(detail.name),
      source: "myrcm",
      url: regUrl || detailUrl,
      detailUrl,
      registrationStatus,
      registrationOpens: registrationInfo.registrationOpens,
      registrationRequiresLogin: registrationStatus === "login_required",
      registrationCount: eventLink.registrationCount,
      registrationDisplay: eventLink.registrationDisplay,
      note: registrationNote(finalRegistrationInfo),
      classes: detail.classes,
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
    return null;
  }
}

async function parseEvents(html, host) {
  const venueId = host.venueId || hostToVenueId(host);
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
    (eventLink, index) => parseSingleEvent(eventLink, host, venueId, eventLinks.length, index)
  );

  return races.filter(Boolean);
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
  const previousRaces = await loadPreviousRaces();
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

    console.log(`  ${races.length} Rennen gefunden`);

    allRaces.push(...races);
  }

  let unique = Array.from(
    new Map(allRaces.map(race => [race.id, race])).values()
  ).sort((a, b) => {
    return a.from.localeCompare(b.from) || a.name.localeCompare(b.name);
  });

  unique = applyFirstSeen(unique, previousRaces);

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

main().catch(error => {
  console.error(error);
  process.exit(1);
});
