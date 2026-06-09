const app = document.getElementById("app");
const raceList = document.getElementById("raceList");
const resultLine = document.getElementById("resultLine");
const searchInput = document.getElementById("searchInput");
const seriesFilter = document.getElementById("seriesFilter");
const rangeFilter = document.getElementById("rangeFilter");
const mapWideButton = document.getElementById("mapWideButton");
const listWideButton = document.getElementById("listWideButton");
const filterToggleButton = document.getElementById("filterToggleButton");
const activeFilterChips = document.getElementById("activeFilterChips");
const registrationVisibilityFilter = document.getElementById("registrationVisibilityFilter");

const map = L.map("map", {
  scrollWheelZoom: true,
  zoomControl: false,
  minZoom: 6
}).setView([51.8, 11.8], 6);

map.setMaxBounds([
  [44.0, -5.0],
  [59.0, 25.0]
]);

L.control.zoom({
  position: "bottomleft"
}).addTo(map);

L.tileLayer(
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }
).addTo(map);

let venues = [];
let races = [];
let hosts = [];
let hostsByOrgId = new Map();
let markers = new Map();
let activeRaceId = null;
let activeVenueId = null;
let pinnedVenueId = null;
let isSwitchingMarkerPopup = false;
let selectedRange = "2";
let selectedSeries = "all";
let showOpenOnly = true;
let isFilterPanelOpen = false;
const expandedClassRaceIds = new Set();

const favoriteVenueStorageKey = "rcRaceMapFavoriteVenueIds";

function getFavoriteVenueIds() {
  try {
    const raw = localStorage.getItem(favoriteVenueStorageKey);
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean).map(String);
  } catch {
    return [];
  }
}

function saveFavoriteVenueIds(ids) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean).map(String))];
  localStorage.setItem(favoriteVenueStorageKey, JSON.stringify(uniqueIds));
}

function isFavoriteVenueId(venueId) {
  if (!venueId) return false;
  return getFavoriteVenueIds().includes(String(venueId));
}

function toggleFavoriteVenue(venueId) {
  if (!venueId) return;

  const id = String(venueId);
  const favoriteIds = getFavoriteVenueIds();

  if (favoriteIds.includes(id)) {
    saveFavoriteVenueIds(favoriteIds.filter(item => item !== id));
  } else {
    saveFavoriteVenueIds([...favoriteIds, id]);
  }
}

function favoriteButtonHtml(venueId, label = "Strecke") {
  if (!venueId) return "";

  const active = isFavoriteVenueId(venueId);
  const title = active
    ? `${label} aus Favoriten entfernen`
    : `${label} als Favorit markieren`;

  return `<button
    class="venue-favorite-button${active ? " active" : ""}"
    type="button"
    data-favorite-venue-id="${escapeHtml(venueId)}"
    title="${escapeHtml(title)}"
    aria-label="${escapeHtml(title)}"
    aria-pressed="${active ? "true" : "false"}"
  >${active ? "★" : "☆"}</button>`;
}

function raceFavoriteVenueId(race) {
  const venue = venueById(race?.venueId);
  return venue?.id || null;
}

function isFavoriteRaceVenue(race) {
  return isFavoriteVenueId(raceFavoriteVenueId(race));
}



function updateAppModeClass() {
  app.classList.toggle("is-venue-mode", Boolean(activeVenueId));
}

function updateFilterPanelState() {
  app.classList.toggle("is-filter-panel-open", isFilterPanelOpen);

  if (!filterToggleButton) return;

  filterToggleButton.setAttribute("aria-expanded", String(isFilterPanelOpen));
  filterToggleButton.setAttribute(
    "aria-label",
    isFilterPanelOpen
      ? "Suche und Serienfilter schließen"
      : "Suche und Serienfilter öffnen"
  );
}

function renderActiveFilterChips() {
  if (!activeFilterChips) return;

  const chips = [];
  const query = searchInput.value.trim();

  if (query) {
    chips.push(`
      <button class="active-filter-chip" type="button" data-clear-filter="search">
        ${query}<span aria-hidden="true">×</span>
      </button>
    `);
  }

  if (selectedSeries !== "all") {
    chips.push(`
      <button class="active-filter-chip" type="button" data-clear-filter="series">
        ${seriesDisplayName(selectedSeries)}<span aria-hidden="true">×</span>
      </button>
    `);
  }


  activeFilterChips.innerHTML = chips.join("");
  activeFilterChips.classList.toggle("is-empty", chips.length === 0);
}

function syncFilterUi() {
  updateFilterPanelState();
  renderActiveFilterChips();
}


const seriesDisplayNames = {
  "BTM": "BTM – Berlin Touring Masters",
  "ETS": "ETS – Euro Touring Series",
  "Ostmasters": "Ostmasters",
  "RCK Challenge": "RCK Challenge",
  "RCK Kleinserie": "RCK Kleinserie",
  "SK": "SK – Sportkreis",
  "Tamico Offroad Cup": "Tamico Offroad Cup",
  "TEC": "TEC – Tamiya Euro Cup",
  "TOS": "TOS – ToniSport Onroad Series"
};

const preferredSeriesOrder = [
  "BTM",
  "ETS",
  "Ostmasters",
  "RCK Challenge",
  "RCK Kleinserie",
  "SK",
  "Tamico Offroad Cup",
  "TEC",
  "TOS"
];


function raceDataSource(race) {
  if (race?.dataSource) return race.dataSource;
  if (race?.source === "rck" || String(race?.source || "").startsWith("rck-")) return "rck";
  if (Array.isArray(race?.sources) && race.sources.some(source => String(source).startsWith("rck-"))) return "rck";
  if (race?.rckSeries) return "rck";
  return "myrcm";
}

function isRckRace(race) {
  return raceDataSource(race) === "rck";
}

function hasPdfDocument(race) {
  return Array.isArray(race?.documents) && race.documents.some(document => document?.url);
}

function isUsefulRckRace(race) {
  if (!isRckRace(race)) return true;
  return hasPdfDocument(race);
}


function isRckEventFromMyRcm(race) {
  const series = raceSeries(race);
  const text = [
    race.name,
    race.title,
    race.eventName,
    race.venueName,
    ...(Array.isArray(race.series) ? race.series : [])
  ].filter(Boolean).join(" ");

  return (
    series.includes("RCK Challenge") ||
    series.includes("RCK Kleinserie") ||
    /\brck\b/i.test(text)
  );
}

function hasLatLng(venue) {
  if (!venue) return false;

  const lat = venue.lat;
  const lng = venue.lng;

  if (lat === null || lat === undefined || lat === "") return false;
  if (lng === null || lng === undefined || lng === "") return false;

  const latNumber = Number(lat);
  const lngNumber = Number(lng);

  return (
    Number.isFinite(latNumber) &&
    Number.isFinite(lngNumber) &&
    latNumber >= 44 &&
    latNumber <= 59 &&
    lngNumber >= -5 &&
    lngNumber <= 25
  );
}

