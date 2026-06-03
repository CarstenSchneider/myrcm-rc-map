const app = document.getElementById("app");
const raceList = document.getElementById("raceList");
const resultLine = document.getElementById("resultLine");
const searchInput = document.getElementById("searchInput");
const seriesFilter = document.getElementById("seriesFilter");
const rangeFilter = document.getElementById("rangeFilter");
const mapWideButton = document.getElementById("mapWideButton");
const listWideButton = document.getElementById("listWideButton");

const map = L.map("map", {
  scrollWheelZoom: true,
  zoomControl: false
}).setView([52.52, 13.405], 9);

L.control.zoom({
  position: "bottomleft"
}).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap"
}).addTo(map);

let venues = [];
let races = [];
let hosts = [];
let hostsByOrgId = new Map();
let markers = new Map();
let activeRaceId = null;
let activeVenueId = null;
let isSwitchingMarkerPopup = false;
let selectedRange = "4";
let selectedSeries = "all";

function updateAppModeClass() {
  app.classList.toggle("is-venue-mode", Boolean(activeVenueId));
}


const verifiedVenueAliases = {
  "myrcm-18244": "tsv-mariendorf",
  "myrcm-45925": "bernau",
  "myrcm-41404": "marzahn",
  "myrcm-52898": "blankenfelde"
};

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

function registrationStatus(race) {
  if (race.registrationStatus) return race.registrationStatus;
  if (race.registrationRequiresLogin) return "login_required";
  return "open";
}

function isRegistrationActive(race) {
  const status = registrationStatus(race);
  return status === "open" || status === "login_required";
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

function hasActiveRegistration(venueRaces) {
  return venueRaces.some(isRegistrationActive);
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
    { label: "TEC", re: /tamiya euro cup|\btec\b/i },
    { label: "Speed Masters", re: /speed masters/i },
    { label: "SK", re: /\bsk[- ]?lauf\b|sk lauf/i },
    { label: "Tamico", re: /tamico/i },
    { label: "Ostmasters", re: /ostmasters/i }
  ];

  return rules
    .filter(rule => rule.re.test(name))
    .map(rule => rule.label);
}

function raceSeries(race) {
  if (Array.isArray(race.series) && race.series.length) return race.series;
  return detectSeries(race.name);
}

function venueAliasId(raceVenueId) {
  if (!raceVenueId) return null;

  for (const prefix of Object.keys(verifiedVenueAliases)) {
    if (raceVenueId.startsWith(prefix)) {
      return verifiedVenueAliases[prefix];
    }
  }

  return null;
}

function venueById(id) {
  if (!id) return null;

  const direct = venues.find(venue => {
    return id === venue.id || id.startsWith(`${venue.id}-`);
  });

  if (direct) return direct;

  const alias = venueAliasId(id);
  if (!alias) return null;

  return venues.find(venue => venue.id === alias) || null;
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

  Object.entries(verifiedVenueAliases).forEach(([myrcmId, venueId]) => {
    if (venue.id === venueId) {
      const orgId = orgIdFromValue(myrcmId);
      if (orgId) ids.add(orgId);
    }
  });

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

  if (!website) return venue.name;

  return `<a href="${website}" target="_blank" rel="noreferrer">${venue.name}</a>`;
}

function raceVenueNameHtml(race) {
  const name = venueDisplayName(race);
  const website = raceWebsite(race);

  if (!website) return name;

  return `<a href="${website}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">${name}</a>`;
}

