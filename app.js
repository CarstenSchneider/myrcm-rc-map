const app = document.getElementById("app");
const raceList = document.getElementById("raceList");
const resultLine = document.getElementById("resultLine");
const searchInput = document.getElementById("searchInput");
const seriesFilter = document.getElementById("seriesFilter");
const rangeFilter = document.getElementById("rangeFilter");
const mapWideButton = document.getElementById("mapWideButton");
const listWideButton = document.getElementById("listWideButton");

const map = L.map("map", { scrollWheelZoom: true }).setView([52.52, 13.405], 9);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap"
}).addTo(map);

let venues = [];
let races = [];
let markers = new Map();
let activeRaceId = null;
let selectedRange = "4";
let selectedSeries = "all";

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
  const fmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const fmtShort = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });

  if (from === to || !to) return fmt.format(start);
  if (start.getFullYear() === end.getFullYear()) {
    return `${fmtShort.format(start)}–${fmt.format(end)}`;
  }
  return `${fmt.format(start)}–${fmt.format(end)}`;
}

function detectSeries(name) {
  const rules = [
    { label: "BTM", re: /berlin touring masters|\bbtm\b/i },
    { label: "TEC", re: /tamiya euro cup|\btec\b/i },
    { label: "Speed Masters", re: /speed masters/i },
    { label: "SK", re: /\bsk[- ]?lauf\b|sk lauf/i },
    { label: "Tamico", re: /tamico/i },
    { label: "RCK", re: /\brck\b/i }
  ];

  return rules.filter(rule => rule.re.test(name)).map(rule => rule.label);
}

function raceSeries(race) {
  if (Array.isArray(race.series) && race.series.length) return race.series;
  return detectSeries(race.name);
}

function venueById(id) {
  return venues.find(venue => venue.id === id);
}

function raceSearchText(race) {
  const venue = venueById(race.venueId);
  return [race.name, venue?.name, venue?.city, ...raceSeries(race)].filter(Boolean).join(" ").toLowerCase();
}

function isInSelectedRange(race) {
  const start = parseDate(race.from);
  const today = todayStart();
  if (start < today) return false;

  if (selectedRange === "season") {
    return start.getFullYear() === today.getFullYear() || start.getFullYear() === today.getFullYear() + 1;
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

function buildPopup(venue, venueRaces) {
  const items = venueRaces
    .slice(0, 6)
    .map(race => `<div class="popup-race"><strong>${formatDateRange(race.from, race.to)}</strong><br>${race.name}</div>`)
    .join("");

  return `<div class="popup-title">${venue.name}</div>${items || "<div class='popup-race'>Keine Rennen im aktuellen Filter.</div>"}`;
}

function updateMarkers(list) {
  markers.forEach(marker => marker.remove());
  markers.clear();

  const venueIds = new Set(list.map(race => race.venueId));
  const bounds = [];

  venues.forEach(venue => {
    if (!venueIds.has(venue.id)) return;

    const venueRaces = list.filter(race => race.venueId === venue.id);
    const marker = L.marker([venue.lat, venue.lng]).addTo(map);
    marker.bindPopup(buildPopup(venue, venueRaces));
    marker.on("click", () => highlightVenue(venue.id));
    markers.set(venue.id, marker);
    bounds.push([venue.lat, venue.lng]);
  });

  if (bounds.length === 1) map.setView(bounds[0], 12);
  if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40] });
}

function highlightVenue(venueId) {
  const firstRace = filteredRaces().find(race => race.venueId === venueId);
  if (!firstRace) return;
  activeRaceId = firstRace.id;
  render();
  document.querySelector(`[data-race-id="${firstRace.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function focusRace(race) {
  const venue = venueById(race.venueId);
  if (!venue) return;
  activeRaceId = race.id;
  renderList(filteredRaces());
  map.setView([venue.lat, venue.lng], 12);
  const marker = markers.get(venue.id);
  if (marker) marker.openPopup();
}

function renderList(list) {
  resultLine.textContent = `${list.length} ${list.length === 1 ? "Rennen" : "Rennen"} gefunden`;
  raceList.innerHTML = "";

  if (!list.length) {
    raceList.innerHTML = `<div class="empty-state">Keine Rennen für diesen Filter gefunden.</div>`;
    return;
  }

  for (const race of list) {
    const venue = venueById(race.venueId);
    const series = raceSeries(race);
    const card = document.createElement("article");
    card.className = `race-card${race.id === activeRaceId ? " active" : ""}`;
    card.dataset.raceId = race.id;
    card.tabIndex = 0;

    card.innerHTML = `
      <div class="race-date">${formatDateRange(race.from, race.to)}</div>
      <div class="race-name">${race.name}</div>
      <div class="race-venue">${venue?.name || race.venueId}</div>
      ${series.length ? `<div class="race-tags">${series.map(item => `<span class="tag">${item}</span>`).join("")}</div>` : ""}
      ${race.url ? `<a class="race-link" href="${race.url}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">MyRCM öffnen ↗</a>` : ""}
    `;

    card.addEventListener("click", () => focusRace(race));
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        focusRace(race);
      }
    });

    raceList.appendChild(card);
  }
}

function populateSeries() {
  const allSeries = new Set();
  races.forEach(race => raceSeries(race).forEach(item => allSeries.add(item)));

  [...allSeries].sort().forEach(series => {
    const option = document.createElement("option");
    option.value = series;
    option.textContent = series;
    seriesFilter.appendChild(option);
  });
}

function render() {
  const list = filteredRaces();
  updateMarkers(list);
  renderList(list);
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
  rangeFilter.querySelectorAll("button").forEach(item => item.classList.toggle("active", item === button));
  render();
});

seriesFilter.addEventListener("change", () => {
  selectedSeries = seriesFilter.value;
  render();
});

searchInput.addEventListener("input", render);
mapWideButton.addEventListener("click", () => setLayout("map"));
listWideButton.addEventListener("click", () => setLayout("list"));

async function init() {
  const [venuesResponse, racesResponse] = await Promise.all([
    fetch("venues.json"),
    fetch("races.json")
  ]);

  venues = await venuesResponse.json();
  races = await racesResponse.json();

  populateSeries();
  setLayout(localStorage.getItem("rcRaceMapLayout") || "map");
  render();
}

init().catch(error => {
  console.error(error);
  resultLine.textContent = "Fehler beim Laden der Daten.";
});