function isUnverifiedVenue(venue) {
  return venue?.verified === false || venue?.verificationStatus === "standort nicht verifiziert";
}

function seriesDisplayName(series) {
  return seriesDisplayNames[series] || series;
}

function classNameFromRaceClass(item) {
  if (!item) return "";
  if (typeof item === "string") return item;
  if (typeof item === "object") return item.name || item.label || "";
  return String(item);
}

function classTagLabel(item) {
  if (!item) return "";
  if (typeof item === "object" && item.name) {
    if (Number.isFinite(item.entries)) return `${item.name} (${item.entries})`;
    return item.name;
  }
  return String(item);
}

function raceEndDate(race) {
  return parseDate(race.to || race.from);
}

function daysBetween(a, b) {
  return Math.floor((a - b) / 86400000);
}

function isPastRaceWithinLastYear(race) {
  const today = todayStart();
  const end = raceEndDate(race);
  const ageInDays = daysBetween(today, end);
  return ageInDays >= 1 && ageInDays <= 365;
}

function matchesSelectedSeries(race) {
  return selectedSeries === "all" || raceSeries(race).includes(selectedSeries);
}


function matchesSearchQuery(race) {
  const query = searchInput.value.trim().toLowerCase();
  return !query || raceSearchText(race).includes(query);
}

function recentPastRacesForVenue(venue) {
  return races
    .filter(race => isRaceAtVenue(race, venue.id))
    .filter(isPastRaceWithinLastYear)
    .filter(matchesSelectedSeries)
    .filter(matchesSearchQuery)
    .sort((a, b) => raceEndDate(b) - raceEndDate(a));
}

function latestPastRaceForVenue(venue) {
  return recentPastRacesForVenue(venue)[0] || null;
}

function parseDate(dateString) {
  return new Date(`${dateString}T00:00:00`);
}

function todayStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatDateRange(from, to) {
  const start = parseDate(from);
  const end = parseDate(to || from);

  const fmt = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });

  const fmtShort = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit"
  });

  if (from === to || !to) return fmt.format(start);

  if (start.getFullYear() === end.getFullYear()) {
    return `${fmtShort.format(start)}–${fmt.format(end)}`;
  }

  return `${fmt.format(start)}–${fmt.format(end)}`;
}

function formatDate(dateString) {
  if (!dateString) return "";

  const date = parseDate(dateString);

  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatShortDate(dateString) {
  if (!dateString) return "";

  const date = parseDate(dateString);

  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
  }).format(date);
}

function isNewRace(race) {
  if (!race.firstSeen) return false;

  const firstSeen = parseDate(race.firstSeen);
  const today = todayStart();
  const ageInDays = Math.floor((today - firstSeen) / 86400000);

  return ageInDays >= 0 && ageInDays <= 7;
}

function newRaceBadgeHtml(race) {
  if (!isNewRace(race)) return "";

  const firstSeen = parseDate(race.firstSeen);
  const today = todayStart();
  const ageInDays = Math.floor((today - firstSeen) / 86400000);

  let badgeClass = "race-new-badge-older";

  if (ageInDays === 0) {
    badgeClass = "race-new-badge-today";
  } else if (ageInDays === 1) {
    badgeClass = "race-new-badge-yesterday";
  } else if (ageInDays === 2) {
    badgeClass = "race-new-badge-two-days";
  }

  return `<div class="race-new-badge ${badgeClass}">NEU ${formatShortDate(race.firstSeen)}</div>`;
}

function registrationStatus(race) {
  if (race.registrationStatus) return race.registrationStatus;
  if (race.registrationRequiresLogin) return "login_required";
  return "open";
}

function isRegistrationActive(race) {
  const status = registrationStatus(race);
  return status === "open" || status === "login_required";
}

function matchesRegistrationVisibility(race) {
  if (!showOpenOnly) return true;
  return isRegistrationActive(race);
}

function registrationLabel(race) {
  const status = registrationStatus(race);

  if (status === "login_required") {
    return "Anmeldung nur nach MyRCM-Login sichtbar";
  }

  if (status === "upcoming") {
    return race.registrationOpens
      ? `Nennung ab ${formatDate(race.registrationOpens)}`
      : "Nennung noch nicht geöffnet";
  }

  if (status === "closed") {
    return "Nennung geschlossen";
  }

  return "Nennung möglich";
}

function registrationDotHtml(race) {
  const status = registrationStatus(race);

  if (status === "closed") {
    return `<span class="registration-dot registration-dot-closed" aria-hidden="true"></span>`;
  }

  if (status === "upcoming") {
    return `<span class="registration-dot registration-dot-upcoming" aria-hidden="true"></span>`;
  }

  if (status === "login_required") {
    return `<span class="registration-dot registration-dot-login_required" aria-hidden="true"></span>`;
  }

  return `<span class="registration-dot registration-dot-open" aria-hidden="true"></span>`;
}

function registrationLinkHtml(race) {
  const status = registrationStatus(race);

  if (!race.url) return "";

  if (status === "closed") return "";

  return `<a class="race-link race-link-with-status registration-${status}" href="${race.url}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">${registrationDotHtml(race)}MyRCM öffnen ↗</a>`;
}

function registrationStatusHtml(race) {
  const status = registrationStatus(race);

  if (status === "open") return "";

  if (status === "closed") {
    return `<div class="registration-status registration-status-closed">
      ${registrationDotHtml(race)}Nennung geschlossen
    </div>`;
  }

  if (status === "upcoming") {
    return `<div class="registration-status registration-status-upcoming">
      Nennung ab ${race.registrationOpens ? formatDate(race.registrationOpens) : "noch nicht geöffnet"}
    </div>`;
  }

  if (status === "login_required") {
    return `<div class="registration-status registration-status-login_required">
      Anmeldung nur nach MyRCM-Login sichtbar
    </div>`;
  }

  return "";
}


function statusDetailsHtml(race) {
  return "";
}

function hasActiveRegistration(venueRaces) {
  return venueRaces.some(isRegistrationActive);
}

function registrationCount(race) {
  const candidates = [
    race.registrationCount,
    race.registrationsCount,
    race.registrations,
    race.entryCount,
    race.entries,
    race.participantCount,
    race.participants,
    race.nominationCount,
    race.nominations,
    race.count
  ];

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;

    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return Math.max(0, candidate);
    }

    if (typeof candidate === "string") {
      const match = candidate.replace(/\./g, "").match(/\d+/);
      if (match) return Math.max(0, Number(match[0]));
    }

    if (Array.isArray(candidate)) {
      return candidate.length;
    }
  }

  return 0;
}

function hasRegistrationCount(race) {
  const candidates = [
    race.registrationCount,
    race.registrationsCount,
    race.registrations,
    race.entryCount,
    race.entries,
    race.participantCount,
    race.participants,
    race.nominationCount,
    race.nominations,
    race.count
  ];

  return candidates.some(candidate => {
    if (candidate === null || candidate === undefined || candidate === "") return false;
    if (typeof candidate === "number") return Number.isFinite(candidate);
    if (typeof candidate === "string") return /\d+/.test(candidate);
    if (Array.isArray(candidate)) return true;
    return false;
  });
}

