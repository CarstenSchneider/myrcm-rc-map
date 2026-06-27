import { readFile, writeFile } from "node:fs/promises";

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
