import * as cheerio from "cheerio";
import { writeFile } from "node:fs/promises";

const hosts = [
  {
    orgId: "18244",
    venueId: "tsv-mariendorf",
    url: "https://www.myrcm.ch/myrcm/main?hId[1]=org&dId[O]=18244&pLa=en"
  },
  {
    orgId: "45925",
    venueId: "bernau",
    url: "https://www.myrcm.ch/myrcm/main?hId[1]=org&dId[O]=45925&pLa=en"
  },
  {
    orgId: "41404",
    venueId: "marzahn",
    url: "https://www.myrcm.ch/myrcm/main?hId[1]=org&dId[O]=41404&pLa=en"
  },
  {
    orgId: "52898",
    venueId: "blankenfelde",
    url: "https://www.myrcm.ch/myrcm/main?hId[1]=org&dId[O]=52898&pLa=en"
  }
];

const trainingTerms = ["training", "trainings"];

const currentYear = new Date().getFullYear();
const allowedYears = [currentYear, currentYear + 1];

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

function eventId(venueId, name, from) {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  return `${venueId}-${from}-${slug}`;
}

function detectSeries(name) {
  const rules = [
    { label: "BTM", re: /berlin touring masters|\bbtm\b/i },
    { label: "TEC", re: /tamiya euro cup|\btec\b/i },
    { label: "Speed Masters", re: /speed masters/i },
    { label: "SK", re: /\bsk[- ]?lauf\b|sk lauf/i },
    { label: "Tamico", re: /tamico/i },
    { label: "RCK", re: /\brck\b/i }
  ];

  return rules.filter(rule => rule.re.test(name)).map(rule => rule.label);
}

function parseEvents(html, host) {
  const $ = cheerio.load(html);
  const races = [];

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

    let name = "";

    for (const text of cells) {
      if (!text) continue;
      if (parseDate(text)) continue;
      if (/^(deu|ger|germany|switzerland|che|aut|austria)$/i.test(text)) continue;
      if (/^\d+$/.test(text)) continue;
      if (text.toLowerCase().includes("registration")) continue;

      name = text;
      break;
    }

    if (!name) return;
    if (hasTrainingName(name)) return;

    const raceYear = Number(from.slice(0, 4));
    if (!allowedYears.includes(raceYear)) return;

    races.push({
      id: eventId(host.venueId, name, from),
      venueId: host.venueId,
      name,
      from,
      to,
      series: detectSeries(name),
      url: absoluteUrl(href) || host.url
    });
  });

  return races;
}

async function main() {
  const allRaces = [];

  for (const host of hosts) {
    console.log(`Lade MyRCM: ${host.venueId}`);

    const response = await fetch(host.url, {
      headers: {
        "user-agent": "Mozilla/5.0 myrcm-rc-map importer"
      }
    });

    if (!response.ok) {
      throw new Error(`MyRCM request failed for ${host.venueId}: ${response.status}`);
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
