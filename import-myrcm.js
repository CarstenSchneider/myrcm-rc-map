import * as cheerio from "cheerio";
import { readFile, writeFile } from "node:fs/promises";

const hostListFile = "myrcm-hosts-germany.json";
const currentYear = new Date().getFullYear();
const allowedYears = [currentYear, currentYear + 1];

const trainingTerms = [
  "training",
  "trainings",
  "gastfahrertag",
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

function isExcludedHost(host) {
  const text = `${host.name} ${host.location}`.toLowerCase();
  return excludedHostTerms.some(term => text.includes(term));
}

function isExcludedEvent(name) {
  const lower = name.toLowerCase();
  return excludedEventTerms.some(term => lower.includes(term));
}

function normalizeText(text) {
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
  return trainingTerms.some(term => lower.includes(term));
}

function absoluteUrl(href) {
  if (!href) return "";
  return new URL(href, "https://www.myrcm.ch").toString();
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

function eventId(venueId, name, from) {
  return `${venueId}-${from}-${slugify(name)}`;
}

function hostToVenueId(host) {
  return `myrcm-${host.orgId}-${slugify(host.name)}`;
}

function parseEvents(html, host) {
  const $ = cheerio.load(html);
  const races = [];
  const venueId = host.venueId || hostToVenueId(host);

  $("tr").each((_, row) => {
    const cells = $(row)
      .find("td")
      .toArray()
      .map(cell => normalizeText($(cell).text()));

    if (cells.length < 4) return;

    const links = $(row).find("a").toArray();
    const href = links.length ? $(links[links.length - 1]).attr("href") : "";

    const dateCells = cells.map(parseDate);

    const validDateIndexes = dateCells
      .map((date, index) => (date ? index : -1))
      .filter(index => index >= 0);

    if (!validDateIndexes.length) return;

    const from = dateCells[validDateIndexes[0]];
    const to = dateCells[validDateIndexes[1]] || from;

    const raceYear = Number(from.slice(0, 4));
    if (!allowedYears.includes(raceYear)) return;

    let name = "";

    for (const text of cells) {
      if (!text) continue;
      if (parseDate(text)) continue;
      if (/^(deu|ger|germany|deutschland)$/i.test(text)) continue;
      if (/^\d+$/.test(text)) continue;
      if (text.toLowerCase().includes("registration")) continue;
      if (text === host.name) continue;
      if (text === host.location) continue;
      if (text === host.country) continue;

      name = text;
      break;
    }

    if (!name) return;
    if (hasTrainingName(name)) return;

    races.push({
      id: eventId(venueId, name, from),
      venueId,
      venueName: host.name,
      venueLocation: host.location,
      name,
      from,
      to,
      series: detectSeries(name),
      source: "myrcm",
      url: absoluteUrl(href) || host.url
    });
  });

  return races;
}

async function loadHosts() {
  const raw = await readFile(hostListFile, "utf8");
  const hosts = JSON.parse(raw);

  return hosts
    .filter(host => host.orgId && host.name)
    .filter(host => Number(host.eventCount || 0) > 0)
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

    const response = await fetch(host.url, {
      headers: {
        "user-agent": "Mozilla/5.0 myrcm-rc-map importer"
      }
    });

    if (!response.ok) {
      console.warn(`  Fehler bei ${host.name}: ${response.status}`);
      continue;
    }

    const html = await response.text();
    const races = parseEvents(html, host);

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
