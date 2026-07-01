#!/usr/bin/env node
/**
 * Discovers Czech RC clubs from myrcm.ch event listings and updates myrcm-hosts-cz.json.
 * Runs on render.com where myrcm.ch is accessible.
 * Usage: node scripts/discover-myrcm-cz.js
 */

import * as cheerio from "cheerio";
import { readFile, writeFile } from "node:fs/promises";

const BASE = "https://www.myrcm.ch";
const HEADERS = { "user-agent": "Mozilla/5.0 myrcm-rc-map importer" };
const OUTPUT = "myrcm-hosts-cz.json";
const TIMEOUT_MS = 15000;
const CONCURRENCY = 4;

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: HEADERS });
    clearTimeout(timer);
    if (!res.ok) { console.warn(`  HTTP ${res.status} from ${url}`); return null; }
    return await res.text();
  } catch (e) {
    clearTimeout(timer);
    console.warn(`  ERROR fetching ${url}: ${e.message}`);
    return null;
  }
}

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

function isCzechRow($, row) {
  const cells = $(row).find("td");
  for (let i = 0; i < cells.length; i++) {
    const cell = $(cells[i]);
    const txt = cell.text().trim();
    if (txt === "CZE" || txt.toLowerCase() === "czech republic" || txt.toLowerCase() === "czechia") return true;
    const img = cell.find("img").first();
    if (img.length) {
      const alt = (img.attr("alt") || "").toUpperCase();
      const src = (img.attr("src") || "").toLowerCase();
      if (alt === "CZE" || alt === "CZECH REPUBLIC" || src.includes("/cze") || src.includes("cze.")) return true;
    }
  }
  return false;
}

function extractCzechOrgsFromPage(html) {
  const $ = cheerio.load(html);
  const found = new Map();
  $("tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 3) return;
    if (!isCzechRow($, row)) return;
    $(row).find("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const m = href.match(/dId(?:%5B|\[)O(?:%5D|\])=(\d+)/i);
      if (m) found.set(m[1], $(el).text().trim());
    });
  });
  return found;
}

async function paginateOrgIds(baseUrl, orgMap, label) {
  for (let page = 1; page <= 300; page++) {
    const pageUrl = `${baseUrl}&pId[O]=${page}`;
    const pageHtml = await fetchText(pageUrl);
    if (!pageHtml) break;
    const pageOrgs = extractOrgIds(pageHtml);
    if (pageOrgs.length === 0) break;
    const prevSize = orgMap.size;
    for (const o of pageOrgs) if (!orgMap.has(o.orgId)) orgMap.set(o.orgId, o.name);
    console.log(`  [${label}] Page ${page}: ${pageOrgs.length} orgs, ${orgMap.size} total`);
    if (orgMap.size === prevSize) break;
    await new Promise(r => setTimeout(r, 200));
  }
}

async function paginateCzechOrgs(baseUrl, orgMap, label, totalPages) {
  for (let page = 1; page < totalPages; page++) {
    const pageUrl = `${baseUrl}&pId[O]=${page}`;
    const html = await fetchText(pageUrl);
    if (!html) continue;
    for (const [id, name] of extractCzechOrgsFromPage(html)) orgMap.set(id, name);
    if (page % 25 === 0) console.log(`  [${label}] Page ${page}/${totalPages}: ${orgMap.size} Czech orgs`);
    await new Promise(r => setTimeout(r, 150));
  }
}

