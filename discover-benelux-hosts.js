import * as cheerio from "cheerio";
import { writeFile } from "node:fs/promises";

const baseUrl = "https://www.myrcm.ch/myrcm/main?hId[1]=org&pLa=en";
const myRcmBaseUrl = "https://www.myrcm.ch";
const maxPages = 40;
const requestTimeoutMs = 10000;
const retryCount = 1;

const beneluxPattern = /^(netherlands|nederland|belgium|belgique|belgi[eë]|belgien|luxembourg|luxemburg)$/i;

const excludedTerms = [
  "kart gmbh",
  "kartbahn",
  "kart-center",
  "kartcenter",
  "karting",
  "gokart",
  "go-kart",
  "kartarena",
];

function normalizeText(text = "") {
  return text.replace(/\s+/g, " ").trim();
}

function absoluteUrl(href) {
  if (!href) return "";
  return new URL(href, myRcmBaseUrl).toString();
}

function getOrgId(href) {
  if (!href) return null;
  const decoded = decodeURIComponent(href);
  let match = decoded.match(/dId\[O\]=(\d+)/);
  if (match) return match[1];
  match = href.match(/dId%5BO%5D=(\d+)/i);
  if (match) return match[1];
  return null;
}

function isExcluded(name = "") {
  const lower = name.toLowerCase();
  return excludedTerms.some(t => lower.includes(t));
}

function parseHosts(html) {
  const $ = cheerio.load(html);
  const hosts = [];

  $("tr").each((_, row) => {
    const cells = $(row).find("td").toArray().map(cell => normalizeText($(cell).text()));
    if (cells.length < 4) return;

    const links = $(row).find("a").toArray();
    const hostLink = links.length ? $(links[0]).attr("href") : "";
    const orgId = getOrgId(hostLink);
    if (!orgId) return;

    const name = cells[1];
    const location = cells[2];
    const country = cells[3];
    const eventCount = Number(cells[4]) || 0;

    if (!beneluxPattern.test(country)) return;

    hosts.push({ orgId, name, location, country, eventCount, url: absoluteUrl(hostLink) });
  });

  return hosts;
}

async function fetchText(url, attempt = 0) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 myrcm-rc-map benelux discovery" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    if (attempt < retryCount) return fetchText(url, attempt + 1);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const allHosts = [];

  for (let page = 0; page < maxPages; page++) {
    const url = `${baseUrl}&pId[O]=${page}`;
    console.log(`Lade Seite ${page + 1}...`);
    const html = await fetchText(url);
    const hosts = parseHosts(html);
    if (hosts.length) console.log(`  ${hosts.length} Benelux-Clubs gefunden`);
    allHosts.push(...hosts);
    if (!html.includes("Next") && page > 0) break;
  }

  const unique = Array.from(new Map(allHosts.map(h => [h.orgId, h])).values())
    .filter(h => Number(h.eventCount || 0) > 0)
    .filter(h => !isExcluded(h.name));

  unique.sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));

  await writeFile("myrcm-hosts-benelux.json", JSON.stringify(unique, null, 2) + "\n", "utf8");

  console.log(`\nFertig: ${unique.length} Benelux-Clubs in myrcm-hosts-benelux.json`);
  console.log("\nÜbersicht:");
  const byCountry = unique.reduce((acc, h) => {
    acc[h.country] = (acc[h.country] || 0) + 1;
    return acc;
  }, {});
  for (const [country, count] of Object.entries(byCountry)) {
    console.log(`  ${country}: ${count}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