function registrationCountHtml(race) {
  const display =
    race.registrationDisplay ||
    (hasRegistrationCount(race) ? String(registrationCount(race)) : null);

  if (!display) return "";

  const participantUrl =
    race.registrationListUrl ||
    race.url;

  const content = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="7.4" r="4.1"></circle>
      <path d="M4.5 21c0-4.4 3.2-7.5 7.5-7.5s7.5 3.1 7.5 7.5"></path>
    </svg>
    <span class="registration-count-value">${display}<span class="external-arrow">↗</span></span>
  `;

  if (participantUrl) {
    return `<a
      class="race-registration-count race-registration-count-link"
      href="${escapeHtml(participantUrl)}"
      target="_blank"
      rel="noopener"
      title="Teilnehmer anzeigen"
      aria-label="Teilnehmer anzeigen: ${escapeHtml(display)} Nennungen"
      onclick="event.stopPropagation()"
    >${content}</a>`;
  }

  return `<div class="race-registration-count" aria-label="${escapeHtml(display)} Nennungen">
    ${content}
  </div>`;
}

function venueRegistrationCount(venueRaces) {
  return venueRaces.reduce((sum, race) => sum + registrationCount(race), 0);
}

function markerScaleForRegistrationCount(count) {
  if (!count) return 0.6;
  if (count < 5) return 0.6;
  if (count < 10) return 0.75;
  if (count < 20) return 0.95;
  if (count < 40) return 1.15;
  if (count < 70) return 1.35;
  if (count < 120) return 1.55;
  return 1.75;
}

function markerColorForRegistrationCount(count) {
  if (count >= 120) return "#1f5f34";
  if (count >= 70) return "#2d7040";
  if (count >= 40) return "#3f7f49";
  if (count >= 20) return "#4F8A57";
  if (count >= 10) return "#5f9664";
  return "#6fa875";
}

function markerFavoriteColorForRegistrationCount(count) {
  if (count >= 120) return "#8a5f00";
  if (count >= 70) return "#a17100";
  if (count >= 40) return "#b88416";
  if (count >= 20) return "#c9972b";
  if (count >= 10) return "#d8aa42";
  return "#e0b65a";
}

function ensureRegistrationStatusStyles() {
  if (document.getElementById("registration-status-styles")) return;

  const style = document.createElement("style");
  style.id = "registration-status-styles";
  style.textContent = `
    .race-card.registration-upcoming {
      background: rgba(247, 243, 236, 0.96);
      border-color: rgba(222, 214, 202, 0.75);
    }

    .race-card.registration-closed {
      background: rgba(244, 240, 233, 0.94);
      border-color: rgba(222, 214, 202, 0.7);
    }

    .race-card.registration-closed .race-date,
    .race-card.registration-closed .race-name,
    .race-card.registration-closed .race-venue,
    .race-card.registration-closed .tag {
      color: rgba(31, 29, 26, 0.58);
    }

    .race-link,
    .popup-title a {
      transition: color 0.16s ease, text-decoration-color 0.16s ease, background 0.16s ease;
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
    }

    .race-link:hover,
    .race-link:focus-visible,
    .popup-title a:hover,
    .popup-title a:focus-visible {
      text-decoration: underline;
    }

    .race-link-with-status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }

    .registration-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 999px;
      flex: 0 0 auto;
      background: #77716a;
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
    }

    .registration-dot-open {
      background: #2f8f46;
    }

    .registration-dot-upcoming {
      background: #d9a441;
    }

    .registration-dot-login_required {
      background: #d9a441;
    }

    .registration-dot-closed {
      background: #4f4a44;
    }

    .registration-status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      width: fit-content;
      margin-top: 6px;
      font-size: 13px;
      line-height: 1.25;
      color: var(--muted, #6f6a62);
    }

    .registration-status-closed {
      color: #4f4a44;
      font-weight: 700;
    }


    .race-card.flash {
      animation: race-card-flash 1.2s ease;
    }

    @keyframes race-card-flash {
      0% {
        box-shadow: 0 0 0 0 rgba(217, 164, 65, 0.0);
      }

      25% {
        box-shadow: 0 0 0 4px rgba(217, 164, 65, 0.35);
      }

      100% {
        box-shadow: 0 0 0 0 rgba(217, 164, 65, 0.0);
      }
    }

    .map-marker-switcher {
      position: relative;
      display: block;
      cursor: pointer;
      pointer-events: auto;
    }

    .map-marker-switcher .map-marker-open,
    .map-marker-switcher .map-marker-closed {
      position: absolute;
      left: 0;
      top: 0;
    }

    .map-marker-open,
    .map-marker-closed,
    .map-marker-venue-inactive {
      cursor: pointer;
      pointer-events: auto;
    }

    .map-marker-open *,
    .map-marker-closed *,
    .map-marker-venue-inactive * {
      pointer-events: none;
    }

    .map-marker-active-replacement {
      display: none;
      position: absolute;
      left: 50%;
      top: 100%;
      transform: translate(-50%, -88%);
      z-index: 2;
    }

    .map-marker-active-replacement-open {
      background: #5f8f5f !important;
    }

    .map-marker-active-replacement-closed {
      background: rgba(31, 29, 26, 0.45) !important;
    }

    .marker-popup-active .map-marker-switcher .map-marker-open,
    .marker-popup-active .map-marker-switcher .map-marker-closed {
      opacity: 0;
    }

    .marker-popup-active .map-marker-active-replacement {
      display: block;
    }

    .map-marker-venue-inactive {
      cursor: pointer;
      pointer-events: auto;
    }

    .map-marker-venue-inactive {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      background: rgba(31, 29, 26, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.9);
      box-sizing: border-box;
      box-shadow: none;
    }

    .map-marker-venue-inactive-favorite {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      background: #b88416;
      border: 1px solid rgba(255, 255, 255, 0.9);
      box-sizing: border-box;
      box-shadow: none;
    }

    .popup-last-race {
      margin-top: 8px;
      color: var(--muted, #6f6a62);
      font-size: 12px;
      line-height: 1.35;
    }

    .popup-last-race strong {
      color: var(--ink, #1f1d1a);
      font-weight: 700;
    }

    .popup-race-static {
      display: block;
      padding: 8px 0;
    }

    .popup-race-date {
      display: block;
      font-weight: 700;
    }

    .popup-race-name {
      display: block;
    }

    .popup-registration-status {
      margin-top: 4px;
      font-size: 12px;
      color: var(--muted, #6f6a62);
    }
  `;

  document.head.appendChild(style);
}


function detectSeries(name) {
  const rules = [
    { label: "BTM", re: /berlin touring masters|\bbtm\b/i },
    { label: "ETS", re: /euro touring series|\bets\b/i },
    { label: "Ostmasters", re: /ostmasters/i },
    { label: "RCK Challenge", re: /rck challenge/i },
    { label: "RCK Kleinserie", re: /rck kleinserie/i },
    { label: "SK", re: /\bsk[- ]?lauf\b|sk lauf|sportkreis/i },
    { label: "Tamico Offroad Cup", re: /tamico offroad cup|tamico/i },
    { label: "TEC", re: /tamiya euro cup|\btec\b/i },
    { label: "TOS", re: /tonisport onroad series|\btos\b/i }
  ];

  return rules
    .filter(rule => rule.re.test(name))
    .map(rule => rule.label);
}

function raceSeries(race) {
  if (Array.isArray(race.series) && race.series.length) return race.series;
  return detectSeries(race.name);
}

function venueIdsForMatching(venue) {
  return [
    venue?.id,
    ...(Array.isArray(venue?.aliases) ? venue.aliases : [])
  ]
    .filter(Boolean)
    .map(String);
}

function venueById(id) {
  if (!id) return null;

  const lookupId = String(id);

  return venues.find(venue => {
    return venueIdsForMatching(venue).some(matchId =>
      lookupId === matchId || lookupId.startsWith(`${matchId}-`)
    );
  }) || null;
}

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return null;
  return url.trim() || null;
}

function orgIdFromValue(value) {
  if (!value || typeof value !== "string") return null;

  const decoded = decodeURIComponent(value);

  let match = decoded.match(/myrcm-(\d+)/i);
  if (match) return match[1];

  match = decoded.match(/dId\[O\]=(\d+)/i);
  if (match) return match[1];

  match = decoded.match(/dId%5BO%5D=(\d+)/i);
  if (match) return match[1];

  return null;
}

function orgIdsForVenue(venue) {
  if (!venue) return [];

  const ids = new Set();

  const directOrgId =
    orgIdFromValue(venue.id) ||
    orgIdFromValue(venue.venueId) ||
    orgIdFromValue(venue.url) ||
    orgIdFromValue(venue.myrcmUrl);

  if (directOrgId) ids.add(directOrgId);

  return [...ids];
}

function hostWebsiteByOrgId(orgId) {
  if (!orgId) return null;
  return normalizeUrl(hostsByOrgId.get(String(orgId))?.website);
}

function venueWebsite(venue) {
  const directWebsite = normalizeUrl(venue?.website);
  if (directWebsite) return directWebsite;

  for (const orgId of orgIdsForVenue(venue)) {
    const website = hostWebsiteByOrgId(orgId);
    if (website) return website;
  }

  return null;
}

function raceWebsite(race) {
  const venue = venueById(race.venueId);

  const venueLink = venueWebsite(venue);
  if (venueLink) return venueLink;

  const raceOrgId =
    orgIdFromValue(race.venueId) ||
    orgIdFromValue(race.url) ||
    orgIdFromValue(race.myrcmUrl);

  return hostWebsiteByOrgId(raceOrgId);
}

function venueNameHtml(venue) {
  const website = venueWebsite(venue);
  const name = escapeHtml(venue?.name || "Unbekannte Strecke");
  const nameHtml = website
    ? `<a class="venue-link" href="${escapeHtml(website)}" target="_blank" rel="noreferrer">${name}</a>`
    : `<span class="venue-link">${name}</span>`;

  return `<span class="venue-name">${nameHtml}</span>`;
}

function raceVenueNameHtml(race) {
  const name = escapeHtml(venueDisplayName(race));
  const website = raceWebsite(race);
  const venueId = raceFavoriteVenueId(race);
  const favorite = favoriteButtonHtml(venueId, venueDisplayName(race));
  const favoriteClass = isFavoriteVenueId(venueId) ? " venue-link-favorite" : "";
  const nameHtml = website
    ? `<a class="venue-link${favoriteClass}" href="${escapeHtml(website)}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">${name}</a>`
    : `<span class="venue-link${favoriteClass}">${name}</span>`;

  return `<span class="venue-name-with-favorite${favoriteClass ? " is-favorite" : ""}">${favorite}${nameHtml}</span>`;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function documentRole(document = {}, index = 0, documents = []) {
  const text = [
    document.type,
    document.label,
    document.sourceLabel,
    document.fileName,
    document.url
  ].filter(Boolean).join(" ").toLowerCase();

  if (
    document.type === "announcement" ||
    text.includes("ausschreibung") ||
    text.includes("announcement") ||
    text.includes("invitation")
  ) {
    return "announcement";
  }

  if (
    document.type === "rules" ||
    text.includes("reglement") ||
    text.includes("regel") ||
    text.includes("rules") ||
    text.includes("technical")
  ) {
    return "rules";
  }

  if (
    document.type === "schedule" ||
    text.includes("zeitplan") ||
    text.includes("schedule") ||
    text.includes("timetable") ||
    text.includes("ablauf")
  ) {
    return "schedule";
  }

  const unknownDocuments = documents.filter(item => {
    const itemText = [item.type, item.label, item.sourceLabel, item.fileName, item.url]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return !itemText.includes("ausschreibung") &&
      !itemText.includes("announcement") &&
      !itemText.includes("invitation") &&
      !itemText.includes("tender") &&
      !itemText.includes("reglement") &&
      !itemText.includes("regel") &&
      !itemText.includes("rules") &&
      !itemText.includes("rule") &&
      !itemText.includes("technical");
  });

  /*
    Some MyRCM PDFs arrive only as type "document" with label "PDF".
    MyRCM often lists these as:
    Rule first, Tender second.
    For those ambiguous pairs we keep both links by mapping:
    first unknown PDF  -> Reglement
    second unknown PDF -> Ausschreibung
  */
  if (unknownDocuments.length > 1) {
    const unknownIndex = unknownDocuments.indexOf(document);
    if (unknownIndex === 0) return "rules";
    if (unknownIndex === 1) return "announcement";
  }

  if (
    text.includes("lauf") ||
    text.includes("cup") ||
    text.includes("rennen") ||
    /\d{2}\.\d{2}\.\d{4}/.test(text) ||
    /\d{4}-\d{2}-\d{2}/.test(text)
  ) {
    return "announcement";
  }

  return "announcement";
}

function rckEntryListUrl(race) {
  return race.entryListUrl || race.nennlisteUrl || race.nominationListUrl || race.registrationListUrl || null;
}

function documentLinksHtml(race) {
  const documents = Array.isArray(race.documents) ? race.documents : [];

  const announcement = documents.find((document, index) =>
    document?.url && documentRole(document, index, documents) === "announcement"
  );

  const rules = documents.find((document, index) =>
    document?.url && documentRole(document, index, documents) === "rules"
  );

  const status = registrationStatus(race);

  let registrationItem = "";

  if (status === "closed") {
    registrationItem = `<span class="race-link-item race-link-item-status race-link-item-status-closed">
        <span class="race-document-dot race-document-dot-closed" aria-hidden="true"></span>
        Nennung geschlossen
      </span>`;
  } else if (status === "upcoming") {
    registrationItem = `<span class="race-link-item race-link-item-status race-link-item-status-upcoming">
        <span class="race-document-dot race-document-dot-upcoming" aria-hidden="true"></span>
        ${race.note || (race.registrationOpens ? `Nennung ab ${formatDate(race.registrationOpens)}` : "Nennung folgt")}
      </span>`;
  } else if (race.url) {
    registrationItem = `<a class="race-link-item race-link-item-status" href="${escapeHtml(race.url)}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">
        <span class="race-document-dot race-document-dot-open" aria-hidden="true"></span>
        Nennung ↗
      </a>`;
  }

  const documentItems = [];

  if (announcement?.url) {
    documentItems.push(`<a class="race-link-item" href="${escapeHtml(announcement.url)}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">Ausschreibung ↗</a>`);
  }

  if (rules?.url && rules.url !== announcement?.url) {
    documentItems.push(`<a class="race-link-item" href="${escapeHtml(rules.url)}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">Reglement ↗</a>`);
  }

  return `<div class="race-document-links" aria-label="Nennung und Dokumente">${registrationItem}${documentItems.join("")}</div>`;
}

function hasMappableVenue(race) {
  const venue = venueById(race.venueId);
  return Boolean(venue && hasLatLng(venue));
}

function hasVerifiedVenue(race) {
  const venue = venueById(race.venueId);
  return Boolean(venue && hasLatLng(venue) && !isUnverifiedVenue(venue));
}

function venueDisplayName(race) {
  const venue = venueById(race.venueId);

  return (
    venue?.name ||
    race.venueName ||
    race.venueLocation ||
    race.venueId ||
    "Unbekannte Strecke"
  );
}

function raceSearchText(race) {
  const venue = venueById(race.venueId);

  return [
    race.name,
    race.venueName,
    race.venueLocation,
    race.venueId,
    venue?.name,
    venue?.city,
    venue?.location,
    ...(raceSeries(race) || []),
    ...(Array.isArray(race.classes) ? race.classes.map(classNameFromRaceClass) : [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isRaceAtVenue(race, venueId) {
  if (!race.venueId || !venueId) return false;

  const venue = venueById(venueId);
  if (!venue) return false;

  const raceVenueId = String(race.venueId);

  return venueIdsForMatching(venue).some(matchId =>
    raceVenueId === matchId || raceVenueId.startsWith(`${matchId}-`)
  );
}

function isInSelectedRange(race) {
  const start = parseDate(race.from);
  const today = todayStart();

  if (start < today) return false;

if (selectedRange === "all") {
  return true;
}

  const weeks = Number(selectedRange);
  return start <= addDays(today, weeks * 7);
}

function filteredRaces() {
  const query = searchInput.value.trim().toLowerCase();

  return races
    .filter(isUsefulRckRace)
    .filter(isInSelectedRange)
    .filter(matchesRegistrationVisibility)
    .filter(matchesSelectedSeries)
    .filter(race => !query || raceSearchText(race).includes(query))
    .sort((a, b) => {
      const favoriteOrder = Number(isFavoriteRaceVenue(b)) - Number(isFavoriteRaceVenue(a));
      if (favoriteOrder !== 0) return favoriteOrder;
      return a.from.localeCompare(b.from) || a.name.localeCompare(b.name);
    });
}

function googleMapsRouteUrl(venue) {
  if (!hasLatLng(venue)) return "#";
  return `https://www.google.com/maps/dir/?api=1&destination=${Number(venue.lat)},${Number(venue.lng)}`;
}

function buildPopup(venue, venueRaces, latestPastRace = null) {
  const raceLine = venueRaces.length
    ? `${venueRaces.length} ${venueRaces.length === 1 ? "Rennen" : "Rennen"}`
    : "Keine kommenden Rennen";

  const lastRaceHtml =
    !venueRaces.length && latestPastRace
      ? `<div class="popup-last-race">
          Zuletzt:<br>
          <strong>${formatDateRange(latestPastRace.from, latestPastRace.to)}</strong><br>
          ${escapeHtml(latestPastRace.name)}
        </div>`
      : "";

  return `
    <div class="popup-title">${venueNameHtml(venue)}</div>
    <div class="popup-race">
      ${raceLine}
    </div>
    ${lastRaceHtml}
    <div class="popup-race">
      <a href="${googleMapsRouteUrl(venue)}" target="_blank" rel="noreferrer">
        Route planen ↗
      </a>
    </div>
  `;
}

function resetVenueSelection() {
  if (!activeVenueId && !activeRaceId) return;

  pinnedVenueId = null;
  activeVenueId = null;
  activeRaceId = null;
  updateAppModeClass();
  renderList(filteredRaces());
}

function updateMarkers(list, shouldFitBounds = true) {
  markers.forEach(marker => marker.remove());
  markers.clear();

  const bounds = [];

  venues.forEach(venue => {
    if (!hasLatLng(venue)) return;

    const venueRaces = list.filter(race => isRaceAtVenue(race, venue.id));
    const latestPastRace = latestPastRaceForVenue(venue);

    if (!venueRaces.length && !latestPastRace) return;

    const hasUpcomingRaces = venueRaces.length > 0;
    const markerClass = hasUpcomingRaces
      ? (hasActiveRegistration(venueRaces) ? "map-marker-open" : "map-marker-closed")
      : "map-marker-venue-inactive";

    const registrationTotal = venueRegistrationCount(venueRaces);
    const markerScale = hasUpcomingRaces
      ? markerScaleForRegistrationCount(registrationTotal)
      : 1;

    const markerWidth = hasUpcomingRaces ? Math.round(26 * markerScale) : 12;
    const markerHeight = hasUpcomingRaces ? Math.round(34 * markerScale) : 12;

    const markerAnchor = hasUpcomingRaces
      ? [Math.round(markerWidth / 2), markerHeight]
      : [Math.round(markerWidth / 2), Math.round(markerHeight / 2)];

    const replacementClass = hasActiveRegistration(venueRaces)
      ? "map-marker-active-replacement-open"
      : "map-marker-active-replacement-closed";

    const isFavoriteVenue = isFavoriteVenueId(venue.id);

let markerColor = isFavoriteVenue
  ? markerFavoriteColorForRegistrationCount(registrationTotal)
  : hasActiveRegistration(venueRaces)
    ? markerColorForRegistrationCount(registrationTotal)
    : "rgba(31, 29, 26, 0.55)";

if (!hasUpcomingRaces && isFavoriteVenue) {
  markerColor = "#b88416";
}

const markerSvg = encodeURIComponent(`
  <svg width="${markerWidth}" height="${markerHeight}" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">
    <path d="M13 33C13 33 25 20.5 25 12.8C25 5.7 19.6 1 13 1C6.4 1 1 5.7 1 12.8C1 20.5 13 33 13 33Z" fill="${markerColor}" stroke="#F4F1EC" stroke-width="1"/>
  </svg>
`);

const inactiveClass = isFavoriteVenue
  ? "map-marker-venue-inactive-favorite"
  : "map-marker-venue-inactive";

const markerHtml = hasUpcomingRaces
  ? `<div class="map-marker-switcher map-marker-visual" style="width: ${markerWidth}px; height: ${markerHeight}px; --marker-delay: 0ms;">
      <div class="${markerClass}" style="width: ${markerWidth}px; height: ${markerHeight}px; background-image: url('data:image/svg+xml,${markerSvg}');"></div>
      <div class="map-marker-venue-inactive map-marker-active-replacement ${replacementClass}" style="background: ${markerColor} !important;"></div>
    </div>`
  : `<div class="${inactiveClass} map-marker-visual" style="--marker-delay: 0ms;"></div>`;

    const marker = L.marker(
      [venue.lat, venue.lng],
      {
        icon: L.divIcon({
          className: "",
          html: markerHtml,
          iconSize: [markerWidth, markerHeight],
          iconAnchor: markerAnchor
        })
      }
    ).addTo(map);


    let hoverTimer = null;
    let isPopupPinned = false;
    
const popupOffset = hasUpcomingRaces
  ? [0, -8]
  : [0, -4];

    marker.bindPopup(
      buildPopup(venue, venueRaces, latestPastRace),
      {
        offset: popupOffset
      }
    );

    marker.on("mouseover", () => {
      if (window.matchMedia("(pointer: coarse)").matches) return;

      if (pinnedVenueId && pinnedVenueId !== venue.id) return;

      clearTimeout(hoverTimer);

      if (!isPopupPinned) {
        marker.openPopup();
      }
    });

    marker.on("mouseout", () => {
      if (window.matchMedia("(pointer: coarse)").matches) return;

      if (pinnedVenueId && pinnedVenueId !== venue.id) return;

      clearTimeout(hoverTimer);

      hoverTimer = window.setTimeout(() => {
        if (!isPopupPinned) {
          marker.closePopup();
        }
      }, 350);
    });

    marker.on("popupopen", () => {

      marker.getElement()?.classList.add("marker-popup-active");
      
      const popupElement = marker.getPopup()?.getElement();
      if (!popupElement) return;

      popupElement.addEventListener("mouseenter", () => {
        clearTimeout(hoverTimer);
      });

      popupElement.addEventListener("mouseleave", () => {
        if (window.matchMedia("(pointer: coarse)").matches) return;
        if (isPopupPinned) return;
        if (pinnedVenueId && pinnedVenueId !== venue.id) return;

        clearTimeout(hoverTimer);
        hoverTimer = window.setTimeout(() => {
          marker.closePopup();
        }, 150);
      });

      popupElement.addEventListener("click", event => {
        if (
          event.target.closest("a") ||
          event.target.closest(".leaflet-popup-close-button")
        ) {
          return;
        }

        isPopupPinned = true;
        pinnedVenueId = venue.id;
        activeVenueId = venue.id;
        activeRaceId = null;
        updateAppModeClass();

        if (hasUpcomingRaces) {
          renderList(venueRaces);
          resultLine.textContent = `${venueRaces.length} ${venueRaces.length === 1 ? "Rennen" : "Rennen"} an dieser Strecke`;
        } else {
          renderList([]);
          resultLine.textContent = "Keine kommenden Rennen an dieser Strecke";
        }
      });
    });
    
    marker.on("popupclose", () => {

      marker.getElement()?.classList.remove("marker-popup-active");
      
      if (isSwitchingMarkerPopup) return;

      isPopupPinned = false;

      if (activeVenueId === venue.id && pinnedVenueId !== venue.id) {
        resetVenueSelection();
      }
    });

    marker.on("click", event => {
      if (event.originalEvent) {
        L.DomEvent.stopPropagation(event.originalEvent);
      }

      isSwitchingMarkerPopup = true;
      isPopupPinned = true;
      markers.forEach(otherMarker => {
        if (otherMarker !== marker) {
          otherMarker.closePopup();
        }
      });

      pinnedVenueId = venue.id;
      activeVenueId = venue.id;
      activeRaceId = null;
      updateAppModeClass();

      if (hasUpcomingRaces) {
        renderList(venueRaces);
        resultLine.textContent = `${venueRaces.length} ${venueRaces.length === 1 ? "Rennen" : "Rennen"} an dieser Strecke`;
      } else {
        renderList([]);
        resultLine.textContent = "Keine kommenden Rennen an dieser Strecke";
      }

      marker.setPopupContent(buildPopup(venue, venueRaces, latestPastRace));
      marker.openPopup();

      window.setTimeout(() => {
        isSwitchingMarkerPopup = false;
      }, 0);
    });

    markers.set(venue.id, marker);
    bounds.push([venue.lat, venue.lng]);
  });

  if (bounds.length === 1) {
    map.setView(bounds[0], 12);
  }

if (shouldFitBounds && bounds.length > 1) {
  const isMobile = window.matchMedia("(max-width: 860px)").matches;

  map.fitBounds(bounds, isMobile
    ? {
        paddingTopLeft: [32, 120],
        paddingBottomRight: [32, 360]
      }
    : {
        paddingTopLeft: [40, 40],
        paddingBottomRight: [180, 40]
      }
  );
}
}

function scrollToRaceCard(raceId) {
  const card = raceList.querySelector(`[data-race-id="${CSS.escape(raceId)}"]`);
  if (!card) return;

  card.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  card.classList.add("flash");

  window.setTimeout(() => {
    card.classList.remove("flash");
  }, 1200);
}

function selectRaceFromPopup(raceId) {
  const race = races.find(item => item.id === raceId);
  if (!race) return;

  const venue = venueById(race.venueId);

  activeRaceId = race.id;
  renderList(filteredRaces());
  scrollToRaceCard(race.id);

  if (!venue) return;

  const marker = markers.get(venue.id);
  if (!marker) return;

  const venueRaces = filteredRaces().filter(item => isRaceAtVenue(item, venue.id));
  marker.setPopupContent(buildPopup(venue, venueRaces, latestPastRaceForVenue(venue)));
  marker.openPopup();
}

function focusRace(race) {
  const venue = venueById(race.venueId);
  if (!venue) return;

  activeVenueId = venue.id;
  activeRaceId = null;
  updateAppModeClass();

  const baseList = filteredRaces();
  const venueList = baseList.filter(item => isRaceAtVenue(item, activeVenueId));

  renderList(venueList);
  resultLine.textContent = `${venueList.length} ${venueList.length === 1 ? "Rennen" : "Rennen"} an dieser Strecke`;

  map.setView([venue.lat, venue.lng], 12);

  const marker = markers.get(venue.id);
  if (marker) {
    marker.setPopupContent(buildPopup(venue, venueList, latestPastRaceForVenue(venue)));
    marker.openPopup();
  }
}
function renderList(list) {
  resultLine.textContent = `${list.length} ${list.length === 1 ? "Rennen" : "Rennen"} gefunden`;
  raceList.innerHTML = "";

  if (!list.length) {
    raceList.innerHTML = `<div class="empty-state">Keine Rennen für diesen Filter gefunden.</div>`;
    return;
  }

  const hasFavoriteRaces = list.some(isFavoriteRaceVenue);
  const hasNormalRaces = list.some(race => !isFavoriteRaceVenue(race));
  const showSectionDividers = hasFavoriteRaces && hasNormalRaces;
  let didRenderFavoriteDivider = false;
  let didRenderNormalDivider = false;

  for (const race of list) {
    const isFavorite = isFavoriteRaceVenue(race);

    if (showSectionDividers && isFavorite && !didRenderFavoriteDivider) {
      const divider = document.createElement("div");
      divider.className = "race-section-divider race-section-divider-favorites";
      divider.textContent = "★ Favorisierte Strecken";
      raceList.appendChild(divider);
      didRenderFavoriteDivider = true;
    }

    if (showSectionDividers && !isFavorite && !didRenderNormalDivider) {
      const divider = document.createElement("div");
      divider.className = "race-section-divider";
      divider.textContent = "Weitere Rennen";
      raceList.appendChild(divider);
      didRenderNormalDivider = true;
    }

    const series = raceSeries(race);
    const card = document.createElement("article");

    card.className = `race-card registration-${registrationStatus(race)}${isRckRace(race) ? " race-card-rck" : " race-card-myrcm"}${isFavorite ? " race-card-favorite-venue" : ""}${hasMappableVenue(race) ? " is-clickable" : ""}${race.id === activeRaceId ? " active" : ""}`;
    card.dataset.raceId = race.id;
    card.tabIndex = 0;

    card.innerHTML = `
      ${newRaceBadgeHtml(race)}
      <div class="race-card-main">
        <div class="race-card-header">
          <div class="race-date">${formatDateRange(race.from, race.to)}</div>
          <div class="race-name-row">
            <div class="race-name">${race.name}</div>
            ${registrationCountHtml(race)}
          </div>

          <div class="race-tags race-series-tags">
            ${series.map(item => `<span class="tag">${item}</span>`).join("")}
            ${
              !hasMappableVenue(race)
                ? `<span class="tag tag-missing-location">📍 Standort fehlt</span>`
                : !hasVerifiedVenue(race)
                  ? `<span class="tag tag-missing-location">📍 Standort nicht verifiziert</span>`
                  : ""
            }
          </div>
        </div>

        <div class="race-card-meta">
          <div class="race-venue">${raceVenueNameHtml(race)}</div>
          ${documentLinksHtml(race)}
          ${statusDetailsHtml(race)}
        </div>
      </div>

      ${
        Array.isArray(race.classes) && race.classes.length
          ? `<div class="race-tags race-class-tags">
              ${
                (expandedClassRaceIds.has(race.id) ? race.classes : (race.classes.length <= 6 ? race.classes : race.classes.slice(0, 4)))
                  .map(item => `<span class="tag tag-class">${escapeHtml(classTagLabel(item))}</span>`)
                  .join("")
              }
              ${
                race.classes.length > 6
                  ? `<button class="tag tag-class tag-class-toggle"
                      type="button"
                      data-class-toggle="${race.id}"
                      aria-expanded="${expandedClassRaceIds.has(race.id) ? "true" : "false"}">
                      ${
                        expandedClassRaceIds.has(race.id)
                          ? "weniger anzeigen"
                          : `+${race.classes.length - 4} weitere`
                      }
                    </button>`
                  : ""
              }
            </div>`
          : ""
      }
    `;

    if (hasMappableVenue(race)) {
      card.addEventListener("click", event => {
        if (event.target.closest("[data-class-toggle]")) return;
        if (event.target.closest("[data-favorite-venue-id]")) return;
        focusRace(race);
      });

      card.addEventListener("keydown", event => {
        if (event.target.closest("[data-favorite-venue-id]")) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          focusRace(race);
        }
      });
    }

    raceList.appendChild(card);
  }

}

function toggleClassList(raceId) {
  if (expandedClassRaceIds.has(raceId)) {
    expandedClassRaceIds.delete(raceId);
  } else {
    expandedClassRaceIds.add(raceId);
  }

  if (activeVenueId) {
    const venueList = filteredRaces().filter(race => isRaceAtVenue(race, activeVenueId));
    renderList(venueList);
    resultLine.textContent = `${venueList.length} ${venueList.length === 1 ? "Rennen" : "Rennen"} an dieser Strecke`;
    return;
  }

  renderList(filteredRaces());
}

document.addEventListener("click", event => {
  const favoriteButton = event.target.closest("[data-favorite-venue-id]");
  if (!favoriteButton) return;

  event.preventDefault();
  event.stopPropagation();

  toggleFavoriteVenue(favoriteButton.dataset.favoriteVenueId);

  const list = filteredRaces();
  updateMarkers(list, false);

  if (activeVenueId) {
    const venueList = list.filter(race => isRaceAtVenue(race, activeVenueId));
    renderList(venueList);
    resultLine.textContent = `${venueList.length} ${venueList.length === 1 ? "Rennen" : "Rennen"} an dieser Strecke`;
  } else {
    renderList(list);
    resultLine.textContent = `${list.length} ${list.length === 1 ? "Rennen" : "Rennen"} gefunden`;
  }
});

raceList.addEventListener("click", event => {
  const button = event.target.closest("[data-class-toggle]");
  if (!button) return;

  event.preventDefault();
  event.stopPropagation();

  toggleClassList(button.dataset.classToggle);
});

function populateSeries() {
  const allSeries = new Set();

  races.forEach(race => {
    raceSeries(race).forEach(item => allSeries.add(item));
  });

  seriesFilter.innerHTML = `<option value="all">Alle Serien</option>`;

  const orderedSeries = [
    ...preferredSeriesOrder.filter(series => allSeries.has(series)),
    ...[...allSeries].filter(series => !preferredSeriesOrder.includes(series)).sort()
  ];

  orderedSeries.forEach(series => {
    const option = document.createElement("option");
    option.value = series;
    option.textContent = seriesDisplayName(series);
    seriesFilter.appendChild(option);
  });
}

function updateMarkerAnimationDelays() {
  const markerItems = Array.from(markers.values())
    .map(marker => ({
      marker,
      y: map.latLngToContainerPoint(marker.getLatLng()).y
    }))
    .filter(item => Number.isFinite(item.y));

  if (!markerItems.length) return;

  const minY = Math.min(...markerItems.map(item => item.y));
  const maxY = Math.max(...markerItems.map(item => item.y));
  const spanY = Math.max(1, maxY - minY);

  const shuffledItems = markerItems
    .map(item => ({
      ...item,
      sortValue: Math.random()
    }))
    .sort((a, b) => a.sortValue - b.sortValue);

  shuffledItems.forEach((item, index) => {
    const visual = item.marker.getElement()?.querySelector(".map-marker-visual");
    if (!visual) return;

    const delay = Math.round(index * 5);

    visual.style.setProperty("--marker-delay", `${delay}ms`);
  });
}

function revealMap() {
  document.getElementById("map")?.classList.add("map-ready");
}

function revealMapWhenReady() {
  const mapElement = document.getElementById("map");

  map.once("moveend", () => {
    revealMap();
  });

  window.setTimeout(() => {
    if (mapElement?.classList.contains("map-ready")) return;
    revealMap();
  }, 500);
}

function render() {
  updateAppModeClass();
  syncFilterUi();
  const list = filteredRaces();
  updateMarkers(list);

  if (activeVenueId) {
    const venueList = list.filter(race => isRaceAtVenue(race, activeVenueId));

    if (venueList.length) {
      activeRaceId = null;
      renderList(venueList);
      resultLine.textContent = `${venueList.length} ${venueList.length === 1 ? "Rennen" : "Rennen"} an dieser Strecke`;
    } else {
      const venue = venues.find(item => item.id === activeVenueId);
      const latestPastRace = venue ? latestPastRaceForVenue(venue) : null;

      if (latestPastRace) {
        activeRaceId = null;
        renderList([]);
        resultLine.textContent = "Keine kommenden Rennen an dieser Strecke";
      } else {
        activeVenueId = null;
        activeRaceId = null;
        updateAppModeClass();
        renderList(list);
      }
    }
  } else {
    activeRaceId = null;
    updateAppModeClass();
    renderList(list);
  }

  setTimeout(() => {
    map.invalidateSize();
  }, 0);
}

function setLayout(layout) {
  app.classList.toggle("layout-map", layout === "map");
  app.classList.toggle("layout-list", layout === "list");

  mapWideButton.classList.toggle("active", layout === "map");
  listWideButton.classList.toggle("active", layout === "list");

  localStorage.setItem("rcRaceMapLayout", layout);

  setTimeout(() => map.invalidateSize(), 210);
}

rangeFilter.addEventListener("click", event => {
  const button = event.target.closest("button[data-range]");
  if (!button) return;

  selectedRange = button.dataset.range;
  activeVenueId = null;
  activeRaceId = null;
  updateAppModeClass();

  rangeFilter
    .querySelectorAll("button")
    .forEach(item => item.classList.toggle("active", item === button));

  render();
});


if (registrationVisibilityFilter) {
  registrationVisibilityFilter.addEventListener("click", event => {
    const button = event.target.closest("button[data-registration-visibility]");
    if (!button) return;

    showOpenOnly = button.dataset.registrationVisibility === "open";
    activeVenueId = null;
    activeRaceId = null;
    updateAppModeClass();

    registrationVisibilityFilter
      .querySelectorAll("button")
      .forEach(item => item.classList.toggle("active", item === button));

    render();
  });
}

seriesFilter.addEventListener("change", () => {
  selectedSeries = seriesFilter.value;
  activeVenueId = null;
  activeRaceId = null;
  updateAppModeClass();
  render();
});


searchInput.addEventListener("input", () => {
  activeVenueId = null;
  activeRaceId = null;
  updateAppModeClass();
  render();
});

if (filterToggleButton) {
  filterToggleButton.addEventListener("click", () => {
    isFilterPanelOpen = !isFilterPanelOpen;
    updateFilterPanelState();
  });
}

if (activeFilterChips) {
  activeFilterChips.addEventListener("click", event => {
    const button = event.target.closest("button[data-clear-filter]");
    if (!button) return;

    if (button.dataset.clearFilter === "search") {
      searchInput.value = "";
    }

    if (button.dataset.clearFilter === "series") {
      selectedSeries = "all";
      seriesFilter.value = "all";
    }

    activeVenueId = null;
    activeRaceId = null;
    updateAppModeClass();
    render();
  });
}

map.on("click", () => {
  resetVenueSelection();
});

if (mapWideButton && listWideButton) {
  mapWideButton.addEventListener("click", () => setLayout("map"));
  listWideButton.addEventListener("click", () => setLayout("list"));
}

async function fetchJsonOrFallback(url, fallback) {
  try {
    const response = await fetch(url);
    if (!response.ok) return fallback;
    return await response.json();
  } catch {
    return fallback;
  }
}

function normalizeRaceFromSource(race, dataSource) {
  return {
    ...race,
    dataSource
  };
}

function mergeVenues(baseVenues, candidateVenues) {
  const byId = new Map();

  for (const venue of baseVenues) {
    if (!venue?.id) continue;
    byId.set(venue.id, venue);
  }

  for (const venue of candidateVenues) {
    if (!venue?.id || !hasLatLng(venue) || !venue.addressVerifiedFromPdf) continue;
    if (byId.has(venue.id)) continue;
    byId.set(venue.id, venue);
  }

  return Array.from(byId.values());
}

async function init() {
  ensureRegistrationStatusStyles();

  const cacheBuster = Date.now();

  const [venuesResponse, racesResponse, rckRacesResponse, rckVenueCandidatesResponse, hostsResponse] = await Promise.all([
    fetch(`venues.json?v=${cacheBuster}`),
    fetch(`races.json?v=${cacheBuster}`),
    fetchJsonOrFallback(`rck-races.json?v=${cacheBuster}`, []),
    fetchJsonOrFallback(`rck-venue-candidates.json?v=${cacheBuster}`, []),
    fetch(`myrcm-hosts-germany.json?v=${cacheBuster}`).catch(() => null)
  ]);

  const baseVenues = await venuesResponse.json();
  const myrcmRaces = await racesResponse.json();
  const rckRaces = Array.isArray(rckRacesResponse) ? rckRacesResponse : [];
  const rckVenueCandidates = Array.isArray(rckVenueCandidatesResponse) ? rckVenueCandidatesResponse : [];

  venues = mergeVenues(baseVenues, rckVenueCandidates);
  races = [
    ...myrcmRaces
      .filter(race => !isRckEventFromMyRcm(race))
      .map(race => normalizeRaceFromSource(race, "myrcm")),
    ...rckRaces
      .filter(isUsefulRckRace)
      .map(race => normalizeRaceFromSource(race, "rck"))
  ];

  if (hostsResponse?.ok) {
    hosts = await hostsResponse.json();
  } else {
    hosts = [];
  }

  hostsByOrgId = new Map(
    hosts
      .filter(host => host?.orgId)
      .map(host => [String(host.orgId), host])
  );

  populateSeries();

  if (mapWideButton && listWideButton) {
    setLayout(localStorage.getItem("rcRaceMapLayout") || "map");
  }

  syncFilterUi();

  revealMapWhenReady();
  render();
}

init().catch(error => {
  console.error(error);
  resultLine.textContent = "Fehler beim Laden der Daten.";
});
