#!/usr/bin/env node
// Liest hosts.json, fetcht og:image von jeder Club-Website, schreibt Ergebnis zurück.
// Ausführen: node check-og-images.js

import { readFileSync, writeFileSync } from "fs";
import { setTimeout as sleep } from "timers/promises";

const TIMEOUT_MS = 8000;
const CONCURRENCY = 8;
const DELAY_MS = 100;

function extractOgImage(html) {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

async function fetchOgImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RCRaceMap/1.0)" },
      redirect: "follow",
    });
    if (!res.ok) return { status: res.status, ogImage: null };
    const html = await res.text();
    return { status: res.status, ogImage: extractOgImage(html) };
  } catch (e) {
    return { status: null, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  const hosts = JSON.parse(readFileSync("hosts.json", "utf8"));
  const withSite = hosts.filter(h => h.website);
  console.log(`${withSite.length} Hosts mit Website (von ${hosts.length} gesamt)\n`);

  let done = 0, found = 0, none = 0, errors = 0;

  // Process in batches of CONCURRENCY
  for (let i = 0; i < withSite.length; i += CONCURRENCY) {
    const batch = withSite.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async h => {
      let url = h.website;
      if (!url.startsWith("http")) url = "https://" + url;
      const result = await fetchOgImage(url);
      done++;
      if (result.ogImage) {
        h.ogImage = result.ogImage;
        found++;
        console.log(`✓ ${h.name}`);
        console.log(`  ${result.ogImage.slice(0, 80)}`);
      } else if (result.error) {
        errors++;
        console.log(`✗ ${h.name}: ${result.error.slice(0, 60)}`);
      } else {
        none++;
      }
    }));
    process.stdout.write(`\r[${done}/${withSite.length}] gefunden: ${found}  `);
    if (i + CONCURRENCY < withSite.length) await sleep(DELAY_MS);
  }

  console.log(`\n\n=== Ergebnis ===`);
  console.log(`og:image gefunden: ${found} / ${withSite.length}`);
  console.log(`Kein og:image:    ${none}`);
  console.log(`Fehler/Timeout:   ${errors}`);

  writeFileSync("hosts.json", JSON.stringify(hosts, null, 2) + "\n");
  console.log(`\nhosts.json geschrieben (${found} neue ogImage-Einträge)`);
}

run().catch(e => { console.error(e); process.exit(1); });
