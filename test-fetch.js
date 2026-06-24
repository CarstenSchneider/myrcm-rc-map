// Test: Wie viele myrcm.ch Requests gehen gut, bevor es scheitert?
// Läuft via: node test-fetch.js
// Oder via GitHub Actions workflow: test-myrcm-fetch.yml

import { readFile } from "node:fs/promises";

const TIMEOUT_MS = 10000;
const TEST_COUNT = 20; // Ersten 20 Hosts testen

const UA_SCRAPER = "Mozilla/5.0 myrcm-rc-map importer";
const UA_BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

async function fetchWithTimeout(url, userAgent) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": userAgent }
    });
    const ms = Date.now() - start;
    return { ok: res.ok, status: res.status, ms };
  } catch (err) {
    const ms = Date.now() - start;
    return { ok: false, status: null, ms, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function runTest(label, userAgent) {
  const raw = await readFile("myrcm-hosts-germany.json", "utf-8");
  const hosts = JSON.parse(raw).slice(0, TEST_COUNT);

  console.log(`\n=== ${label} ===`);
  console.log(`User-Agent: ${userAgent.slice(0, 60)}...\n`);

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[i];
    const result = await fetchWithTimeout(host.url, userAgent);
    const icon = result.ok ? "✓" : "✗";
    const extra = result.error ? ` (${result.error})` : "";
    console.log(`${String(i + 1).padStart(3)}. [${result.status ?? "ERR"}] ${icon} ${host.name} — ${result.ms}ms${extra}`);
    if (result.ok) passed++; else failed++;
  }

  console.log(`\nErgebnis: ${passed} OK, ${failed} FEHLER von ${hosts.length} Hosts`);
}

async function main() {
  console.log("MyRCM Fetch-Test");
  console.log("================");
  console.log(`Datum: ${new Date().toISOString()}`);

  await runTest("Test A: Aktueller User-Agent (Scraper-UA)", UA_SCRAPER);
  await runTest("Test B: Browser User-Agent (Chrome)", UA_BROWSER);
}

main().catch(console.error);
