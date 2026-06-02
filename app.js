const map = L.map("map").setView([52.4299, 13.3154], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const markerGroup = L.layerGroup().addTo(map);
let allRaces = [];

const filterMode = document.getElementById("filterMode");
const monthInput = document.getElementById("monthInput");
const weekInput = document.getElementById("weekInput");
const monthControl = document.getElementById("monthControl");
const weekControl = document.getElementById("weekControl");
const applyButton = document.getElementById("applyButton");
const summary = document.getElementById("summary");
const eventList = document.getElementById("eventList");

function formatDateRange(start, end) {
  const startDate = new Date(start + "T12:00:00");
  const endDate = new Date(end + "T12:00:00");
  const formatter = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
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

function dateRangesOverlap(startA, endA, startB, endB) {
  return startA <= endB && endA >= startB;
}

function raceMatchesFilter(race) {
  const mode = filterMode.value;
  if (mode === "all") return true;

  const raceStart = new Date(race.startDate + "T00:00:00");
  const raceEnd = new Date(race.endDate + "T23:59:59");

  if (mode === "month") {
    const [year, month] = monthInput.value.split("-").map(Number);
    const start = new Date(year, month - 1, 1, 0, 0, 0);
    const end = new Date(year, month, 0, 23, 59, 59);
    return dateRangesOverlap(raceStart, raceEnd, start, end);
  }

  if (mode === "week") {
    const weekStartUtc = getWeekStartFromInput(weekInput.value);
    const start = new Date(weekStartUtc.getUTCFullYear(), weekStartUtc.getUTCMonth(), weekStartUtc.getUTCDate(), 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59);
    return dateRangesOverlap(raceStart, raceEnd, start, end);
  }
}

function updateControls() {
  monthControl.style.display = filterMode.value === "month" ? "grid" : "none";
  weekControl.style.display = filterMode.value === "week" ? "grid" : "none";
}

function render() {
  markerGroup.clearLayers();
  eventList.innerHTML = "";

  const races = allRaces.filter(raceMatchesFilter);
  summary.textContent = `${races.length} Rennen angezeigt`;

  if (races.length === 0) {
    eventList.innerHTML = '<li class="muted">Keine Rennen im gewählten Zeitraum.</li>';
    return;
  }

  const bounds = [];

  races.forEach((race) => {
    const { lat, lng, name, address } = race.track;
    bounds.push([lat, lng]);

    L.marker([lat, lng])
      .addTo(markerGroup)
      .bindPopup(`
        <strong>${race.title}</strong><br>
        ${formatDateRange(race.startDate, race.endDate)}<br>
        ${name}<br>
        ${address}<br>
        <small>${race.classes.join(", ")}</small><br><br>
        <a href="${race.url}" target="_blank" rel="noopener">MyRCM öffnen</a>
      `);

    const li = document.createElement("li");
    li.innerHTML = `<strong>${race.title}</strong>, ${formatDateRange(race.startDate, race.endDate)} <span class="muted">${race.classes.join(", ")}</span>`;
    eventList.appendChild(li);
  });

  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
}

async function init() {
  updateControls();
  const response = await fetch("races.json");
  allRaces = await response.json();
  render();
}

filterMode.addEventListener("change", () => {
  updateControls();
  render();
});
applyButton.addEventListener("click", render);
monthInput.addEventListener("change", render);
weekInput.addEventListener("change", render);

init();
