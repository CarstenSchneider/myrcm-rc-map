import { readFile, writeFile } from "node:fs/promises";

/**
 * Load a PDF cache from a JSON file.
 * Returns a Map<url, cachedValue> (value is importer-specific).
 */
export async function loadPdfCache(file) {
  try {
    const obj = JSON.parse(await readFile(file, "utf8"));
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

/**
 * Save a PDF cache Map back to a JSON file.
 * Only writes if the cache grew (new entries added).
 * Returns true if the file was written.
 */
export async function savePdfCache(file, cache, prevSize) {
  if (cache.size <= prevSize) return false;
  await writeFile(file, JSON.stringify(Object.fromEntries(cache), null, 2) + "\n", "utf8");
  console.log(`PDF-Cache gespeichert: ${file} (${cache.size} Einträge, ${cache.size - prevSize} neu)`);
  return true;
}

/**
 * Write a JSON array to a file with sanity checks:
 *   - data.length >= minCount (absolute minimum)
 *   - data.length >= existingCount * minFraction (regression guard)
 *
 * Throws before writing if either check fails.
 */
export async function safeWriteJson(data, outputFile, {
  minCount = 1,
  minFraction = 0.7,
  label = outputFile,
} = {}) {
  if (!Array.isArray(data)) {
    throw new Error(`safeWriteJson: Daten müssen ein Array sein (${label})`);
  }

  if (data.length < minCount) {
    throw new Error(
      `Sanity-Check fehlgeschlagen: ${data.length} Einträge in ${label} — Minimum ${minCount}. ` +
      `Mögliche Ursache: Seitenstruktur geändert oder Quelle nicht erreichbar.`
    );
  }

  try {
    const existing = JSON.parse(await readFile(outputFile, "utf8"));
    if (Array.isArray(existing) && existing.length > 0) {
      const threshold = Math.floor(existing.length * minFraction);
      if (data.length < threshold) {
        throw new Error(
          `Sanity-Check fehlgeschlagen: ${data.length} Einträge in ${label} ist weniger als ` +
          `${Math.round(minFraction * 100)}% der vorherigen ${existing.length}. ` +
          `Datei wird NICHT überschrieben.`
        );
      }
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    // Datei existiert noch nicht — erster Lauf, kein Vergleich möglich
  }

  await writeFile(outputFile, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`Geschrieben: ${outputFile} (${data.length} Einträge)`);
}

/**
 * Log a warning if a key field is missing in too many entries.
 * Helps detect structural changes early.
 */
export function warnIfSparse(data, fields, { label = "", threshold = 0.5 } = {}) {
  if (!data.length) return;
  for (const field of fields) {
    const count = data.filter(d => d[field] != null && d[field] !== "").length;
    const fraction = count / data.length;
    if (fraction < threshold) {
      console.warn(
        `WARNUNG: Feld "${field}" fehlt bei ${Math.round((1 - fraction) * 100)}% der Einträge` +
        (label ? ` in ${label}` : "") +
        ` — Seitenstruktur geändert?`
      );
    }
  }
}
