import * as cheerio from "cheerio";
import { access, readFile, writeFile } from "node:fs/promises";

const importerVersion = "import-rck-v8-pdf-website";

const sources = [
  {
    id: "rck-kleinserie",
    rckSeries: "kleinserie",
    seriesLabel: "RCK Kleinserie",
    titlePrefix: "RCK Kleinserie",
    url: "https://kleinserie.rck-solutions.de/indexgo.php"
  },
  {
    id: "rck-challenge",
    rckSeries: "challenge",
    seriesLabel: "RCK Challenge",
    titlePrefix: "RCK Challenge",
    url: "https://challenge.rck-solutions.de/indexgo.php"
  }
];

const venuesFile = "venues.json";

const outputFile = "rck-races.json";
const unmatchedVenuesFile = "rck-unmatched-venues.json";
const venueCandidatesFile = "rck-venue-candidates.json";

const requestTimeoutMs = 12000;
const retryCount = 1;
const geocodeDelayMs = 1100;
const geocodeEnabled = process.env.RCK_GEOCODE !== "0";

const groupLabels = ["mitte", "nord", "west", "süd", "sued", "ost"];

function normalizeText(text = "") {
  return String(text)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function normalizeInlineText(text = "") {
  return String(text)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value = "") {
  return normalizeInlineText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(value = "") {
  return normalizeKey(value)
    .replace(/\s+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseDate(value) {
  const match = normalizeInlineText(value).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function absoluteUrl(href, baseUrl) {
  if (!href) return null;

  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

async function fetchResponse(url, attempt = 0) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 rc-racing-map-rck-importer/5.0 (venue verification workflow)"
      }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } catch (error) {
    if (attempt < retryCount) return fetchResponse(url, attempt + 1);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url) {
  const response = await fetchResponse(url);
  return response.text();
}

async function fetchBuffer(url) {
  const response = await fetchResponse(url);
  return Buffer.from(await response.arrayBuffer());
}

async function readJsonIfExists(fileName, fallback = []) {
  try {
    await access(fileName);
    return JSON.parse(await readFile(fileName, "utf8"));
  } catch {
    return fallback;
  }
}

function cleanRckLocation(location = "") {
  return normalizeInlineText(location)
    .replace(/coming\s*soon/gi, "")
    .replace(/^bitte\s+einloggen.*$/i, "")
    .trim();
}

function hasComingSoon(rawLocation = "") {
  return /coming\s*soon/i.test(String(rawLocation));
}

function normalizeRckLocation(location = "") {
  const aliases = {
    "hann munden": "hann munden",
    "hann muenden": "hann munden",
    "hann munden nachtrennen": "hann munden",
    "wächtersbach": "wachtersbach",
    "waechtersbach": "wachtersbach",
    "rheda wiedenbruck": "rheda wiedenbruck",
    "rheda-wiedenbruck": "rheda wiedenbruck",
    "ibbenburen": "ibbenburen",
    "ibbenbueren": "ibbenburen",
    "neustadt b coburg": "neustadt bei coburg",
    "neustadt bei coburg": "neustadt bei coburg",
    "horstel riesenbeck": "hoerstel riesenbeck",
    "hörstel riesenbeck": "hoerstel riesenbeck",
    "hockendorf": "hoeckendorf",
    "höckendorf": "hoeckendorf"
  };

  const key = normalizeKey(cleanRckLocation(location));
  return aliases[key] || key;
}

function venueSearchText(venue = {}) {
  return normalizeKey([
    venue.id,
    venue.name,
    venue.city,
    venue.location,
    venue.address,
    venue.postalCode,
    venue.venueName,
    venue.venueLocation,
    venue.rckLocation,
    venue.organizerName,
    venue.hostId,
    venue.hostName,
    ...(Array.isArray(venue.aliases) ? venue.aliases : [])
  ].filter(Boolean).join(" "));
}

function cityFromVenue(venue = {}) {
  return normalizeRckLocation(
    venue.city ||
    venue.location ||
    venue.address ||
    venue.name ||
    ""
  );
}


function hostFieldsForVenue(venue, fallbackName = null) {
  return {
    hostId: venue?.hostId || venue?.id || null,
    hostName: venue?.hostName || fallbackName || venue?.name || null
  };
}

function matchVenueByLocation(location, venues) {
  const locationKey = normalizeRckLocation(location);
  if (!locationKey) return null;

  const exactCity = venues.find(venue => cityFromVenue(venue) === locationKey);
  if (exactCity) return exactCity;

  const exactName = venues.find(venue => normalizeKey(venue.name) === locationKey);
  if (exactName) return exactName;

  return venues.find(venue => {
    const haystack = venueSearchText(venue);
    const city = cityFromVenue(venue);
    if (!city) return false;
    return haystack.includes(locationKey) || locationKey.includes(city);
  }) || null;
}

function matchVenueByPdfData(pdfData, venues) {
  if (!pdfData) return null;

  const queryParts = [
    pdfData.venueName,
    pdfData.city,
    pdfData.postalCode,
    pdfData.address
  ].filter(Boolean);

  const queryKey = normalizeKey(queryParts.join(" "));
  if (!queryKey) return null;

  return venues.find(venue => {
    const haystack = venueSearchText(venue);
    if (!haystack) return false;

    if (pdfData.venueName && normalizeKey(venue.name) === normalizeKey(pdfData.venueName)) return true;
    if (pdfData.postalCode && String(venue.postalCode || "") === String(pdfData.postalCode)) return true;

    const cityKey = normalizeKey(pdfData.city || "");
    if (cityKey && cityFromVenue(venue) === cityKey) return true;

    return haystack.includes(queryKey) || queryKey.includes(haystack);
  }) || null;
}

function documentTypeFromText(value = "") {
  const lower = value.toLowerCase();

  if (
    lower.includes("ausschreibung") ||
    lower.includes("tender") ||
    lower.includes("invitation") ||
    lower.includes("announcement")
  ) return "announcement";

  if (
    lower.includes("reglement") ||
    lower.includes("regel") ||
    lower.includes("rules") ||
    lower.includes("technical")
  ) return "rules";

  if (
    lower.includes("zeitplan") ||
    lower.includes("schedule") ||
    lower.includes("timetable") ||
    lower.includes("ablauf")
  ) return "schedule";

  return "document";
}

function documentLabelFromType(type) {
  if (type === "announcement") return "Ausschreibung";
  if (type === "rules") return "Reglement";
  if (type === "schedule") return "Zeitplan";
  return "PDF";
}

function documentSourceText($, link) {
  const textParts = [
    $(link).text(),
    $(link).attr("title"),
    $(link).attr("alt"),
    $(link).parent().text(),
    $(link).closest("td").text()
  ];

  $(link).find("img").each((_, img) => {
    textParts.push($(img).attr("alt"));
    textParts.push($(img).attr("title"));
    textParts.push($(img).attr("src"));
  });

  return normalizeInlineText(textParts.filter(Boolean).join(" "));
}

function extractDocumentsFromCell($, cell, baseUrl) {
  const documents = [];
  const seenUrls = new Set();

  $(cell).find("a").each((_, link) => {
    const href = $(link).attr("href") || "";
    const url = absoluteUrl(href, baseUrl);

    if (!url || seenUrls.has(url)) return;

    const text = documentSourceText($, link);
    const lower = `${href} ${text}`.toLowerCase();

    if (!lower.includes(".pdf")) return;

    const type = documentTypeFromText(lower);
    const fileName = decodeURIComponent(url.split("/").pop() || "").split("?")[0];

    documents.push({
      type,
      label: documentLabelFromType(type),
      sourceLabel: text || null,
      fileName: fileName || documentLabelFromType(type),
      url
    });

    seenUrls.add(url);
  });

  return documents;
}

function extractRegistrationUrlFromCell($, cell, baseUrl) {
  const candidates = [];

  $(cell).find("a").each((_, link) => {
    const href = $(link).attr("href") || "";
    const url = absoluteUrl(href, baseUrl);
    const text = documentSourceText($, link).toLowerCase();
    const lowerHref = href.toLowerCase();

    if (!url) return;

    if (
      lowerHref.includes("indexnl.php") ||
      lowerHref.includes("indexn.php") ||
      lowerHref.includes("nenn") ||
      text.includes("nenn") ||
      text.includes("registration") ||
      text.includes("anmeldung")
    ) {
      candidates.push(url);
    }
  });

  return candidates[0] || null;
}

function extractLocationText($, cell) {
  const clone = $(cell).clone();

  clone.find("script, style").remove();

  clone.find("a").each((_, link) => {
    const href = ($(link).attr("href") || "").toLowerCase();

    if (
      href.includes(".pdf") ||
      href.includes("indexnl.php") ||
      href.includes("indexn.php")
    ) {
      $(link).remove();
    }
  });

  clone.find("img").remove();

  return normalizeInlineText(clone.text());
}

function registrationCountFromNennlisteText(text) {
  const match = text.match(/Gesamtanzahl\s+Nennungen:\s*(\d+)/i);
  if (!match) return null;

  const count = Number(match[1]);
  return Number.isFinite(count) ? count : null;
}

function classesFromNennlisteText(rawText) {
  const lines = String(rawText)
    .split(/\r?\n/)
    .map(line => normalizeInlineText(line))
    .filter(Boolean);

  const classes = [];
  const seen = new Set();

  for (const line of lines) {
    const match = line.match(/^(.+?)\s*-\s*Anzahl\s+Fahrer:\s*(\d+)$/i);
    if (!match) continue;

    const name = normalizeInlineText(match[1]);
    const entries = Number(match[2]);

    if (!name || !Number.isFinite(entries)) continue;

    const key = normalizeKey(name);
    if (seen.has(key)) continue;

    classes.push({ name, entries });
    seen.add(key);
  }

  return classes;
}

async function enrichFromRegistrationPage(race) {
  if (!race.url || race.url === race.detailUrl) return race;

  try {
    const html = await fetchText(race.url);
    const $ = cheerio.load(html);
    const normalizedText = normalizeInlineText($.text());
    const registrationCount = registrationCountFromNennlisteText(normalizedText);
    const classes = classesFromNennlisteText($.text());

    return {
      ...race,
      registrationCount: registrationCount ?? race.registrationCount,
      registrationDisplay:
        registrationCount !== null && registrationCount !== undefined
          ? String(registrationCount)
          : race.registrationDisplay,
      classes
    };
  } catch (error) {
    console.warn(`  RCK-Nennliste konnte nicht gelesen werden: ${race.url}`);
    console.warn(`    ${error.message}`);
    return race;
  }
}

async function extractPdfText(url) {
  let pdfParse;

  try {
    const imported = await import("pdf-parse/lib/pdf-parse.js");
    pdfParse = imported.default || imported;
  } catch {
    try {
      const imported = await import("pdf-parse");
      pdfParse = imported.default || imported;
    } catch {
      console.warn("  PDF-Parser fehlt. Bitte `pdf-parse` in package.json ergänzen.");
      return null;
    }
  }

  try {
    const buffer = await fetchBuffer(url);
    const result = await pdfParse(buffer);
    return result?.text || null;
  } catch (error) {
    console.warn(`  PDF konnte nicht gelesen werden: ${url}`);
    console.warn(`    ${error.message}`);
    return null;
  }
}

function compactPdfText(rawText = "") {
  return String(rawText)
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function valueAfterLabel(text, labels) {
  const escapedLabels = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const labelPattern = escapedLabels.join("|");

  const regex = new RegExp(`(?:^|\\n)\\s*(?:${labelPattern})\\s*:?\\s*(.+?)(?=\\n\\s*[A-ZÄÖÜ][A-Za-zÄÖÜäöüß /.-]{2,35}\\s*:|\\n\\s*$|$)`, "i");
  const match = text.match(regex);
  return match ? normalizeInlineText(match[1]) : null;
}

function splitOrganizerAndVenue(value = "") {
  const cleaned = normalizeInlineText(value);
  if (!cleaned) return { organizerName: null, venueName: null };

  const separators = [" / ", " | ", " – ", " - "];

  for (const separator of separators) {
    if (!cleaned.includes(separator)) continue;
    const parts = cleaned.split(separator).map(part => normalizeInlineText(part)).filter(Boolean);
    if (parts.length >= 2) {
      return {
        organizerName: parts[0] || null,
        venueName: parts.slice(1).join(separator).trim() || null
      };
    }
  }

  return { organizerName: cleaned, venueName: null };
}

function parseAddress(value = "") {
  const cleaned = normalizeInlineText(value)
    .replace(/^ort\s*:?\s*/i, "")
    .replace(/^adresse\s*:?\s*/i, "")
    .trim();

  if (!cleaned) {
    return { address: null, postalCode: null, city: null, fullAddress: null };
  }

  const match = cleaned.match(/^(.*?)(?:,\s*)?(\d{5})\s+(.+)$/);

  if (match) {
    return {
      address: normalizeInlineText(match[1].replace(/,$/, "")) || null,
      postalCode: match[2],
      city: normalizeInlineText(match[3]),
      fullAddress: cleaned
    };
  }

  return {
    address: cleaned,
    postalCode: null,
    city: null,
    fullAddress: cleaned
  };
}

function normalizeWebsiteUrl(value = "") {
  const cleaned = normalizeInlineText(value)
    .replace(/[),.;:]+$/g, "")
    .trim();

  if (!cleaned) return null;

  const withProtocol = /^https?:\/\//i.test(cleaned)
    ? cleaned
    : `https://${cleaned}`;

  try {
    const url = new URL(withProtocol);
    if (!url.hostname.includes(".")) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isIgnoredWebsite(url = "") {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  })();

  if (!host) return true;

  return [
    "rck-solutions.de",
    "kleinserie.rck-solutions.de",
    "challenge.rck-solutions.de",
    "myrcm.ch",
    "myrcm.de",
    "dmc-online.com"
  ].some(domain => host === domain || host.endsWith(`.${domain}`));
}

function extractWebsiteCandidates(text = "") {
  const matches = String(text).match(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s]*)?/gi) || [];

  return matches
    .map(normalizeWebsiteUrl)
    .filter(Boolean)
    .filter(url => !isIgnoredWebsite(url));
}

function extractEmailDomains(text = "") {
  const matches = String(text).match(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi) || [];

  return matches
    .map(email => {
      const domain = email.split("@").pop();
      return domain ? domain.toLowerCase().replace(/^www\./, "") : null;
    })
    .filter(Boolean);
}

function extractVenueWebsite(text = "") {
  const compact = compactPdfText(text || "");
  if (!compact) return null;

  const websiteCandidates = extractWebsiteCandidates(compact);
  if (!websiteCandidates.length) return null;

  const emailDomains = extractEmailDomains(compact);

  const byEmailDomain = websiteCandidates.find(url => {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return emailDomains.some(domain => host === domain || host.endsWith(`.${domain}`));
  });

  if (byEmailDomain) return byEmailDomain;

  const contactBlockMatch = compact.match(/(?:kontakt|e-mail|email|internet|webseite|website)\s*:?([\s\S]{0,450})/i);
  if (contactBlockMatch) {
    const contactCandidate = extractWebsiteCandidates(contactBlockMatch[1])[0];
    if (contactCandidate) return contactCandidate;
  }

  return websiteCandidates[0] || null;
}


function parsePdfVenueData(rawText, pdfUrl) {
  const text = compactPdfText(rawText || "");
  if (!text) return null;

  const organizerVenueLine = valueAfterLabel(text, [
    "Ausrichter / Strecke",
    "Ausrichter/Strecke",
    "Ausrichter / Rennstrecke",
    "Ausrichter/Rennstrecke",
    "Strecke / Ausrichter",
    "Strecke/Ausrichter"
  ]);

  const split = splitOrganizerAndVenue(organizerVenueLine);

  const organizerName =
    split.organizerName ||
    valueAfterLabel(text, ["Ausrichter", "Veranstalter", "Club", "Verein"]);

  const venueName =
    split.venueName ||
    valueAfterLabel(text, ["Strecke", "Rennstrecke", "Austragungsort"]);

  const addressLine = valueAfterLabel(text, [
    "Ort",
    "Adresse",
    "Adresse Strecke",
    "Streckenadresse",
    "Rennstrecke"
  ]);

  const parsedAddress = parseAddress(addressLine);
  const website = extractVenueWebsite(text);

  if (!organizerName && !venueName && !parsedAddress.fullAddress && !website) return null;

  return {
    organizerName: organizerName || null,
    venueName: venueName || null,
    address: parsedAddress.address,
    postalCode: parsedAddress.postalCode,
    city: parsedAddress.city,
    country: "DE",
    fullAddress: parsedAddress.fullAddress,
    website,
    sourcePdf: pdfUrl,
    addressVerifiedFromPdf: Boolean(parsedAddress.fullAddress),
    rawOrganizerVenueLine: organizerVenueLine || null,
    rawAddressLine: addressLine || null
  };
}

async function enrichFromPdf(race) {
  const announcement = (race.documents || []).find(document => document.type === "announcement") || race.documents?.[0];
  if (!announcement?.url) return race;

  const text = await extractPdfText(announcement.url);
  if (!text) return race;

  const pdfVenueData = parsePdfVenueData(text, announcement.url);
  if (!pdfVenueData) return race;

  return {
    ...race,
    pdfVenueData,
    organizerName: pdfVenueData.organizerName || race.organizerName || null,
    venueName: pdfVenueData.venueName || race.venueName,
    venueAddress: pdfVenueData.fullAddress || race.venueAddress || null,
    venueCity: pdfVenueData.city || race.venueCity || race.venueLocation,
    venuePostalCode: pdfVenueData.postalCode || race.venuePostalCode || null,
    venueWebsite: pdfVenueData.website || race.venueWebsite || null,
    addressVerifiedFromPdf: pdfVenueData.addressVerifiedFromPdf
  };
}

function geocodeQueryFromVenueData(venueData) {
  if (!venueData) return null;

  const parts = [
    venueData.address,
    [venueData.postalCode, venueData.city].filter(Boolean).join(" "),
    venueData.country || "DE"
  ].filter(Boolean);

  const query = normalizeInlineText(parts.join(", "));
  return query || null;
}

async function geocodeVenueData(venueData) {
  const query = geocodeQueryFromVenueData(venueData);
  if (!geocodeEnabled || !query) return null;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "de");
  url.searchParams.set("q", query);

  try {
    await sleep(geocodeDelayMs);
    const response = await fetchResponse(url.toString());
    const results = await response.json();
    const result = Array.isArray(results) ? results[0] : null;
    if (!result?.lat || !result?.lon) return null;

    return {
      lat: Number(result.lat),
      lng: Number(result.lon),
      geocodingSource: "nominatim",
      geocodingQuery: query,
      geocodingDisplayName: result.display_name || null,
      geocodingClass: result.class || null,
      geocodingType: result.type || null
    };
  } catch (error) {
    console.warn(`  Geocoding fehlgeschlagen: ${query}`);
    console.warn(`    ${error.message}`);
    return null;
  }
}

function isVerifiedRckVenueCandidate(candidate) {
  return Boolean(
    candidate?.addressVerifiedFromPdf &&
    Number.isFinite(Number(candidate.lat)) &&
    Number.isFinite(Number(candidate.lng))
  );
}

function applyRckVenueVerification(candidate) {
  if (!candidate) return candidate;

  const verified = isVerifiedRckVenueCandidate(candidate);

  if (verified) {
    return {
      ...candidate,
      verified: true,
      verificationStatus: "verifiziert"
    };
  }

  return {
    ...candidate,
    verified: false,
    verificationStatus: "standort nicht verifiziert"
  };
}


function makeUnverifiedVenueCandidate(race) {
  const pdfData = race.pdfVenueData || {};
  const location = race.rckLocation || race.venueLocation || race.venueName;
  const idBase = pdfData.venueName
    ? `${pdfData.venueName}-${pdfData.city || location}`
    : location;

  const id = `rck-${slugify(idBase) || slugify(location)}`;

  const candidate = {
    id,
    name: pdfData.venueName || race.venueName || location,
    city: pdfData.city || race.venueCity || location,
    address: pdfData.address || null,
    postalCode: pdfData.postalCode || null,
    country: pdfData.country || "DE",
    lat: null,
    lng: null,
    source: "rck",
    sources: [race.source].filter(Boolean),
    rckSeries: race.rckSeries || null,
    rckLocation: location,
    organizerName: pdfData.organizerName || race.organizerName || null,
    hostId: slugify(pdfData.organizerName || race.organizerName || pdfData.venueName || race.venueName || location),
    hostName: pdfData.organizerName || race.organizerName || pdfData.venueName || race.venueName || location,
    website: pdfData.website || race.venueWebsite || null,
    sourcePdf: pdfData.sourcePdf || null,
    addressVerifiedFromPdf: Boolean(pdfData.addressVerifiedFromPdf),
    verified: false,
    verificationStatus: "standort nicht verifiziert"
  };

  return applyRckVenueVerification(candidate);
}

function mergeVenueCandidate(existing, candidate) {
  const merged = {
    ...existing,
    ...candidate,
    id: existing.id || candidate.id,
    name: existing.name || candidate.name,
    city: existing.city || candidate.city,
    address: existing.address || candidate.address,
    postalCode: existing.postalCode || candidate.postalCode,
    country: existing.country || candidate.country || "DE",
    website: existing.website || candidate.website || null,
    lat: existing.lat ?? candidate.lat ?? null,
    lng: existing.lng ?? candidate.lng ?? null,
    sources: Array.from(new Set([...(existing.sources || []), ...(candidate.sources || [])].filter(Boolean))),
    addressVerifiedFromPdf: Boolean(existing.addressVerifiedFromPdf || candidate.addressVerifiedFromPdf)
  };

  return applyRckVenueVerification(merged);
}

async function buildVenueCandidates(races, venues) {
  const candidatesById = new Map();
  const allVenues = [...venues];

  for (const race of races) {
    const pdfMatch = matchVenueByPdfData(race.pdfVenueData, allVenues);
    const locationMatch = matchVenueByLocation(race.rckLocation, allVenues);
    const matched = pdfMatch || locationMatch;

    if (matched) {
      const hostFields = hostFieldsForVenue(matched, race.organizerName || matched.name || race.venueName);

      race.venueId = matched.id;
      race.venueName = matched.name || race.venueName;
      race.venueLocation = matched.city || matched.location || race.venueLocation;
      race.hostId = hostFields.hostId || matched.id;
      race.hostName = hostFields.hostName || race.organizerName || matched.name || race.venueName;
      continue;
    }

    const candidate = makeUnverifiedVenueCandidate(race);
    const geocoding = await geocodeVenueData(candidate);

    if (geocoding) {
      candidate.lat = geocoding.lat;
      candidate.lng = geocoding.lng;
      candidate.geocodingSource = geocoding.geocodingSource;
      candidate.geocodingQuery = geocoding.geocodingQuery;
      candidate.geocodingDisplayName = geocoding.geocodingDisplayName;
      candidate.geocodingClass = geocoding.geocodingClass;
      candidate.geocodingType = geocoding.geocodingType;
    }

    const verifiedCandidate = applyRckVenueVerification(candidate);

    const existingCandidate = candidatesById.get(verifiedCandidate.id);
    const mergedCandidate = existingCandidate
      ? mergeVenueCandidate(existingCandidate, verifiedCandidate)
      : verifiedCandidate;

    candidatesById.set(candidate.id, mergedCandidate);
    allVenues.push(mergedCandidate);

    const hostFields = hostFieldsForVenue(mergedCandidate, race.organizerName || mergedCandidate.name);

    race.venueId = mergedCandidate.id;
    race.venueName = mergedCandidate.name;
    race.venueLocation = mergedCandidate.city;
    race.hostId = hostFields.hostId || mergedCandidate.id;
    race.hostName = hostFields.hostName || race.organizerName || mergedCandidate.name;
    race.venueStatus = mergedCandidate.verified ? "matched" : "standort nicht verifiziert";
  }

  return Array.from(candidatesById.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function extractRacesFromTable(html, source, venues) {
  const $ = cheerio.load(html);
  const races = [];

  $("table").each((_, table) => {
    const rows = $(table).find("tr").toArray();
    if (!rows.length) return;

    let headers = [];

    for (const row of rows) {
      const headerCells = $(row).find("th, td").toArray();
      const possibleHeaders = headerCells.map(cell => normalizeInlineText($(cell).text()).toLowerCase());

      if (
        possibleHeaders.includes("datum") &&
        possibleHeaders.some(header => groupLabels.includes(header))
      ) {
        headers = possibleHeaders;
        continue;
      }

      if (!headers.length) continue;

      const cells = $(row).find("td, th").toArray();
      if (cells.length < 2) continue;

      const date = parseDate($(cells[0]).text());
      if (!date) continue;

      cells.slice(1).forEach((cell, index) => {
        const group = headers[index + 1] || "";
        if (!groupLabels.includes(group)) return;

        const rawLocation = extractLocationText($, cell);
        const location = cleanRckLocation(rawLocation);
        if (!normalizeRckLocation(location)) return;

        const documents = extractDocumentsFromCell($, cell, source.url);
        const registrationUrl = extractRegistrationUrlFromCell($, cell, source.url);
        const comingSoon = hasComingSoon(rawLocation) || (!registrationUrl && documents.length === 0);

        const venue = matchVenueByLocation(location, venues);
        const venueId = venue?.id || `rck-${slugify(location)}`;
        const venueName = venue?.name || location;
        const venueLocation = venue?.city || venue?.location || location;
        const hostFields = hostFieldsForVenue(venue, venueName);

        const groupLabel = group === "sued" ? "Süd" : group.charAt(0).toUpperCase() + group.slice(1);
        const name = `${source.titlePrefix} ${groupLabel} - ${location}`;
        const id = `${venueId}-${date}-${slugify(source.id)}-${slugify(groupLabel)}-${slugify(location)}`;

        races.push({
          importerVersion,
          id,
          venueId,
          venueName,
          venueLocation,
          hostId: hostFields.hostId || venueId,
          hostName: hostFields.hostName || venueName,
          venueStatus: venue ? "matched" : "standort nicht verifiziert",
          name,
          from: date,
          to: date,
          series: [source.seriesLabel],
          source: source.id,
          sources: [source.id],
          rckSeries: source.rckSeries,
          url: registrationUrl || source.url,
          detailUrl: source.url,
          registrationStatus: registrationUrl ? "open" : "upcoming",
          registrationOpens: null,
          registrationRequiresLogin: false,
          registrationSource: "rck",
          registrationCount: null,
          registrationDisplay: null,
          comingSoon,
          note: registrationUrl ? null : "Nennung folgt.",
          rckGroup: groupLabel,
          rckGroups: [groupLabel],
          rckLocation: location,
          organizerName: null,
          venueAddress: null,
          venueCity: venueLocation,
          venuePostalCode: null,
          addressVerifiedFromPdf: false,
          classes: [],
          documents
        });
      });
    }
  });

  return races;
}

function uniqueArray(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function mergeDocuments(aDocuments = [], bDocuments = []) {
  const documentsByUrl = new Map();

  for (const document of [...aDocuments, ...bDocuments]) {
    if (!document?.url) continue;
    documentsByUrl.set(document.url, document);
  }

  return Array.from(documentsByUrl.values());
}

function mergeClasses(aClasses = [], bClasses = []) {
  const byName = new Map();

  for (const item of [...aClasses, ...bClasses]) {
    if (!item?.name) continue;
    const key = normalizeKey(item.name);
    const existing = byName.get(key);

    if (!existing || Number(item.entries || 0) > Number(existing.entries || 0)) {
      byName.set(key, {
        name: item.name,
        entries: Number(item.entries || 0)
      });
    }
  }

  return Array.from(byName.values());
}

function mergeRckGroups(a, b) {
  return uniqueArray([
    ...(a.rckGroups || []),
    a.rckGroup,
    ...(b.rckGroups || []),
    b.rckGroup
  ]);
}

function mergedRckName(race, groups) {
  const location = race.rckLocation || race.venueLocation || race.venueName;
  const seriesName = race.series?.[0] || "RCK";
  return `${seriesName} ${groups.join("/")} - ${location}`;
}

function mergeRckRace(a, b) {
  const rckGroups = mergeRckGroups(a, b);
  const documents = mergeDocuments(a.documents, b.documents);
  const classes = mergeClasses(a.classes, b.classes);

  const registrationCount =
    b.registrationCount !== null && b.registrationCount !== undefined
      ? b.registrationCount
      : a.registrationCount;

  const registrationDisplay =
    b.registrationDisplay ||
    a.registrationDisplay ||
    (registrationCount !== null && registrationCount !== undefined ? String(registrationCount) : null);

  const preferredUrl =
    b.url && b.url !== b.detailUrl
      ? b.url
      : a.url && a.url !== a.detailUrl
        ? a.url
        : b.url || a.url;

  const isOpen = a.registrationStatus === "open" || b.registrationStatus === "open";

  return {
    ...a,
    importerVersion,
    firstSeen: a.firstSeen || b.firstSeen || null,
    lastSeen: a.lastSeen || b.lastSeen || null,
    name: rckGroups.length > 1 ? mergedRckName(a, rckGroups) : a.name,
    sources: uniqueArray([...(a.sources || [a.source]), ...(b.sources || [b.source])]),
    url: preferredUrl,
    registrationStatus: isOpen ? "open" : "upcoming",
    note: isOpen ? null : "Nennung folgt.",
    comingSoon: !isOpen && (a.comingSoon || b.comingSoon),
    registrationCount,
    registrationDisplay,
    rckGroups,
    classes,
    documents: documents,
    organizerName: b.organizerName || a.organizerName || null,
    hostId: b.hostId || a.hostId || b.venueId || a.venueId || null,
    hostName: b.hostName || a.hostName || b.organizerName || a.organizerName || b.venueName || a.venueName || null,
    venueWebsite: b.venueWebsite || a.venueWebsite || null,
    venueAddress: b.venueAddress || a.venueAddress || null,
    venueCity: b.venueCity || a.venueCity || null,
    venuePostalCode: b.venuePostalCode || a.venuePostalCode || null,
    addressVerifiedFromPdf: Boolean(a.addressVerifiedFromPdf || b.addressVerifiedFromPdf),
    pdfVenueData: b.pdfVenueData || a.pdfVenueData || null
  };
}

function rckInternalKey(race) {
  const venueKey = race.venueId || normalizeRckLocation(race.rckLocation);
  return [race.from, race.rckSeries, venueKey].join("|");
}

function mergeRckInternally(races) {
  const grouped = new Map();

  for (const race of races) {
    const key = rckInternalKey(race);
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, race);
      continue;
    }

    grouped.set(key, mergeRckRace(existing, race));
  }

  return Array.from(grouped.values());
}

function stripTransientRaceFields(race) {
  const { pdfVenueData, ...cleanRace } = race;
  return cleanRace;
}

function hasPdfDocument(race) {
  return Array.isArray(race.documents) && race.documents.some(document => document?.url);
}

function applySeenDates(races, existingRckRaces) {
  const today = new Date().toISOString().slice(0, 10);
  const existingById = new Map(
    existingRckRaces
      .filter(race => race?.id)
      .map(race => [race.id, race])
  );

  return races.map(race => {
    const existing = existingById.get(race.id);

    const cleanRace = stripTransientRaceFields(race);

    return {
      ...cleanRace,
      hostId: cleanRace.hostId || cleanRace.venueId,
      hostName: cleanRace.hostName || cleanRace.organizerName || cleanRace.venueName || cleanRace.venueId,
      firstSeen: existing?.firstSeen || today,
      lastSeen: today
    };
  });
}

async function main() {
  const venues = await readJsonIfExists(venuesFile, []);
  const existingRckRaces = await readJsonIfExists(outputFile, []);

  const importedRaces = [];

  for (const source of sources) {
    console.log(`Lade RCK: ${source.seriesLabel}`);

    let html;

    try {
      html = await fetchText(source.url);
    } catch (error) {
      console.warn(`  RCK-Quelle konnte nicht geladen werden: ${source.url}`);
      console.warn(`    ${error.message}`);
      continue;
    }

    const rawRaces = extractRacesFromTable(html, source, venues);
    const races = rawRaces.filter(hasPdfDocument);

    console.log(`  ${rawRaces.length} RCK-Termine gefunden`);
    console.log(`  ${races.length} RCK-Termine mit PDF-Ausschreibung werden importiert`);
    console.log(`  ${rawRaces.length - races.length} RCK-Termine ohne PDF werden ignoriert`);

    for (let index = 0; index < races.length; index += 1) {
      if ((index + 1) % 5 === 0 || index + 1 === races.length) {
        console.log(`  ${index + 1}/${races.length} RCK-Termine angereichert`);
      }

      const withRegistration = await enrichFromRegistrationPage(races[index]);
      const withPdf = await enrichFromPdf(withRegistration);
      importedRaces.push(withPdf);
    }
  }

  const internallyMerged = mergeRckInternally(importedRaces)
    .sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));

  const venueCandidates = await buildVenueCandidates(internallyMerged, venues);

  const cleanedRaces = applySeenDates(internallyMerged, existingRckRaces);

  const unmatchedVenues = cleanedRaces
    .filter(race => race.venueStatus === "standort nicht verifiziert")
    .map(race => ({
      venueId: race.venueId,
      rckSeries: race.rckSeries,
      rckLocation: race.rckLocation,
      venueName: race.venueName,
      hostId: race.hostId || null,
      hostName: race.hostName || null,
      venueAddress: race.venueAddress || null,
      venueCity: race.venueCity || race.venueLocation || null,
      venuePostalCode: race.venuePostalCode || null,
      organizerName: race.organizerName || null,
      venueWebsite: race.venueWebsite || null,
      addressVerifiedFromPdf: Boolean(race.addressVerifiedFromPdf),
      raceId: race.id,
      raceName: race.name,
      from: race.from,
      firstSeen: race.firstSeen || null,
      lastSeen: race.lastSeen || null,
      documents: race.documents || []
    }));

  await writeFile(outputFile, JSON.stringify(cleanedRaces, null, 2) + "\n", "utf8");
  await writeFile(unmatchedVenuesFile, JSON.stringify(unmatchedVenues, null, 2) + "\n", "utf8");
  await writeFile(venueCandidatesFile, JSON.stringify(venueCandidates, null, 2) + "\n", "utf8");

  console.log(`Importer: ${importerVersion}`);
  console.log(`RCK Rennen geschrieben: ${cleanedRaces.length} -> ${outputFile}`);
  console.log(`RCK Venue-Kandidaten geschrieben: ${venueCandidates.length} -> ${venueCandidatesFile}`);
  console.log(`RCK ungematchte Venues geschrieben: ${unmatchedVenues.length} -> ${unmatchedVenuesFile}`);
  console.log(`RCK rohe Termine mit PDF: ${importedRaces.length}`);
  console.log(`RCK intern zusammengeführt: ${internallyMerged.length}`);
  console.log(`Geocoding: ${geocodeEnabled ? "aktiv" : "deaktiviert"}`);
  console.log(`Bestehende RCK-Rennen gelesen: ${existingRckRaces.length}`);
}
main().catch(error => {
  console.error(error);
  process.exit(1);
});
