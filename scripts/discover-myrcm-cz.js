#!/usr/bin/env node
/**
 * Discovers Czech RC clubs from myrcm.ch and updates myrcm-hosts-cz.json.
 * Runs on render.com where myrcm.ch is accessible.
 * Usage: node scripts/discover-myrcm-cz.js
 */

import * as cheerio from "cheerio";
import { readFile, writeFile } from "node:fs/promises";

const BASE = "https://www.myrcm.ch";
// myrcm.ch serves table rows only when the request looks like an XHR
const HEADERS = { "user-agent": "Mozilla/5.0 myrcm-rc-map importer" };
const AJAX_HEADERS = {
  ...HEADERS,
  "X-Requested-With": "XMLHttpRequest",
  "Accept": "text/html, */*; q=0.01",
};
const OUTPUT = "myrcm-hosts-cz.json";
const TIMEOUT_MS = 15000;
const CONCURRENCY = 4;

async function fetchText(url, ajax = false) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const headers = ajax ? AJAX_HEADERS : HEADERS;
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
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

const CZ_TEXT = new Set(["CZE", "CZ", "CZECH REPUBLIC", "CZECH REP.", "CZECHIA", "TSCHECHIEN", "TCHÉQUIE", "REPUBBLICA CECA", "REPÚBLICA CHECA"]);

