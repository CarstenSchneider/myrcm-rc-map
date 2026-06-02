import * as cheerio from "cheerio";
import { writeFile } from "node:fs/promises";

const baseUrl = "https://www.myrcm.ch/myrcm/main?hId[1]=org&pLa=en";
const myRcmBaseUrl = "https://www.myrcm.ch";
const maxPages = 40;
const requestTimeoutMs = 10000;
const websiteConcurrency = 6;
const retryCount = 1;

const excludedTerms = [
  "kart gmbh",
  "kartbahn",
  "kart-center",
  "kartcenter",
  "karting",
  "gokart",
  "go-kart",
  "cockpit-kartarena",
  "kartarena",
  "burgpark ring kart"
];

const ignoredWebsiteHosts = [
  "myrcm.ch",
  "www.myrcm.ch",
  "facebook.com",
  "www.facebook.com",
  "instagram.com",
  "www.instagram.com",
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com"
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

function isExcludedHost(host) {
  const text = `${host.name} ${host.location}`.toLowerCase();
  return excludedTerms.some(term => text.includes(term));
}

function isAllowedWebsiteUrl(url) {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (ignoredWebsiteHosts.includes(hostname)) return false;

    return true;
  } catch {
    return false;
  }
}

function parseHosts(html) {
  const $ = cheerio.load(html);
  const hosts = [];

  $("tr").each((_, row) => {
    const cells = $(row)
      .find("td")
      .toArray()
      .map(cell => normalizeText($(cell).text()));

    if (cells.length < 4) return;

    const links = $(row).find("a").toArray();
    const hostLink = links.length ? $(links[0]).attr("href") : "";
    const orgId = getOrgId(hostLink);

    if (!orgId) return;

    const name = cells[1];
    const location = cells[2];
    const country = cells[3];
    const eventCount = Number(cells[4]) || 0;

    if (!/germany|deutschland|deu/i.test(country)) return;

    hosts.push({
      orgId,
      name,
      location,
      country,
      eventCount,
      url: absoluteUrl(hostLink)
    });
  });

  return hosts;
}

async function fetchText(url, attempt = 0) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 myrcm-rc-map host discovery"
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

function directElementText($, element) {
  return normalizeText(
    $(element)
      .contents()
      .filter((_, node) => node.type === "text")
      .text()
  );
}

function firstAllowedLink($, root) {
  const links = $(root).find("a").addBack("a").toArray();

  for (const link of links) {
    const href = $(link).attr("href");
    if (!href) continue;

    let url = "";

    try {
      url = absoluteUrl(href);
    } catch {
      continue;
    }

    if (isAllowedWebsiteUrl(url)) return url;
  }

  return null;
}

function extractWebsiteFromWebField(html) {
  const $ = cheerio.load(html);

  const rowCandidate = $("tr")
    .toArray()
    .map(row => {
      const cells = $(row).find("td, th").toArray();
      const texts = cells.map(cell => normalizeText($(cell).text()));

      return { row, cells, texts };
    })
    .find(({ texts }) => texts.some(text => /^web\s*:?$/i.test(text) || /^web\s*:/i.test(text)));

  if (rowCandidate) {
    const url = firstAllowedLink($, rowCandidate.row);
    if (url) return url;

    const text = normalizeText($(rowCandidate.row).text());
    const match = text.match(/web\s*:\s*(https?:\/\/\S+)/i);
    if (match && isAllowedWebsiteUrl(match[1])) return match[1];
  }

  const labelCandidate = $("*")
    .toArray()
    .find(element => /^web\s*:?$/i.test(directElementText($, element)));

  if (labelCandidate) {
    const sameParentUrl = firstAllowedLink($, $(labelCandidate).parent());
    if (sameParentUrl) return sameParentUrl;

    const nextSiblingsUrl = firstAllowedLink($, $(labelCandidate).nextAll());
    if (nextSiblingsUrl) return nextSiblingsUrl;
  }

  const bodyText = normalizeText($("body").text());
  const textMatch = bodyText.match(/web\s*:\s*(https?:\/\/\S+)/i);
  if (textMatch && isAllowedWebsiteUrl(textMatch[1])) return textMatch[1];

  return null;
}

async function discoverWebsite(hostUrl) {
  if (!hostUrl) return null;

  try {
    const html = await fetchText(hostUrl);
    return extractWebsiteFromWebField(html);
  } catch (error) {
    console.warn(`  Website-Feld konnte nicht gelesen werden: ${error.message}`);
    return null;
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  return results;
}

async function main() {
  const allHosts = [];

  for (let page = 0; page < maxPages; page++) {
    const url = `${baseUrl}&pId[O]=${page}`;
    console.log(`Lade Hostliste Seite ${page + 1}`);

    const html = await fetchText(url);
    const hosts = parseHosts(html);

    console.log(`  ${hosts.length} deutsche Hosts gefunden`);

    allHosts.push(...hosts);

    if (!html.includes("Next") && page > 0) {
      break;
    }
  }

  const unique = Array.from(
    new Map(allHosts.map(host => [host.orgId, host])).values()
  )
    .filter(host => Number(host.eventCount || 0) > 0)
    .filter(host => !isExcludedHost(host));

  await mapWithConcurrency(unique, websiteConcurrency, async host => {
    console.log(`Web-Feld lesen: ${host.name}`);
    host.website = await discoverWebsite(host.url);
    return host;
  });

  unique.sort((a, b) => a.name.localeCompare(b.name));

  await writeFile(
    "myrcm-hosts-germany.json",
    JSON.stringify(unique, null, 2) + "\n",
    "utf8"
  );

  console.log(`myrcm-hosts-germany.json geschrieben: ${unique.length} Hosts`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