async function discoverOrgIdsFromEvents() {
  const orgMap = new Map();

  // Phase 1a: Try org-list URL filtered by CZE
  const orgListPatterns = [
    `${BASE}/myrcm/main?pLa=en&hId[1]=orl&fId[C]=CZE`,
    `${BASE}/myrcm/main?pLa=en&hId[1]=orl&fId[C]=Czech+Republic`,
    `${BASE}/myrcm/main?pLa=en&hId[1]=orl&country=CZE`,
  ];
  for (const url of orgListPatterns) {
    console.log(`Phase 1a: ${url}`);
    const html = await fetchText(url);
    if (!html) continue;
    const orgs = extractOrgIds(html);
    console.log(`  → ${orgs.length} org links`);
    if (orgs.length > 0) {
      for (const o of orgs) if (!orgMap.has(o.orgId)) orgMap.set(o.orgId, o.name);
      await paginateOrgIds(url, orgMap, "org-list");
      console.log(`Org-list worked. Czech orgs found: ${orgMap.size}`);
      return [...orgMap.entries()].map(([orgId, name]) => ({ orgId, name }));
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // Phase 1b: Try filtered event-list URLs
  const eventListPatterns = [
    `${BASE}/myrcm/main?pLa=en&hId[1]=arv&fId[C]=CZE`,
    `${BASE}/myrcm/main?pLa=en&hId[1]=arv&country=CZE`,
    `${BASE}/myrcm/main?pLa=en&hId[1]=upc&fId[C]=CZE`,
  ];
  for (const url of eventListPatterns) {
    console.log(`Phase 1b: ${url}`);
    const html = await fetchText(url);
    if (!html) continue;
    const orgsById = extractOrgIds(html);
    const orgsByRow = extractCzechOrgsFromPage(html);
    console.log(`  → extractOrgIds: ${orgsById.length}, extractCzechOrgs: ${orgsByRow.size}`);
    const combined = new Map([...orgsById.map(o => [o.orgId, o.name]), ...orgsByRow]);
    if (combined.size > 0) {
      for (const [id, name] of combined) if (!orgMap.has(id)) orgMap.set(id, name);
      const totalMatch = html.match(/from\s+([\d,]+)/i);
      const totalEvents = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ""), 10) : 2000;
      const totalPages = Math.min(Math.ceil(totalEvents / 50), 300);
      console.log(`  Total events: ${totalEvents}, pages: ${totalPages}`);
      await paginateCzechOrgs(url, orgMap, "filtered-events", totalPages);
      console.log(`Filtered event URL worked. Czech orgs: ${orgMap.size}`);
      return [...orgMap.entries()].map(([orgId, name]) => ({ orgId, name }));
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // Phase 2: Full scan
  console.log("\nPhase 2: Full scan of all event pages...");
  const allEventsUrl = `${BASE}/myrcm/main?pLa=en&hId[1]=arv`;
  const firstHtml = await fetchText(allEventsUrl);
  if (!firstHtml) return [];
  const totalMatch = firstHtml.match(/from\s+([\d,]+)/i);
  const totalEvents = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ""), 10) : 5000;
  const totalPages = Math.ceil(totalEvents / 50);
  console.log(`Total events: ${totalEvents}, pages: ${totalPages}`);
  for (const [id, name] of extractCzechOrgsFromPage(firstHtml)) orgMap.set(id, name);
  await paginateCzechOrgs(allEventsUrl, orgMap, "full-scan", totalPages);
  console.log(`Full scan complete. ${orgMap.size} unique Czech org IDs found.`);
  return [...orgMap.entries()].map(([orgId, name]) => ({ orgId, name }));
}

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
  let country = info["country"] || "";
  if (!country) {
    $("img").each((_, img) => {
      const alt = (img.attr("alt") || "").toUpperCase();
      if (alt === "CZE" || alt === "CZECH REPUBLIC" || alt === "CZECHIA") { country = "Czech Republic"; return false; }
    });
  }
  const location = info["location"] || info["city"] || info["ort"] || "";
  const titleRaw = $("title").text().trim();
  const titleName = titleRaw.replace(/^MyRCM\s*[:\-]\s*(Host\s*[:\-]\s*)?/i, "").trim();
  const name = $("h1, h2, .org-title, .orgName").first().text().trim() || titleName || "";
  const eventCount = $(`a[href*="dId[E]="], a[href*="dId%5BE%5D="]`).length;
  const website = $("a[href^='http']").filter((_, el) => {
    const href = $(el).attr("href") || "";
    return !href.includes("myrcm.ch") && !href.includes("apple.com") && !href.includes("play.google.com");
  }).first().attr("href") || "";
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
  console.log("=== MyRCM Czech Republic Discovery ===");
  const orgs = await discoverOrgIdsFromEvents();
  console.log(`\nTotal unique orgs found: ${orgs.length}`);
  if (orgs.length === 0) {
    console.error("No org links found.");
    process.exit(0);
  }
  console.log("Fetching org details...");
  let checked = 0;
  const details = await runBatch(orgs, async ({ orgId, name }) => {
    const detail = await fetchOrgDetail(orgId);
    checked++;
    if (checked % 10 === 0) console.log(`  ${checked}/${orgs.length} checked...`);
    return { orgId, name, detail };
  });

  const czHosts = [];
  for (const { orgId, name, detail } of details) {
    if (!detail) continue;
    const c = (detail.country || "").toLowerCase();
    if (!c.includes("czech") && c !== "cz" && c !== "cze") continue;
    const entry = {
      orgId,
      name: detail.name || name,
      location: detail.location || "",
      country: "Czech Republic",
      eventCount: detail.eventCount,
      url: `${BASE}/?dId[O]=${orgId}&pLa=en&pId[O]=0&hId[1]=org`,
    };
    if (detail.website) entry.website = detail.website;
    czHosts.push(entry);
    console.log(`  ✓ ${entry.name} (${entry.location || "?"})`);
  }

  let existing = [];
  try { existing = JSON.parse(await readFile(OUTPUT, "utf8")); } catch { /* ok */ }
  const existingMap = new Map(existing.map(h => [h.orgId, h]));
  for (const h of czHosts) existingMap.set(h.orgId, h);
  const merged = [...existingMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  await writeFile(OUTPUT, JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nWrote ${merged.length} Czech clubs to ${OUTPUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
