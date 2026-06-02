import * as cheerio from "cheerio";
import { writeFile } from "node:fs/promises";

const baseUrl = "https://www.myrcm.ch/myrcm/main?hId[1]=org&pLa=en";
const maxPages = 40;

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

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function absoluteUrl(href) {
  if (!href) return "";
  return new URL(href, "https://www.myrcm.ch").toString();
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

async function discoverWebsite(hostUrl) {
  if (!hostUrl) return null;

  try {
    const response = await fetch(hostUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 myrcm-rc-map host discovery"
      }
    });

    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);
    const candidates = [];

    $("a").each((_, link) => {
      const href = $(link).attr("href");
      const label = normalizeText($(link).text()).toLowerCase();

      if (!href) return;

      let url = "";

      try {
        url = absoluteUrl(href);
      } catch {
        return;
      }

      const lowerUrl = url.toLowerCase();

      if (lowerUrl.includes("myrcm.ch")) return;
      if (lowerUrl.startsWith("mailto:")) return;
      if (lowerUrl.includes("facebook.com")) return;
      if (lowerUrl.includes("instagram.com")) return;
      if (lowerUrl.includes("youtube.com")) return;
      if (lowerUrl.includes("twitter.com")) return;
      if (lowerUrl.includes("x.com")) return;

      candidates.push({
        url,
        label,
        score:
          (label.includes("homepage") ? 5 : 0) +
          (label.includes("website") ? 5 : 0) +
          (label.includes("internet") ? 4 : 0) +
          (label.includes("webseite") ? 5 : 0) +
          (label.includes("verein") ? 2 : 0)
      });
    });

    if (!candidates.length) return null;

    candidates.sort((a, b) => b.score - a.score);

    return candidates[0].url;
  } catch {
    return null;
  }
}


async function main() {
  const allHosts = [];

  for (let page = 0; page < maxPages; page++) {
    const url = `${baseUrl}&pId[O]=${page}`;
    console.log(`Lade Hostliste Seite ${page + 1}`);

    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 myrcm-rc-map host discovery"
      }
    });

    if (!response.ok) {
      throw new Error(`MyRCM request failed: ${response.status}`);
    }

    const html = await response.text();
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

  for (const host of unique) {
    console.log(`Website prüfen: ${host.name}`);
    host.website = await discoverWebsite(host.url);
  }

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