function hasVerifiedVenue(race) {
  return Boolean(venueById(race.venueId));
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
    ...(Array.isArray(race.classes) ? race.classes : [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isRaceAtVenue(race, venueId) {
  if (!race.venueId) return false;

  if (race.venueId === venueId) return true;

  if (race.venueId.startsWith(`${venueId}-`)) return true;

  return venueAliasId(race.venueId) === venueId;
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
    .filter(isInSelectedRange)
    .filter(race => selectedSeries === "all" || raceSeries(race).includes(selectedSeries))
    .filter(race => !query || raceSearchText(race).includes(query))
    .sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
}

function googleMapsRouteUrl(venue) {
  return `https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}`;
}

function buildPopup(venue, venueRaces) {
  return `
    <div class="popup-title">${venueNameHtml(venue)}</div>
    <div class="popup-race">
      ${venueRaces.length} ${venueRaces.length === 1 ? "Rennen" : "Rennen"}
    </div>
    <div class="popup-race">
      <a href="${googleMapsRouteUrl(venue)}" target="_blank" rel="noreferrer">
        Route planen ↗
      </a>
    </div>
  `;
}

function resetVenueSelection() {
  if (!activeVenueId && !activeRaceId) return;

  activeVenueId = null;
  activeRaceId = null;
  updateAppModeClass();
  renderList(filteredRaces());
}

function updateMarkers(list) {
  markers.forEach(marker => marker.remove());
  markers.clear();

  const bounds = [];

  venues.forEach(venue => {
    const venueRaces = list.filter(race => isRaceAtVenue(race, venue.id));

    if (!venueRaces.length) return;

    const marker = L.marker([venue.lat, venue.lng]).addTo(map);

    if (!hasActiveRegistration(venueRaces)) {
      marker.setOpacity(0.45);
    }

    marker.bindPopup(buildPopup(venue, venueRaces));

    marker.on("popupclose", () => {
      if (isSwitchingMarkerPopup) return;

      resetVenueSelection();
    });
    
    marker.on("click", event => {
      if (event.originalEvent) {
        L.DomEvent.stopPropagation(event.originalEvent);
      }

      isSwitchingMarkerPopup = true;

      markers.forEach(otherMarker => {
        if (otherMarker !== marker) {
          otherMarker.closePopup();
        }
      });

      activeVenueId = venue.id;
      activeRaceId = null;
      updateAppModeClass();
      renderList(venueRaces);
      resultLine.textContent = `${venueRaces.length} ${venueRaces.length === 1 ? "Rennen" : "Rennen"} an dieser Strecke`;

      marker.setPopupContent(buildPopup(venue, venueRaces));
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

  if (bounds.length > 1) {
    map.fitBounds(bounds, { padding: [40, 40] });
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
  marker.setPopupContent(buildPopup(venue, venueRaces));
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
    marker.setPopupContent(buildPopup(venue, venueList));
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

  for (const race of list) {
    const series = raceSeries(race);
    const card = document.createElement("article");

    card.className = `race-card registration-${registrationStatus(race)}${hasVerifiedVenue(race) ? " is-clickable" : ""}${race.id === activeRaceId ? " active" : ""}`;
    card.dataset.raceId = race.id;
    card.tabIndex = 0;

    card.innerHTML = `
      <div class="race-card-main">
        <div class="race-card-header">
          <div class="race-date">${formatDateRange(race.from, race.to)}</div>
          <div class="race-name">${race.name}</div>

          <div class="race-tags race-series-tags">
            ${series.map(item => `<span class="tag">${item}</span>`).join("")}
            ${
              !hasVerifiedVenue(race)
                ? `<span class="tag tag-missing-location">📍 Standort nicht verifiziert</span>`
                : ""
            }
          </div>
        </div>

        <div class="race-card-meta">
          <div class="race-venue">${raceVenueNameHtml(race)}</div>
          ${registrationLinkHtml(race)}
          ${registrationStatusHtml(race)}
        </div>
      </div>

      ${
        Array.isArray(race.classes) && race.classes.length
          ? `<div class="race-tags race-class-tags">
              ${race.classes.map(item => `<span class="tag tag-class">${item}</span>`).join("")}
            </div>`
          : ""
      }
    `;

    if (hasVerifiedVenue(race)) {
      card.addEventListener("click", () => focusRace(race));

      card.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          focusRace(race);
        }
      });
    }

    raceList.appendChild(card);
  }
}

function populateSeries() {
  const allSeries = new Set();

  races.forEach(race => {
    raceSeries(race).forEach(item => allSeries.add(item));
  });

  seriesFilter.innerHTML = `<option value="all">Alle Serien</option>`;

  [...allSeries].sort().forEach(series => {
    const option = document.createElement("option");
    option.value = series;
    option.textContent = series;
    seriesFilter.appendChild(option);
  });
}

function render() {
  updateAppModeClass();
  const list = filteredRaces();
  updateMarkers(list);

  if (activeVenueId) {
    const venueList = list.filter(race => isRaceAtVenue(race, activeVenueId));

    if (venueList.length) {
      activeRaceId = null;
      renderList(venueList);
      resultLine.textContent = `${venueList.length} ${venueList.length === 1 ? "Rennen" : "Rennen"} an dieser Strecke`;
    } else {
      activeVenueId = null;
      activeRaceId = null;
      updateAppModeClass();
      renderList(list);
    }
  } else {
    activeRaceId = null;
    updateAppModeClass();
    renderList(list);
  }

  setTimeout(() => map.invalidateSize(), 0);
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

map.on("click", () => {
  resetVenueSelection();
});

if (mapWideButton && listWideButton) {
  mapWideButton.addEventListener("click", () => setLayout("map"));
  listWideButton.addEventListener("click", () => setLayout("list"));
}

async function init() {
  ensureRegistrationStatusStyles();

  const cacheBuster = Date.now();

  const [venuesResponse, racesResponse, hostsResponse] = await Promise.all([
    fetch(`../venues.json?v=${cacheBuster}`),
    fetch(`../races.json?v=${cacheBuster}`),
    fetch(`../myrcm-hosts-germany.json?v=${cacheBuster}`).catch(() => null)
  ]);

  venues = await venuesResponse.json();
  races = await racesResponse.json();

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

  render();
}

init().catch(error => {
  console.error(error);
  resultLine.textContent = "Fehler beim Laden der Daten.";
});
