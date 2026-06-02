const map = L.map("map");

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const dateFilter = document.querySelector("#dateFilter");
const venueFilter = document.querySelector("#venueFilter");
const raceList = document.querySelector("#raceList");
const summary = document.querySelector("#summary");

let venues = [];
let races = [];
let markers = new Map();

function parseDate(value) {
  return new Date(`${value}T12:00:00`);
}

function formatDateRange(from, to) {
  const start = parseDate(from);
  const end = parseDate(to);
  const formatter = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });

  if (from === to) return formatter.format(start);
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function getWeekBounds(date) {
  const start = new Date(date);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return [start, end];
}

function getMonthBounds(date, offset = 0) {
  const start = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const end = new Date(date.getFullYear(), date.getMonth() + offset + 1, 1);
  return [start, end];
}

function isRaceInRange(race, start, end) {
  const raceStart = parseDate(race.from);
  const raceEnd = parseDate(race.to);
  return raceEnd >= start && raceStart < end;
}

function getFilteredRaces() {
  let filtered = [...races];
  const now = new Date();

  if (dateFilter.value === "week") {
    const [start, end] = getWeekBounds(now);
    filtered = filtered.filter(race => isRaceInRange(race, start, end));
  }

  if (dateFilter.value === "month") {
    const [start, end] = getMonthBounds(now, 0);
    filtered = filtered.filter(race => isRaceInRange(race, start, end));
  }

  if (dateFilter.value === "next-month") {
    const [start, end] = getMonthBounds(now, 1);
    filtered = filtered.filter(race => isRaceInRange(race, start, end));
  }

  if (venueFilter.value !== "all") {
    filtered = filtered.filter(race => race.venueId === venueFilter.value);
  }

  return filtered.sort((a, b) => parseDate(a.from) - parseDate(b.from));
}

function groupRacesByVenue(filteredRaces) {
  return venues
    .map(venue => ({
      venue,
      races: filteredRaces.filter(race => race.venueId === venue.id)
    }))
    .filter(group => group.races.length > 0);
}

function createPopupContent(venue, venueRaces) {
  const items = venueRaces
    .map(race => `<li><strong>${formatDateRange(race.from, race.to)}</strong><br>${race.name}</li>`)
    .join("");

  return `
    <strong>${venue.name}</strong><br>
    ${venue.city || ""}
    <ul>${items || "<li>Keine Rennen im aktuellen Filter</li>"}</ul>
  `;
}

function renderMarkers(filteredRaces) {
  markers.forEach(marker => map.removeLayer(marker));
  markers.clear();

  const grouped = groupRacesByVenue(filteredRaces);
  const bounds = [];

  grouped.forEach(({ venue, races: venueRaces }) => {
    const marker = L.marker([venue.lat, venue.lng]).addTo(map);
    marker.bindPopup(createPopupContent(venue, venueRaces));
    markers.set(venue.id, marker);
    bounds.push([venue.lat, venue.lng]);
  });

  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
  } else {
    map.setView([52.52, 13.405], 9);
  }
}

function renderVenueFilter() {
  venues.forEach(venue => {
    const option = document.createElement("option");
    option.value = venue.id;
    option.textContent = venue.name;
    venueFilter.appendChild(option);
  });
}

function renderList(filteredRaces) {
  const grouped = groupRacesByVenue(filteredRaces);
  raceList.innerHTML = "";
  summary.textContent = `${filteredRaces.length} Rennen auf ${grouped.length} Strecken`;

  if (filteredRaces.length === 0) {
    raceList.innerHTML = `<div class="empty">Keine Rennen für diesen Filter.</div>`;
    return;
  }

  grouped.forEach(({ venue, races: venueRaces }) => {
    const group = document.createElement("section");
    group.className = "venue-group";

    const title = document.createElement("h2");
    title.className = "venue-title";
    title.textContent = venue.name;
    group.appendChild(title);

    if (venue.city) {
      const meta = document.createElement("p");
      meta.className = "venue-meta";
      meta.textContent = venue.city;
      group.appendChild(meta);
    }

    venueRaces.forEach(race => {
      const button = document.createElement("button");
      button.className = "race-card";
      button.innerHTML = `
        <span class="race-date">${formatDateRange(race.from, race.to)}</span>
        <span class="race-name">${race.name}</span>
        <span class="race-series">${race.series || ""}</span>
      `;

      button.addEventListener("click", () => {
        const marker = markers.get(venue.id);
        map.setView([venue.lat, venue.lng], 14);
        if (marker) marker.openPopup();
      });

      group.appendChild(button);
    });

    raceList.appendChild(group);
  });
}

function render() {
  const filteredRaces = getFilteredRaces();
  renderMarkers(filteredRaces);
  renderList(filteredRaces);
}

async function init() {
  const [venuesResponse, racesResponse] = await Promise.all([
    fetch("venues.json"),
    fetch("races.json")
  ]);

  venues = await venuesResponse.json();
  races = await racesResponse.json();

  renderVenueFilter();
  render();

  dateFilter.addEventListener("change", render);
  venueFilter.addEventListener("change", render);
}

init().catch(error => {
  console.error(error);
  summary.textContent = "Fehler beim Laden der Daten.";
});
