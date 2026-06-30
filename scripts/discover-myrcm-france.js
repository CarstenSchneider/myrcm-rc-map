#!/usr/bin/env node
/**
 * Discovers French RC clubs from myrcm.ch event listings and updates myrcm-hosts-france.json.
 * Runs on render.com where myrcm.ch is accessible.
 * Usage: node scripts/discover-myrcm-france.js
 *
 * Strategy: fetch the myrcm.ch event list filtered by country FRA, extract unique org IDs
 * from the Host column, then fetch each org's detail page to confirm country=France.
 */

import * as cheerio from "cheerio";
import { readFile, writeFile } from "node:fs/promises";

const BASE = "https://www.myrcm.ch";
const HEADERS = { "user-agent": "Mozilla/5.0 myrcm-rc-map importer" };
const OUTPUT = "myrcm-hosts-france.json";
const TIMEOUT_MS = 15000;
const CONCURRENCY = 4;

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: HEADERS });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`  HTTP ${res.status} from ${url}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    clearTimeout(timer);
    console.warn(`  ERROR fetching ${url}: ${e.message}`);
    return null;
  }
}

// Extract org IDs from any myrcm.ch page (links with dId[O]=NNN)
function extractOrgIds(html) {
  const $ = cheerio.load(html);
  const seen = new Map();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/dId(?:%5B|\[)O(?:%5D|\])=(\d+)/i);
    if (!m) return;
    const orgId = m[1];
    if (!seen.has(orgId)) seen.set(orgId, $(el).text().trim());
  });
  return [...seen.entries()].map(([orgId, name]) => ({ orgId, name }));
}

// Fetch all pages of the event list for France and collect org IDs
async function discoverOrgIdsFromEvents() {
  const orgMap = new Map();

  // URL patterns to try for France event listing
  // hId[1]=arv = archive/event list view, fId[C] or country might filter by country
  const listUrlPatterns = [
    `${BASE}/myrcm/main?pLa=en&hId[1]=arv&fId[C]=FRA`,
    `${BASE}/myrcm/main?pLa=en&hId[1]=arv&country=FRA`,
    `${BASE}/myrcm/main?pLa=en&hId[1]=arv&fId[C]=France`,
    `${BASE}/myrcm/main?pLa=en&hId[1]=arv&country=France`,
    `${BASE}/myrcm/main?pLa=fr&hId[1]=arv`,
    `${BASE}/myrcm/main?pLa=en&hId[1]=upc&fId[C]=FRA`,
    `${BASE}/myrcm/main?pLa=en&hId[1]=upc&country=FRA`,
  ];

  // Phase 1: Try filtered URLs first (fast path)
  for (const url of listUrlPatterns) {
    console.log(`Trying filtered: ${url}`);
    const html = await fetchText(url);
    if (!html) continue;

    const orgs = extractOrgIds(html);
    console.log(`  → ${orgs.length} org links found`);

    if (orgs.length > 0) {
      for (const o of orgs) if (!orgMap.has(o.orgId)) orgMap.set(o.orgId, o.name);

      // Paginate: pId[O]=1, 2, ...
      for (let page = 1; page <= 200; page++) {
        const pageUrl = `${url}&pId[O]=${page}`;
        const pageHtml = await fetchText(pageUrl);
        if (!pageHtml) break;
        const pageOrgs = extractOrgIds(pageHtml);
        if (pageOrgs.length === 0) break;
        const prevSize = orgMap.size;
        for (const o of pageOrgs) if (!orgMap.has(o.orgId)) orgMap.set(o.orgId, o.name);
        console.log(`  Page ${page}: ${pageOrgs.length} orgs, ${orgMap.size} total unique`);
        if (orgMap.size === prevSize) break;
        await new Promise(r => setTimeout(r, 200));
      }
      console.log(`Filtered URL worked. Total French org IDs: ${orgMap.size}`);
      return [...orgMap.entries()].map(([orgId, name]) => ({ orgId, name }));
    }

    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200);
    console.log(`  HTML snippet: ${text}`);
  }

  // Phase 2: Fallback — scan ALL event pages and pick rows where Country = FRA
  console.log("\nFiltered URLs returned no org links. Falling back to full scan...");
  const allEventsUrl = `${BASE}/myrcm/main?pLa=en&hId[1]=arv`;
  const firstHtml = await fetchText(allEventsUrl);
  if (!firstHtml) return [];

  // Detect total pages from "Results X from N" text
  const totalMatch = firstHtml.match(/from\s+([\d,]+)/i);
  const totalEvents = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ""), 10) : 5000;
  const perPage = 50;
  const totalPages = Math.ceil(totalEvents / perPage);
  console.log(`Total events: ${totalEvents}, pages to scan: ${totalPages}`);

  function extractFrenchOrgsFromPage(html) {
    const $ = cheerio.load(html);
    const found = new Map();
    $("tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length < 4) return;
      const countryCell = $(cells[2]).text().trim(); // Country column (index 2)
      if (countryCell !== "FRA" && countryCell.toLowerCase() !== "france") return;
      // Host is in first column — look for org link
      $(cells[0]).find("a[href]").each((_, el) => {
        const href = $(el).attr("href") || "";
        const m = href.match(/dId(?:%5B|\[)O(?:%5D|\])=(\d+)/i);
        if (m) found.set(m[1], $(el).text().trim());
      });
    });
    return found;
  }

  // Process first page
  for (const [id, name] of extractFrenchOrgsFromPage(firstHtml)) orgMap.set(id, name);
  console.log(`Page 0: ${orgMap.size} French orgs so far`);

  for (let page = 1; page < totalPages; page++) {
    const pageUrl = `${allEventsUrl}&pId[O]=${page}`;
    const html = await fetchText(pageUrl);
    if (!html) continue;
    for (const [id, name] of extractFrenchOrgsFromPage(html)) orgMap.set(id, name);
    if (page % 50 === 0) console.log(`Page ${page}/${totalPages}: ${orgMap.size} French orgs`);
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`Full scan complete. ${orgMap.size} unique French org IDs found.`);
  return [...orgMap.entries()].map(([orgId, name]) => ({ orgId, name }));
}

// Fetch org detail page to get name, location, eventCount, website
async function fetchOrgDetail(orgId) {
  const url = `${BASE}/myrcm/main?hId[1]=org&dId[O]=${orgId}&pLa=en`;
  const html = await fetchText(url);
  if (!html) return null;

  const $ = cheerio.load(html);
  const info = {};

  $("p").each((_, p) => {
    $(p).find(".label").each((_, lEl) => {
      const key = $(lEl).text().trim().replace(/:$/, "").toLowerCase();
      const val = $(lEl).next(".value").text().trim();
      if (key) info[key] = val;
    });
  });

  $("tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length >= 2) {
      const key = $(cells[0]).text().trim().replace(/:$/, "").toLowerCase();
      const val = $(cells[1]).text().trim();
      if (key && !info[key]) info[key] = val;
    }
  });

  const country = info["country"] || info["pays"] || "";
  const location = info["location"] || info["city"] || info["ort"] || "";
  const name = $("h1, h2, .org-title, .orgName").first().text().trim()
    || $("title").text().split("|")[0].trim() || "";
  const eventCount = $(`a[href*="dId[E]="], a[href*="dId%5BE%5D="]`).length;
  const website = $("a[href^='http']").filter((_, el) =>
    !($(el).attr("href") || "").includes("myrcm.ch")
  ).first().attr("href") || "";

  return { country, location, name, eventCount, website };
}

async function runBatch(items, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    results.push(...await Promise.all(batch.map(fn)));
    if (i + CONCURRENCY < items.length) await new Promise(r => setTimeout(r, 150));
  }
  return results;
}

async function main() {
  console.log("=== MyRCM France Discovery ===");

  const orgs = await discoverOrgIdsFromEvents();
  console.log(`\nTotal unique orgs found: ${orgs.length}`);

  if (orgs.length === 0) {
    console.error("No org links found. Check the URL patterns above.");
    process.exit(0);
  }

  // Fetch each org's details
  console.log("Fetching org details...");
  let checked = 0;
  const details = await runBatch(orgs, async ({ orgId, name }) => {
    const detail = await fetchOrgDetail(orgId);
    checked++;
    if (checked % 10 === 0) console.log(`  ${checked}/${orgs.length} checked...`);
    return { orgId, name, detail };
  });

  const franceHosts = [];
  for (const { orgId, name, detail } of details) {
    if (!detail) continue;
    const c = (detail.country || "").toLowerCase();
    if (!c.includes("france") && c !== "fr" && c !== "fra") continue;
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
    console.log(`  ✓ ${entry.name} (${entry.location || "?"})`);
  }

  // Merge with existing
  let existing = [];
  try { existing = JSON.parse(await readFile(OUTPUT, "utf8")); } catch { /* ok */ }
  const existingMap = new Map(existing.map(h => [h.orgId, h]));
  for (const h of franceHosts) existingMap.set(h.orgId, h);
  const merged = [...existingMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  await writeFile(OUTPUT, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nWrote ${merged.length} French clubs to ${OUTPUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
