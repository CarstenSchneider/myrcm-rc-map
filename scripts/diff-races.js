#!/usr/bin/env node
// Diffs two races.json files and outputs meaningful changes for user notifications.
// Usage: node scripts/diff-races.js <old-file> <new-file>

const fs = require("fs");
const [,, oldFile, newFile] = process.argv;

let oldRaces = [], newRaces = [];
try { oldRaces = JSON.parse(fs.readFileSync(oldFile, "utf8")); } catch {}
try { newRaces = JSON.parse(fs.readFileSync(newFile, "utf8")); } catch {}

if (!Array.isArray(oldRaces) || !Array.isArray(newRaces)) {
  process.stdout.write("[]");
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
const oldMap = new Map(oldRaces.map(r => [r.id, r]));
const newMap = new Map(newRaces.map(r => [r.id, r]));
const changes = [];

// Deleted future races — treat as cancellation
for (const old of oldRaces) {
  if (!old.id || !old.from) continue;
  if (old.from < today) continue;
  if (newMap.has(old.id)) continue;
  const oldName = old.name ?? old.title ?? "";
  changes.push({
    id: old.id,
    venueId: old.venueId ?? null,
    hostId: old.hostId ?? null,
    hostName: old.hostName ?? old.venueName ?? "",
    from: old.from ?? "",
    to: old.to ?? old.from ?? "",
    name: oldName,
    registrationStatus: "deleted",
    registrationOpens: old.registrationOpens ?? null,
    url: old.url ?? "",
    documents: old.documents ?? [],
    changed: {},
  });
}

for (const r of newRaces) {
  if (!r.id || !r.from) continue;
  if (r.from < today) continue; // ignore past races

  const old = oldMap.get(r.id);
  if (!old) continue; // new race — handled by new_race notification

  const changed = {};

  // Registration status (skip → "open", that's handled by registration_open)
  const oldStatus = old.registrationStatus ?? null;
  const newStatus = r.registrationStatus ?? null;
  if (oldStatus !== newStatus && newStatus !== "open") {
    // Skip: upcoming/null → closed (never opened, not relevant to subscribers)
    const uninteresting =
      (oldStatus === "upcoming" || oldStatus === null) && newStatus === "closed";
    if (!uninteresting) {
      changed.registrationStatus = { from: oldStatus, to: newStatus };
    }
  }

  // Date change
  if ((old.from ?? "") !== (r.from ?? "") || (old.to ?? "") !== (r.to ?? "")) {
    changed.date = { from: old.from ?? "", fromTo: old.to ?? "", to: r.from ?? "", toTo: r.to ?? "" };
  }

  // Name/title change
  const oldName = old.name ?? old.title ?? "";
  const newName = r.name ?? r.title ?? "";
  if (oldName !== newName) {
    changed.name = { from: oldName, to: newName };
  }

  if (Object.keys(changed).length === 0) continue;

  changes.push({
    id: r.id,
    venueId: r.venueId ?? null,
    hostId: r.hostId ?? null,
    hostName: r.hostName ?? r.venueName ?? "",
    from: r.from ?? "",
    to: r.to ?? r.from ?? "",
    name: newName,
    registrationStatus: newStatus ?? "",
    registrationOpens: r.registrationOpens ?? null,
    url: r.url ?? "",
    documents: r.documents ?? [],
    changed,
  });
}

process.stdout.write(JSON.stringify(changes));
