#!/usr/bin/env node
/**
 * Discovers French RC clubs from myrcm.ch and updates myrcm-hosts-france.json.
 * Run on render.com or GitHub Actions where myrcm.ch is accessible.
 * Usage: node scripts/discover-myrcm-france.js
 */

import * as cheerio from "cheerio";
import { readFile, writeFile } from "node:fs/promises";

const BASE = "https://www.myrcm.ch";
const HEADERS = { "user-agent": "Mozilla/5.0 myrcm-rc-map importer" };
const OUTPUT = "myrcm-hosts-france.json";
const TIMEOUT_MS = 12000;
const CONCURRENCY = 4;

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: HEADERS });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.text();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// Extract unique orgIds from any HTML page
function extractOrgIds(html, pageUrl) {
  const $ = cheerio.load(html);
  const seen = new Map();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    try {
      const url = new URL(href, pageUrl);
      const orgId = url.searchParams.get("dId[O]");
      if (!orgId || seen.has(orgId)) return;
      seen.set(orgId, $(el).text().trim() || orgId);
    } catch { /* skip invalid URLs */ }
  });
  return [...seen.entries()].map(([orgId, name]) => ({ orgId, name }));
}

// Fetch an org's detail page and return { country, location, name, eventCount, website }
async function fetchOrgDetail(orgId) {
  const url = `${BASE}/myrcm/main?hId[1]=org&dId[O]=${orgId}&pLa=en`;
  try {
    const html = await fetchText(url);
    const $ = cheerio.load(html);

    // Extract label-value pairs (same structure as import-myrcm.js)
    const labels = {};
    $("p").each((_, p) => {
      $(p).find(".label").each((_, lEl) => {
        const key = $(lEl).text().trim().replace(/:$/, "").toLowerCase();
        const val = $(lEl).next(".value").text().trim();
        if (key) labels[key] = val;
      });
    });

    const country = labels["country"] || labels["pays"] || labels["land"] || "";
    const location = labels["location"] || labels["city"] || labels["ort"] || labels["ville"] || "";

    // Org name from heading or first h1/h2
    let name = "";
    $("h1, h2, .orgName, .org-name").first().each((_, el) => {
      name = $(el).text().trim();
    });

    // Count event links
    let eventCount = 0;
    $("a[href]").each((_, el) => {
      if (($(el).attr("href") || "").includes("dId[E]=")) eventCount++;
    });

    // External website
    let website = "";
    $("a[href^='http']").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (!href.includes("myrcm.ch") && !website) website = href;
    });

    return { country, location, name, eventCount, website, url };
  } catch (e) {
    return null;
  }
}

async function runBatch(items, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + CONCURRENCY < items.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  return results;
}

async function main() {
  // Listing pages to try for org discovery
  const listingPages = [
    `${BASE}/myrcm/main?pLa=fr`,
    `${BASE}/myrcm/main?pLa=fr&hId[1]=orgList`,
    `${BASE}/?pLa=fr`,
    `${BASE}/myrcm/main`,
  ];

  const orgMap = new Map();

  for (const pageUrl of listingPages) {
    try {
      console.log(`Fetching listing: ${pageUrl}`);
      const html = await fetchText(pageUrl);
      const found = extractOrgIds(html, pageUrl);
      console.log(`  → ${found.length} org links found`);
      for (const o of found) {
        if (!orgMap.has(o.orgId)) orgMap.set(o.orgId, o.name);
      }
    } catch (e) {
      console.warn(`  ✗ ${e.message}`);
    }
  }

  const allOrgs = [...orgMap.entries()].map(([orgId, name]) => ({ orgId, name }));
  console.log(`\nTotal unique orgs to check: ${allOrgs.length}`);

  if (allOrgs.length === 0) {
    console.error("No org links found — check listing URLs above.");
    process.exit(1);
  }

  // Check each org's country
  const franceHosts = [];
  let checked = 0;

  const details = await runBatch(allOrgs, async ({ orgId, name }) => {
    const detail = await fetchOrgDetail(orgId);
    checked++;
    if (checked % 20 === 0) console.log(`  ${checked}/${allOrgs.length} checked...`);
    return { orgId, name, detail };
  });

  for (const { orgId, name, detail } of details) {
    if (!detail) continue;
    const c = (detail.country || "").toLowerCase();
    if (!c.includes("france") && c !== "fr") continue;

    const entry = {
      orgId,
      name: detail.name || name,
      location: detail.location || "",
      country: "France",
      eventCount: detail.eventCount,
      url: `${BASE}/?dId[O]=${orgId}&pLa=en&hId[1]=org`,
    };
    if (detail.website) entry.website = detail.website;
    franceHosts.push(entry);
    console.log(`  ✓ FR: ${entry.name} (${entry.location || "?"})`);
  }

  // Merge with existing file (keep entries not found in latest scrape)
  let existing = [];
  try {
    existing = JSON.parse(await readFile(OUTPUT, "utf8"));
  } catch { /* file may not exist */ }

  const existingMap = new Map(existing.map(h => [h.orgId, h]));
  for (const h of franceHosts) existingMap.set(h.orgId, h);
  const merged = [...existingMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  await writeFile(OUTPUT, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nWrote ${merged.length} French clubs to ${OUTPUT}`);
  if (merged.length === 0) {
    console.warn("WARNING: 0 clubs found — listing URL may need adjustment.");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
