import * as cheerio from "cheerio";
import { writeFile } from "node:fs/promises";

const baseUrl = "https://www.myrcm.ch/myrcm/main?hId[1]=org&pLa=en";
const maxPages = 100;

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function getOrgId(href) {
  if (!href) return null;
  const match = href.match(/dId\[O\]=(\d+)/);
  return match ? match[1] : null;
}

function absoluteUrl(href) {
  if (!href) return "";
  return new URL(href, "https://www.myrcm.ch").toString();
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

    const name = cells[0];
    const location = cells[1];
    const country = cells[2];
    const eventCount = Number(cells[3]) || 0;

    if (!/germany|deutschland/i.test(country)) return;

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

    if (hosts.length === 0 && page > 0) {
      break;
    }

    allHosts.push(...hosts);
  }

  const unique = Array.from(
    new Map(allHosts.map(host => [host.orgId, host])).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

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
