const map = L.map("map", { scrollWheelZoom: true });
const markers = new Map();
let venues = [];
let races = [];
let venueById = new Map();

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap"
}).addTo(map);

const periodFilter = document.getElementById("periodFilter");
const raceList = document.getElementById("raceList");
const summary = document.getElementById("summary");

function parseDate(value) {
  return new Date(`${value}T00:00:00`);
}

function formatDateRange(race) {
  const from = parseDate(race.from);
  const to = parseDate(race.to || race.from);
  const options = { day: "2-digit", month: "2-digit", year: "numeric" };
  const fromText = from.toLocaleDateString("de-DE", options);
  const toText = to.toLocaleDateString("de-DE", options);
  return fromText === toText ? fromText : `${fromText} – ${toText}`;
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date) {
  const d = startOfWeek(date);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

function raceMatchesPeriod(race) {
  const value = periodFilter.value;
  if (value === "all") return true;

  const now = new Date();
  const from = parseDate(race.from);
  const to = parseDate(race.to || race.from);

  if (value === "week") {
    const start = startOfWeek(now);
    const end = endOfWeek(now);
    return from <= end && to >= start;
  }

  if (value === "month") {
    return from.getFullYear() === now.getFullYear() && from.getMonth() === now.getMonth();
  }

  return true;
}

function groupRacesByVenue(filteredRaces) {
  const groups = new Map();
  for (const race of filteredRaces) {
    if (!groups.has(race.venueId)) groups.set(race.venueId, []);
    groups.get(race.venueId).push(race);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => parseDate(a.from) - parseDate(b.from));
  }
  return groups;
}

function popupHtml(venue, venueRaces) {
  const items = venueRaces.length
    ? venueRaces.map(race => `<li><strong>${formatDateRange(race)}</strong><br>${race.name}${race.url ? `<br><a href="${race.url}" target="_blank" rel="noopener">MyRCM</a>` : ""}</li>`).join("")
    : "<li>Keine Rennen im gewählten Zeitraum</li>";

  return `<strong>${venue.name}</strong><ul>${items}</ul>`;
}

function renderMarkers(groups) {
  markers.forEach(marker => marker.remove());
  markers.clear();

  const bounds = [];
  for (const venue of venues) {
    const venueRaces = groups.get(venue.id) || [];
    if (!venueRaces.length && periodFilter.value !== "all") continue;

    const marker = L.marker([venue.lat, venue.lng]).addTo(map);
    marker.bindPopup(popupHtml(venue, venueRaces));
    markers.set(venue.id, marker);
    bounds.push([venue.lat, venue.lng]);
  }

  if (bounds.length) map.fitBounds(bounds, { padding: [40, 40] });
  else map.setView([52.52, 13.405], 9);
}

function renderList(groups, filteredRaces) {
  summary.textContent = `${filteredRaces.length} Rennen gefunden`;
  raceList.innerHTML = "";

  if (!filteredRaces.length) {
    raceList.innerHTML = `<p class="empty">Keine Rennen im gewählten Zeitraum.</p>`;
    return;
  }

  const sortedVenues = venues
    .filter(venue => groups.has(venue.id))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  for (const venue of sortedVenues) {
    const group = document.createElement("section");
    group.className = "venue-group";

    const title = document.createElement("h2");
    title.className = "venue-title";
    title.textContent = venue.name;
    group.appendChild(title);

    for (const race of groups.get(venue.id)) {
      const button = document.createElement("button");
      button.className = "race-card";
      button.innerHTML = `
        <span class="race-date">${formatDateRange(race)}</span>
        <span class="race-name">${race.name}</span>
        ${race.url ? `<a class="race-link" href="${race.url}" target="_blank" rel="noopener">MyRCM öffnen</a>` : ""}
      `;
      button.addEventListener("click", event => {
        if (event.target.tagName.toLowerCase() === "a") return;
        const marker = markers.get(venue.id);
        if (marker) {
          map.setView([venue.lat, venue.lng], 14);
          marker.openPopup();
        }
      });
      group.appendChild(button);
    }

    raceList.appendChild(group);
  }
}

function render() {
  const filteredRaces = races.filter(raceMatchesPeriod);
  const groups = groupRacesByVenue(filteredRaces);
  renderMarkers(groups);
  renderList(groups, filteredRaces);
}

async function init() {
  const [venuesResponse, racesResponse] = await Promise.all([
    fetch("venues.json", { cache: "no-cache" }),
    fetch("races.json", { cache: "no-cache" })
  ]);

  venues = await venuesResponse.json();
  races = await racesResponse.json();
  venueById = new Map(venues.map(venue => [venue.id, venue]));

  races = races
    .filter(race => venueById.has(race.venueId))
    .sort((a, b) => parseDate(a.from) - parseDate(b.from));

  periodFilter.addEventListener("change", render);
  render();
}

init().catch(error => {
  console.error(error);
  summary.textContent = "Fehler beim Laden der Daten.";
});
