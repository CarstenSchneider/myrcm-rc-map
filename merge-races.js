import { readFile, writeFile } from "node:fs/promises";

function normalize(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameRace(myrcmRace, rckRace) {
  if (myrcmRace.venueId !== rckRace.venueId) return false;
  if (myrcmRace.from !== rckRace.from) return false;
  return true;
}

const myrcm = JSON.parse(await readFile("races.json", "utf8"));
const rck = JSON.parse(await readFile("rck-races.json", "utf8"));

const merged = [...myrcm];

for (const rckRace of rck) {
  const existing = merged.find(r => sameRace(r, rckRace));

  if (!existing) {
    merged.push(rckRace);
    continue;
  }

  existing.sources = Array.from(
    new Set([
      ...(existing.sources || [existing.source].filter(Boolean)),
      ...(rckRace.sources || [rckRace.source].filter(Boolean))
    ])
  );

  if (rckRace.url) {
    existing.rckUrl = rckRace.url;
  }

  if (rckRace.registrationCount != null) {
    existing.registrationCount = rckRace.registrationCount;
  }

  if (rckRace.registrationDisplay) {
    existing.registrationDisplay = rckRace.registrationDisplay;
  }

  existing.documents = [
    ...(existing.documents || []),
    ...(rckRace.documents || [])
  ];

  existing.documents = Array.from(
    new Map(
      existing.documents
        .filter(doc => doc?.url)
        .map(doc => [doc.url, doc])
    ).values()
  );

  existing.rckGroups = Array.from(
    new Set([
      ...(existing.rckGroups || []),
      rckRace.rckGroup
    ].filter(Boolean))
  );
}

merged.sort((a, b) => {
  const da = a.from || "";
  const db = b.from || "";
  return da.localeCompare(db);
});

await writeFile(
  "combined-races.json",
  JSON.stringify(merged, null, 2) + "\n",
  "utf8"
);

console.log(`combined-races.json written (${merged.length} races)`);
