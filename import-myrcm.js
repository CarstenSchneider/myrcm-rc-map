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

function normalizeText(text = "") {
  return text.replace(/\s+/g, " ").trim();
}

function isExcludedHost(host) {
  const text = `${host.name} ${host.location}`.toLowerCase();
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

function orgIdFromUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url, "https://www.myrcm.ch");
    return parsed.searchParams.get("dId[O]");
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
  const orgId = host.orgId;

  if (!eventId || !orgId) return null;

  const target = new URL("https://www.myrcm.ch/myrcm/main");
  target.searchParams.set("dId[O]", orgId);
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

function eventId(venueId, from, myrcmEventId, name) {
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

    if (!labelText.startsWith("sections")) {
      return;
    }

    $(paragraph)
      .find("a")
      .each((_, link) => {
        const label = normalizeText($(link).text());

        if (!label) return;
        if (label === "?") return;

        classes.push(label.replace(/^→\s*/, ""));
      });
  });

  if (!classes.length) {
    $("a").each((_, link) => {
      const href = $(link).attr("href") || "";
      const label = normalizeText($(link).text());

      if (!label) return;
      if (!/dId\[S\]|dId%5BS%5D|section|Section/i.test(href)) return;

      classes.push(label.replace(/^→\s*/, ""));
    });
  }

  return Array.from(new Set(classes));
}

function parseDateRangeFromLabels(labels) {
  const data = labels.data || labels.date || "";
  const dates = [...data.matchAll(/(\d{2})\.(\d{2})\.(\d{4})/g)].map(match => {
    return `${match[3]}-${match[2]}-${match[1]}`;
  });

  if (!dates.length) {
    return {
      from: null,
      to: null
    };
  }

  return {
    from: dates[0],
    to: dates[1] || dates[0]
  };
}

function extractEventDetail(html, host, eventId, listFallback = {}) {
  const $ = cheerio.load(html);
  const labels = labelValueMap($);
  const dateRange = parseDateRangeFromLabels(labels);
  const heading = firstUsefulHeading($, host);
  const classes = extractClassesFromDetailPage($);

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

  const hostName =
    labels.host ||
    host.name ||
    listFallback.venueName ||
    "";

  const country =
    labels.country ||
    host.country ||
    "";

  return {
    name,
    from,
    to,
    hostName,
    country,
    classes
  };
}

function extractEventLinksFromHostPage(html, host) {
  const $ = cheerio.load(html);
  const events = new Map();

  $("a").each((_, link) => {
    const href = $(link).attr("href") || "";
    const url = absoluteUrl(href);
    const eventId = eventIdFromUrl(url);

    if (!eventId) return;

    const row = $(link).closest("tr");
    const rowText = normalizeText(row.text());
    const linkText = normalizeText($(link).text());

    const dates = [...rowText.matchAll(/(\d{2})\.(\d{2})\.(\d{4})/g)].map(match => {
      return `${match[3]}-${match[2]}-${match[1]}`;
    });

    const fallbackName =
      !isInvalidEventName(linkText) && !parseDate(linkText)
        ? linkText
        : "";

    if (!events.has(eventId)) {
      events.set(eventId, {
        eventId,
        url,
        fallbackName,
        fallbackFrom: dates[0] || null,
        fallbackTo: dates[1] || dates[0] || null,
        rowText
      });
    } else {
      const existing = events.get(eventId);

      if (!existing.fallbackName && fallbackName) {
        existing.fallbackName = fallbackName;
      }

      if (!existing.fallbackFrom && dates[0]) {
        existing.fallbackFrom = dates[0];
        existing.fallbackTo = dates[1] || dates[0];
      }

      if (/hId%5B1%5D=org|hId\[1\]=org|tId=E/i.test(url)) {
        existing.url = url;
      }
    }
  });

  return [...events.values()];
}

async function registrationRequiresLogin(regUrl) {
  if (!regUrl) return false;

  try {
    const html = await fetchText(regUrl);
    return /sign up to this event/i.test(html);
  } catch {
    return false;
  }
}

function shouldSkipRace(race) {
  if (!race.name) return true;
  if (isInvalidEventName(race.name)) return true;
  if (isExcludedEvent(race.name)) return true;
  if (hasTrainingName(race.name)) return true;

  if (!race.from || !race.to) return true;

  if (race.to < race.from) {
    return true;
  }

  const today = new Date().toISOString().slice(0, 10);
  if (race.to < today) return true;

  const raceYear = Number(race.from.slice(0, 4));
  if (!allowedYears.includes(raceYear)) return true;

  return false;
}

async function parseEvents(html, host) {
  const races = [];
  const venueId = host.venueId || hostToVenueId(host);
  const eventLinks = extractEventLinksFromHostPage(html, host);

  for (const eventLink of eventLinks) {
    const detailUrl = orgEventDetailUrl(host, eventLink.eventId);

    if (!detailUrl) continue;

    let detail;

    try {
      const detailHtml = await fetchText(detailUrl);
      detail = extractEventDetail(detailHtml, host, eventLink.eventId, {
        name: eventLink.fallbackName,
        from: eventLink.fallbackFrom,
        to: eventLink.fallbackTo,
        venueName: host.name
      });
    } catch (error) {
      console.warn(`  Event-Detail konnte nicht geladen werden: ${detailUrl}`);
      detail = {
        name: eventLink.fallbackName || `MyRCM Event ${eventLink.eventId}`,
        from: eventLink.fallbackFrom,
        to: eventLink.fallbackTo || eventLink.fallbackFrom,
        hostName: host.name,
        country: host.country,
        classes: []
      };
    }

    const regUrl = registrationUrl(eventLink.eventId);
    const needsLogin = await registrationRequiresLogin(regUrl);

    const race = {
      id: eventId(venueId, detail.from, eventLink.eventId, detail.name),
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
      registrationRequiresLogin: needsLogin,
      note: needsLogin
        ? "Anmeldung bei MyRCM nur nach Login sichtbar."
        : null,
      classes: detail.classes
    };

    if (shouldSkipRace(race)) {
      if (race.to && race.from && race.to < race.from) {
        console.warn(`WARN: Enddatum liegt vor Startdatum (${host.name})`);
        console.warn(`      Event: ${race.name}`);
        console.warn(`      from=${race.from}, to=${race.to}`);
      }

      continue;
    }

    races.push(race);
  }

  return races;
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

    console.log(`  ${races.length} Rennen gefunden`);

    allRaces.push(...races);
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
