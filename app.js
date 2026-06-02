const map = L.map("map").setView([52.410703, 13.321052], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const markerGroup = L.layerGroup().addTo(map);

let allRaces = [];
let venuesById = new Map();
let markersByVenueId = new Map();

const filterMode = document.getElementById("filterMode");
const monthInput = document.getElementById("monthInput");
const weekInput = document.getElementById("weekInput");
const monthControl = document.getElementById("monthControl");
const weekControl = document.getElementById("weekControl");
const applyButton = document.getElementById("applyButton");
const summary = document.getElementById("summary");
const raceList = document.getElementById("raceList");

function formatDateRange(start, end) {
  const startDate = new Date(`${start}T12:00:00`);
  const endDate = new Date(`${end}T12:00:00`);
  const formatter = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });

  if (start === end) return formatter.format(startDate);
  return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
}

function getWeekStartFromInput(weekValue) {
  const [yearText, weekText] = weekValue.split("-W");
  const year = Number(yearText);
  const week = Number(weekText);
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const day = simple.getUTCDay();
  const isoWeekStart = simple;

  if (day <= 4) {
    isoWeekStart.setUTCDate(simple.getUTCDate() - simple.getUTCDay() + 1);
  } else {
    isoWeekStart.setUTCDate(simple.getUTCDate() + 8 - simple.getUTCDay());
  }

  return isoWeekStart;
}

function dateRangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && aEnd >= bStart;
}

function filterRaces(races) {
  const mode = filterMode.value;

  if (mode === "month") {
    const [year, month] = monthInput.value.split("-").map(Number);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59);

    return races.filter(race => {
      const raceStart = new Date(`${race.startDate}T12:00:00`);
      const raceEnd = new Date(`${race.endDate}T12:00:00`);
      return dateRangesOverlap(raceStart, raceEnd, monthStart, monthEnd);
    });
  }

  if (mode === "week") {
    const weekStartUtc = getWeekStartFromInput(weekInput.value);
    const weekStart = new Date(weekStartUtc.getUTCFullYear(), weekStartUtc.getUTCMonth(), weekStartUtc.getUTCDate());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    return races.filter(race => {
      const raceStart = new Date(`${race.startDate}T12:00:00`);
      const raceEnd = new Date(`${race.endDate}T12:00:00`);
      return dateRangesOverlap(raceStart, raceEnd, weekStart, weekEnd);
    });
  }

  return races;
}

function buildPopupForVenue(venue, races) {
  const raceItems = races
    .map(race => `<li><strong>${race.title}</strong><br>${formatDateRange(race.startDate, race.endDate)}</li>`)
    .join("");

  return `
    <strong>${venue.name}</strong><br>
    <span>${venue.address || ""}</span>
    <ul style="padding-left: 18px; margin-bottom: 0;">
      ${raceItems}
    </ul>
  `;
}

function renderMap(races) {
  markerGroup.clearLayers();
  markersByVenueId = new Map();

  const racesByVenue = new Map();

  races.forEach(race => {
    if (!racesByVenue.has(race.venueId)) racesByVenue.set(race.venueId, []);
    racesByVenue.get(race.venueId).push(race);
  });

  racesByVenue.forEach((venueRaces, venueId) => {
    const venue = venuesById.get(venueId);
    if (!venue || !venue.lat || !venue.lng) return;

    const marker = L.marker([venue.lat, venue.lng]).addTo(markerGroup);
    marker.bindPopup(buildPopupForVenue(venue, venueRaces));
    markersByVenueId.set(venueId, marker);
  });

  const markers = Array.from(markersByVenueId.values());

  if (markers.length === 1) {
    const latLng = markers[0].getLatLng();
    map.setView(latLng, 14);
  }

  if (markers.length > 1) {
    const group = L.featureGroup(markers);
    map.fitBounds(group.getBounds().pad(0.2));
  }
}

function renderRaceList(races) {
  raceList.innerHTML = "";

  if (races.length === 0) {
    raceList.innerHTML = `<div class="empty-state">Keine Rennen fuer diesen Filter gefunden.</div>`;
    return;
  }

  races
    .slice()
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .forEach(race => {
      const venue = venuesById.get(race.venueId);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "race-card";
      button.innerHTML = `
        <div class="race-date">${formatDateRange(race.startDate, race.endDate)}</div>
        <div class="race-title">${race.title}</div>
        <div class="race-venue">${venue ? venue.name : race.host}</div>
        <div class="race-classes">${race.classes ? race.classes.join(", ") : ""}</div>
      `;

      button.addEventListener("click", () => {
        const marker = markersByVenueId.get(race.venueId);
        const venue = venuesById.get(race.venueId);
        if (!marker || !venue) return;

        map.setView([venue.lat, venue.lng], 15);
        marker.openPopup();
      });

      raceList.appendChild(button);
    });
}

function render() {
  const visibleRaces = filterRaces(allRaces);
  summary.textContent = `${visibleRaces.length} Rennen gefunden`;
  renderMap(visibleRaces);
  renderRaceList(visibleRaces);
}

function updateFilterControls() {
  monthControl.classList.toggle("is-hidden", filterMode.value !== "month");
  weekControl.classList.toggle("is-hidden", filterMode.value !== "week");
}

async function loadData() {
  const [venuesResponse, racesResponse] = await Promise.all([
    fetch("venues.json"),
    fetch("races.json")
  ]);

  const venues = await venuesResponse.json();
  allRaces = await racesResponse.json();
  venuesById = new Map(venues.map(venue => [venue.id, venue]));

  render();
}

filterMode.addEventListener("change", () => {
  updateFilterControls();
  render();
});

applyButton.addEventListener("click", render);
monthInput.addEventListener("change", render);
weekInput.addEventListener("change", render);

updateFilterControls();
loadData().catch(error => {
  console.error(error);
  summary.textContent = "Daten konnten nicht geladen werden.";
});