function isCzechRow($, row) {
  const cells = $(row).find("td");
  for (let i = 0; i < cells.length; i++) {
    const cell = $(cells[i]);
    const txt = cell.text().trim().toUpperCase();
    if (CZ_TEXT.has(txt)) return true;
    let imgMatch = false;
    cell.find("img").each((_, img) => {
      const alt = ($(img).attr("alt") || "").toUpperCase().trim();
      const src = ($(img).attr("src") || "").toLowerCase();
      if (CZ_TEXT.has(alt) || src.includes("/cze") || src.includes("cze.") || src.includes("/cz/") || src.includes("_cz.") || src.includes("czech")) {
        imgMatch = true;
        return false;
      }
    });
    if (imgMatch) return true;
    const html = cell.html() || "";
    if (/\bfi-cz\b|\bflag-cz\b|\bf-cz\b/i.test(html)) return true;
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

// Paginate org-list pages using AJAX mode (tId=O triggers row-only HTML response)
async function paginateOrgIds(baseUrl, orgMap, label) {
  for (let page = 1; page <= 300; page++) {
    const pageUrl = `${baseUrl}&tId=O&pId[O]=${page}`;
    const pageHtml = await fetchText(pageUrl, true);
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

// Paginate org-list to find Czech rows (AJAX mode, tId=O)
async function paginateCzechOrgsFromOrgList(baseUrl, orgMap, label, totalPages) {
  for (let page = 1; page <= totalPages; page++) {
    const html = await fetchText(`${baseUrl}&tId=O&pId[O]=${page}`, true);
    if (!html) continue;
    for (const [id, name] of extractCzechOrgsFromPage(html)) orgMap.set(id, name);
    if (page % 50 === 0) console.log(`  [${label}] Page ${page}/${totalPages}: ${orgMap.size} Czech orgs`);
    await new Promise(r => setTimeout(r, 150));
  }
}

// Paginate event-list pages to find Czech org links (AJAX mode, tId=E + pId[E])
async function paginateCzechOrgsFromEvents(baseUrl, orgMap, label, totalPages) {
  for (let page = 1; page <= totalPages; page++) {
    const html = await fetchText(`${baseUrl}&tId=E&pId[E]=${page}`, true);
    if (!html) continue;
    for (const [id, name] of extractCzechOrgsFromPage(html)) orgMap.set(id, name);
    if (page % 25 === 0) console.log(`  [${label}] Page ${page}/${totalPages}: ${orgMap.size} Czech orgs`);
    await new Promise(r => setTimeout(r, 150));
  }
}

async function discoverOrgIdsFromEvents() {
  const orgMap = new Map();

  // Phase 1a: Org-list filtered by CZE — try AJAX mode first (tId=O&pId[O]=1)
  const orgListPatterns = [
    `${BASE}/myrcm/main?pLa=en&hId[1]=orl&fId[C]=CZE`,
    `${BASE}/myrcm/main?pLa=en&hId[1]=orl&fId[C]=Czech+Republic`,
    `${BASE}/myrcm/main?pLa=en&hId[1]=orl&country=CZE`,
  ];
  for (const url of orgListPatterns) {
    console.log(`Phase 1a: ${url}`);
    const ajaxPage1 = await fetchText(`${url}&tId=O&pId[O]=1`, true);
    if (ajaxPage1) {
      const ajaxOrgs = extractOrgIds(ajaxPage1);
      const ajaxCzOrgs = extractCzechOrgsFromPage(ajaxPage1);
      console.log(`  → AJAX page 1: ${ajaxOrgs.length} org links, ${ajaxCzOrgs.size} CZ rows`);
      if (ajaxOrgs.length > 0) {
        for (const o of ajaxOrgs) if (!orgMap.has(o.orgId)) orgMap.set(o.orgId, o.name);
        for (const [id, name] of ajaxCzOrgs) if (!orgMap.has(id)) orgMap.set(id, name);
        await paginateOrgIds(url, orgMap, "org-list-ajax");
        console.log(`Phase 1a (AJAX) found ${orgMap.size} Czech orgs`);
        if (orgMap.size > 0) return [...orgMap.entries()].map(([orgId, name]) => ({ orgId, name }));
      }
    }
    // Fallback: non-AJAX (static HTML, usually empty table)
    const html = await fetchText(url);
    if (!html) { await new Promise(r => setTimeout(r, 300)); continue; }
    const orgs = extractOrgIds(html);
    console.log(`  → static: ${orgs.length} org links`);
    if (orgs.length > 0) {
      for (const o of orgs) if (!orgMap.has(o.orgId)) orgMap.set(o.orgId, o.name);
      await paginateOrgIds(url, orgMap, "org-list");
      if (orgMap.size > 0) {
        console.log(`Phase 1a (static) found ${orgMap.size} Czech orgs`);
        return [...orgMap.entries()].map(([orgId, name]) => ({ orgId, name }));
      }
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // Phase 1.5: Full org-list scan (AJAX, all countries, filter by CZ text)
  console.log("\nPhase 1.5: Full org-list AJAX scan...");
  const orgListUrl = `${BASE}/myrcm/main?pLa=en&hId[1]=orl`;
  const orgListFirst = await fetchText(orgListUrl);
  if (orgListFirst) {
    const totalMatch = orgListFirst.match(/from\s+([\d,]+)/i) || orgListFirst.match(/of\s+([\d,]+)/i);
    const totalOrgs = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ""), 10) : 1000;
    const totalPages = Math.min(Math.ceil(totalOrgs / 50), 500);
    console.log(`  Org list: ~${totalOrgs} orgs, ${totalPages} pages`);
    for (const [id, name] of extractCzechOrgsFromPage(orgListFirst)) orgMap.set(id, name);
    await paginateCzechOrgsFromOrgList(orgListUrl, orgMap, "org-list-full", totalPages);
    console.log(`Phase 1.5 done. Czech orgs: ${orgMap.size}`);
    if (orgMap.size > 0) return [...orgMap.entries()].map(([orgId, name]) => ({ orgId, name }));
  }

  // Phase 1b: Filtered event-list URLs (AJAX mode, tId=E&pId[E]=N)
  const eventListPatterns = [
    `${BASE}/myrcm/main?pLa=en&hId[1]=arv&fId[C]=CZE`,
    `${BASE}/myrcm/main?pLa=en&hId[1]=arv&country=CZE`,
    `${BASE}/myrcm/main?pLa=en&hId[1]=upc&fId[C]=CZE`,
  ];
  for (const url of eventListPatterns) {
    console.log(`Phase 1b: ${url}`);
    const ajaxPage1 = await fetchText(`${url}&tId=E&pId[E]=1`, true);
    if (ajaxPage1) {
      const orgsById = extractOrgIds(ajaxPage1);
      const orgsByRow = extractCzechOrgsFromPage(ajaxPage1);
      console.log(`  → AJAX: ${orgsById.length} org links, ${orgsByRow.size} CZ rows`);
      const combined = new Map([...orgsById.map(o => [o.orgId, o.name]), ...orgsByRow]);
      if (combined.size > 0) {
        for (const [id, name] of combined) if (!orgMap.has(id)) orgMap.set(id, name);
        const totalMatch = ajaxPage1.match(/from\s+([\d,]+)/i);
        const totalEvents = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ""), 10) : 2000;
        const totalPages = Math.min(Math.ceil(totalEvents / 50), 300);
        console.log(`  Total events: ${totalEvents}, pages: ${totalPages}`);
        await paginateCzechOrgsFromEvents(url, orgMap, "filtered-events-ajax", totalPages);
        if (orgMap.size > 0) {
          console.log(`Phase 1b (AJAX) found ${orgMap.size} Czech orgs`);
          return [...orgMap.entries()].map(([orgId, name]) => ({ orgId, name }));
        }
      }
    }
    // Fallback: non-AJAX
    const html = await fetchText(url);
    if (!html) { await new Promise(r => setTimeout(r, 300)); continue; }
    const orgsById = extractOrgIds(html);
    const orgsByRow = extractCzechOrgsFromPage(html);
    const combined = new Map([...orgsById.map(o => [o.orgId, o.name]), ...orgsByRow]);
    if (combined.size > 0) {
      for (const [id, name] of combined) if (!orgMap.has(id)) orgMap.set(id, name);
      const totalMatch = html.match(/from\s+([\d,]+)/i);
      const totalEvents = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ""), 10) : 2000;
      const totalPages = Math.min(Math.ceil(totalEvents / 50), 300);
      await paginateCzechOrgsFromEvents(url, orgMap, "filtered-events", totalPages);
      if (orgMap.size > 0) {
        console.log(`Phase 1b (static) found ${orgMap.size} Czech orgs`);
        return [...orgMap.entries()].map(([orgId, name]) => ({ orgId, name }));
      }
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // Phase 2: Full scan of all event pages (AJAX mode, tId=E + pId[E])
  for (const [label, evUrl] of [
    ["arv", `${BASE}/myrcm/main?pLa=en&hId[1]=arv`],
    ["upc", `${BASE}/myrcm/main?pLa=en&hId[1]=upc`],
  ]) {
    console.log(`\nPhase 2 [${label}]: Full scan...`);
    const firstHtml = await fetchText(evUrl);
    if (!firstHtml) continue;
    const totalMatch = firstHtml.match(/from\s+([\d,]+)/i) || firstHtml.match(/of\s+([\d,]+)/i);
    const totalEvents = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ""), 10) : 5000;
    const totalPages = Math.min(Math.ceil(totalEvents / 50), 500);
    console.log(`  Total: ${totalEvents} events, ${totalPages} pages`);
    for (const [id, name] of extractCzechOrgsFromPage(firstHtml)) orgMap.set(id, name);
    await paginateCzechOrgsFromEvents(evUrl, orgMap, label, totalPages);
    console.log(`  [${label}] Done. Czech orgs so far: ${orgMap.size}`);
  }
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
      const alt = ($(img).attr("alt") || "").toUpperCase().trim();
      const src = ($(img).attr("src") || "").toLowerCase();
      if (CZ_TEXT.has(alt) || src.includes("/cze") || src.includes("/cz/") || src.includes("czech")) {
        country = "Czech Republic";
        return false;
      }
    });
  }
  if (!country) {
    const bodyText = $("body").text().toUpperCase();
    for (const t of CZ_TEXT) { if (bodyText.includes(t)) { country = "Czech Republic"; break; } }
  }
  const location = info["location"] || info["city"] || info["ort"] || "";
  const titleRaw = $("title").text().trim();
  const titleName = titleRaw.replace(/^MyRCM\s*[:\-]\s*(Host\s*[:\-]\s*)?/i, "").trim();
  const name = $("h1, h2, .org-title, .orgName").first().text().trim() || titleName || "";
  const eventCount = $(`a[href*="dId[E]="], a[href*="dId%5BE%5D="]`).length;
  const website = $("a[href^='http']").filter((_, el) => {
    const href = $(el).attr("href") || "";
    return !href.includes("myrcm.ch") && !href.includes("apple.com") && !href.includes("play.google.com") && !href.includes("rc-timing.ch");
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
    console.error("No org links found — myrcm-hosts-cz.json unchanged.");
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
    const c = (detail.country || "").toUpperCase().trim();
    if (!CZ_TEXT.has(c) && !c.includes("CZECH") && !c.includes("TSCHECH")) continue;
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
