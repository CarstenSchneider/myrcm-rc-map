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
const favoriteFilter = document.getElementById("favoriteFilter");
let dataLastUpdatedAt = null;

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

const stadiaApiKey = "8b841ee3-0006-49fa-b575-45544e8d1b5e";
const rcRaceMapColors = {
  water: "#3A4D79",
  land: "#F2F3F0",
  landcover: "#F2F3F0",
  building: "#DDDDDD",
  road: "#DDDDDD",
  boundary: "#DDDDDD",
  label: "#716F6F",
  labelHalo: "#F2F3F0",
  marker: "#213769",
  markerClosed: "#716F6F",
  favorite: "#C8B090",
  statusOpen: "#73FF60",
  statusClosed: "#E51354",
  statusUpcoming: "#FFA700"
};

const raceMapMarkerViewBox = {
  width: 477,
  height: 528.98
};
const raceMapMarkerBaseHeight = 34;
const raceMapMarkerBaseWidth = Math.round(
  raceMapMarkerBaseHeight * raceMapMarkerViewBox.width / raceMapMarkerViewBox.height
);
const mapPinViewBox = {
  width: 129.98,
  height: 153
};
const mapPinPath = "M129.98,64.99C129.98,29.1,100.88,0,64.99,0S0,29.1,0,64.99c0,29.66,19.88,54.66,47.04,62.46l17.95,25.56,17.95-25.56c27.16-7.79,47.04-32.79,47.04-62.46Z";

// Based on racemap_icon.svg: the lower white layer stays white, the top colour layer gets the marker state color.
function raceMapMarkerSvgDataUri(color, width, height) {
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${raceMapMarkerViewBox.width} ${raceMapMarkerViewBox.height}" xmlns="http://www.w3.org/2000/svg">
      <g id="white" fill="#fff">
        <circle cx="238.73" cy="238.59" r="189.45"/>
      </g>
      <g id="colour" fill="${color}">
        <g>
          <path d="M249.52,205.37v66.26c22.09-2.98,44.17-5.96,66.26-6.71v-66.26c-22.09.75-44.17,3.73-66.26,6.71Z"/>
          <path d="M477,238.5C477,106.78,370.22,0,238.5,0S0,106.78,0,238.5c0,111.19,76.09,204.61,179.04,231.03l59.46,59.46,59.46-59.46c102.95-26.42,179.04-119.84,179.04-231.03ZM382.05,271.63c-22.09-5.96-44.17-7.45-66.26-6.71v66.26c-22.09.75-44.17,3.73-66.26,6.71v-66.26c-22.09,2.98-44.17,5.96-66.26,6.71v66.26c-22.09.75-44.17-.75-66.26-6.71v-66.26c22.09,5.96,44.17,7.45,66.26,6.71v-66.26c-22.09.75-44.17-.75-66.26-6.71v-66.26c22.09,5.96,44.17,7.45,66.26,6.71v66.26c22.09-.75,44.17-3.73,66.26-6.71v-66.26c22.09-2.98,44.17-5.96,66.26-6.71v66.26c22.09-.75,44.17.75,66.26,6.71v66.26Z"/>
        </g>
      </g>
    </svg>
  `;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function mapPinSvg(color, width, height) {
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${mapPinViewBox.width} ${mapPinViewBox.height}" xmlns="http://www.w3.org/2000/svg">
      <path fill="${color}" d="${mapPinPath}"/>
    </svg>
  `;
}

function mapPinSvgDataUri(color, width, height) {
  return `data:image/svg+xml,${encodeURIComponent(mapPinSvg(color, width, height))}`;
}

function mapPinIconHtml(className) {
  return `<svg class="${className}" viewBox="0 0 ${mapPinViewBox.width} ${mapPinViewBox.height}" aria-hidden="true" focusable="false"><path fill="currentColor" d="${mapPinPath}"/></svg>`;
}

const baseMapLayer = L.maplibreGL({
  style: `https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key=${stadiaApiKey}`,
  attribution:
    '&copy; <a href="https://www.stadiamaps.com/" target="_blank">Stadia Maps</a> ' +
    '&copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> ' +
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>'
}).addTo(map);

const waterLabelLayerIds = new Set([
  "water_name_line",
  "water_name_nonocean",
  "water_name_ocean"
]);

const majorRoadLayerIds = new Set([
  "tunnel_motorway_casing",
  "tunnel_motorway_inner",
  "highway_major_casing",
  "highway_major_inner",
  "highway_major_subtle",
  "highway_motorway_casing",
  "highway_motorway_inner",
  "highway_motorway_subtle",
  "highway_motorway_bridge_casing",
  "highway_motorway_bridge_inner"
]);

const roadShieldLayerIds = new Set([
  "highway_shield_other",
  "highway_shield_us_other",
  "highway_shield_us_interstate"
]);

const roadShieldIconSizes = {
  1: [14, 14],
  2: [20, 14],
  3: [26, 14],
  4: [31, 14],
  5: [36, 14],
  6: [40, 14]
};

const countryRegionLabelLayerIds = new Set([
  "place_country_other",
  "place_country_major",
  "place_state"
]);

const localizedPlaceLabel = [
  "coalesce",
  ["get", "name:de"],
  ["get", "name_de"],
  ["get", "name:latin"],
  ["get", "name"]
];

function layerLooksLike(layer, tokens = []) {
  const id = String(layer?.id || "").toLowerCase();
  const sourceLayer = String(layer?.["source-layer"] || "").toLowerCase();
  const combined = `${id} ${sourceLayer}`;

  return tokens.some(token => combined.includes(token));
}

function setMapPaint(maplibreMap, layerId, property, value) {
  try {
    maplibreMap.setPaintProperty(layerId, property, value);
  } catch {}
}

function setMapLayout(maplibreMap, layerId, property, value) {
  try {
    maplibreMap.setLayoutProperty(layerId, property, value);
  } catch {}
}

function fillRoundedRect(context, x, y, width, height, radius) {
  const corner = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + corner, y);
  context.lineTo(x + width - corner, y);
  context.quadraticCurveTo(x + width, y, x + width, y + corner);
  context.lineTo(x + width, y + height - corner);
  context.quadraticCurveTo(x + width, y + height, x + width - corner, y + height);
  context.lineTo(x + corner, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - corner);
  context.lineTo(x, y + corner);
  context.quadraticCurveTo(x, y, x + corner, y);
  context.closePath();
  context.fill();
}

function roadShieldImageData(length) {
  const [width, height] = roadShieldIconSizes[length];
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) return null;

  canvas.width = width;
  canvas.height = height;
  context.fillStyle = rcRaceMapColors.road;
  fillRoundedRect(context, 0, 0, width, height, 2);

  return {
    width,
    height,
    data: context.getImageData(0, 0, width, height).data
  };
}

function installRoadShieldImages(maplibreMap) {
  Object.keys(roadShieldIconSizes).forEach(length => {
    const imageId = `rc-road-shield-${length}`;
    const imageData = roadShieldImageData(length);

    if (!imageData) return;

    try {
      if (maplibreMap.hasImage?.(imageId)) {
        maplibreMap.updateImage(imageId, imageData);
      } else {
        maplibreMap.addImage(imageId, imageData);
      }
    } catch {}
  });
}

function applyMajorRoadStyle(maplibreMap, layerId) {
  setMapPaint(maplibreMap, layerId, "line-color", rcRaceMapColors.road);

  if (layerId.includes("subtle")) {
    setMapPaint(maplibreMap, layerId, "line-opacity", layerId.includes("motorway") ? 0.95 : 0.86);
    setMapPaint(maplibreMap, layerId, "line-width", layerId.includes("motorway") ? 1.35 : 1.15);
    return;
  }

  if (layerId.includes("casing")) {
    setMapPaint(maplibreMap, layerId, "line-opacity", 0.62);
    return;
  }

  setMapPaint(maplibreMap, layerId, "line-opacity", 0.9);
}

function applyRoadShieldStyle(maplibreMap, layerId) {
  setMapLayout(maplibreMap, layerId, "icon-image", "rc-road-shield-{ref_length}");
  setMapPaint(maplibreMap, layerId, "icon-opacity", 1);
  setMapPaint(maplibreMap, layerId, "icon-halo-width", 0);
  setMapPaint(maplibreMap, layerId, "icon-halo-blur", 0);
  setMapPaint(maplibreMap, layerId, "text-color", rcRaceMapColors.label);
  setMapPaint(maplibreMap, layerId, "text-halo-width", 0);
  setMapPaint(maplibreMap, layerId, "text-halo-blur", 0);
  setMapPaint(maplibreMap, layerId, "text-halo-color", rcRaceMapColors.road);
}

function applyCountryRegionLabelStyle(maplibreMap, layerId) {
  setMapPaint(maplibreMap, layerId, "text-color", rcRaceMapColors.label);
  setMapPaint(maplibreMap, layerId, "text-opacity", layerId === "place_state" ? 0.34 : 0.42);
  setMapPaint(maplibreMap, layerId, "text-halo-color", rcRaceMapColors.labelHalo);
  setMapPaint(maplibreMap, layerId, "text-halo-width", 0.8);

  if (layerId === "place_state") {
    setMapLayout(maplibreMap, layerId, "text-size", 9);
    return;
  }

  setMapLayout(maplibreMap, layerId, "text-size", {
    base: 1,
    stops: [
      [0, 10],
      [6, 12],
      [9, 18]
    ]
  });
}

function applyRcRaceMapStyle() {
  const maplibreMap = baseMapLayer.getMaplibreMap?.();
  if (!maplibreMap?.getStyle) return;

  const style = maplibreMap.getStyle();
  const layers = Array.isArray(style?.layers) ? style.layers : [];
  installRoadShieldImages(maplibreMap);

  layers.forEach(layer => {
    const id = layer.id;
    if (!id || !maplibreMap.getLayer(id)) return;

    if (waterLabelLayerIds.has(id)) {
      setMapLayout(maplibreMap, id, "visibility", "none");
      return;
    }

    if (layer.type === "fill" && layerLooksLike(layer, ["water", "ocean", "sea", "lake", "river"])) {
      maplibreMap.setPaintProperty(id, "fill-color", rcRaceMapColors.water);
      maplibreMap.setPaintProperty(id, "fill-opacity", 0.88);
      return;
    }

    if (layer.type === "line" && layerLooksLike(layer, ["water", "river", "stream", "canal"])) {
      maplibreMap.setPaintProperty(id, "line-color", rcRaceMapColors.water);
      maplibreMap.setPaintProperty(id, "line-opacity", 0.75);
      return;
    }

    if (layer.type === "fill" && layerLooksLike(layer, ["landcover", "landuse", "park", "wood", "forest", "grass"])) {
      maplibreMap.setPaintProperty(id, "fill-color", rcRaceMapColors.landcover);
      maplibreMap.setPaintProperty(id, "fill-opacity", 0.72);
      return;
    }

    if (layer.type === "fill" && layerLooksLike(layer, ["building"])) {
      maplibreMap.setPaintProperty(id, "fill-color", rcRaceMapColors.building);
      maplibreMap.setPaintProperty(id, "fill-opacity", 0.72);
      return;
    }

    if (layer.type === "line" && majorRoadLayerIds.has(id)) {
      applyMajorRoadStyle(maplibreMap, id);
      return;
    }

    if (layer.type === "line" && layerLooksLike(layer, ["boundary"])) {
      maplibreMap.setPaintProperty(id, "line-color", rcRaceMapColors.boundary);
      maplibreMap.setPaintProperty(id, "line-opacity", 0.72);
      return;
    }

    if (layer.type === "symbol") {
      if (roadShieldLayerIds.has(id)) {
        applyRoadShieldStyle(maplibreMap, id);
        return;
      }

      if (layer["source-layer"] === "place") {
        setMapLayout(maplibreMap, id, "text-field", localizedPlaceLabel);
      }

      try {
        maplibreMap.setPaintProperty(id, "text-color", rcRaceMapColors.label);
        maplibreMap.setPaintProperty(id, "text-halo-color", rcRaceMapColors.labelHalo);
        maplibreMap.setPaintProperty(id, "text-halo-width", 1.2);
      } catch {}

      if (countryRegionLabelLayerIds.has(id)) {
        applyCountryRegionLabelStyle(maplibreMap, id);
      }
    }
  });

  const canvas = maplibreMap.getCanvas?.();
  if (canvas) {
    canvas.style.background = rcRaceMapColors.land;
  }
}

baseMapLayer.getMaplibreMap?.().on("load", applyRcRaceMapStyle);
baseMapLayer.getMaplibreMap?.().on("styledata", applyRcRaceMapStyle);

let venues = [];
let races = [];
let seriesCatalog = [];
let hosts = [];
let hostsByOrgId = new Map();
let hostsById = new Map();
let venueLookup = new Map();
let markers = new Map();
let activeRaceId = null;
let activeVenueId = null;
let pinnedVenueId = null;
let isSwitchingMarkerPopup = false;
let selectedRange = "2";
let selectedSeries = "all";
let showOpenOnly = false;
let selectedFavoriteFilter = "all";
let isFilterPanelOpen = false;
const expandedClassRaceIds = new Set();

const favoriteHostStorageKey = "rcRaceMapFavoriteHostIds";
const favoriteVenueStorageKey = "rcRaceMapFavoriteVenueIds";
const favoriteFilterStorageKey = "rcRaceMapFavoriteFilter";

function loadFavoriteFilter() {
  try {
    return localStorage.getItem(favoriteFilterStorageKey) === "favorites"
      ? "favorites"
      : "all";
  } catch {
    return "all";
  }
}

function saveFavoriteFilter(value) {
  try {
    localStorage.setItem(
      favoriteFilterStorageKey,
      value === "favorites" ? "favorites" : "all"
    );
  } catch {
    // Local storage is optional for this UI preference.
  }
}

selectedFavoriteFilter = loadFavoriteFilter();

function getFavoriteHostIds() {
  try {
    const raw = localStorage.getItem(favoriteHostStorageKey);
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean).map(String);
  } catch {
    return [];
  }
}

function saveFavoriteHostIds(ids) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean).map(String))];
  localStorage.setItem(favoriteHostStorageKey, JSON.stringify(uniqueIds));
}

function isFavoriteHostId(hostId) {
  if (!hostId) return false;
  return getFavoriteHostIds().includes(String(hostId));
}

function toggleFavoriteHost(hostId) {
  if (!hostId) return;

  const id = String(hostId);
  const favoriteIds = getFavoriteHostIds();

  if (favoriteIds.includes(id)) {
    saveFavoriteHostIds(favoriteIds.filter(item => item !== id));
  } else {
    saveFavoriteHostIds([...favoriteIds, id]);
  }
}

function favoriteHostButtonHtml(hostId, label = "Ausrichter") {
  if (!hostId) return "";

  const active = isFavoriteHostId(hostId);
  const title = active
    ? `${label} aus Favoriten entfernen`
    : `${label} als Favorit markieren`;

  return `<button
    class="venue-favorite-button${active ? " active" : ""}"
    type="button"
    data-favorite-host-id="${escapeHtml(hostId)}"
    title="${escapeHtml(title)}"
    aria-label="${escapeHtml(title)}"
    aria-pressed="${active ? "true" : "false"}"
  ><span class="favorite-toggle-icon" aria-hidden="true">★</span></button>`;
}


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
  ><span class="favorite-toggle-icon" aria-hidden="true">★</span></button>`;
}

function raceFavoriteVenueId(race) {
  const venue = venueForRace(race);
  return venue?.id || null;
}

function raceHostId(race) {
  if (race?.hostId) return String(race.hostId);
  if (race?.hostName) return slugifyMatchValue(race.hostName);

  const venue = venueForRace(race);
  if (venue?.hostId) return String(venue.hostId);
  if (venue?.hostName) return slugifyMatchValue(venue.hostName);

  return null;
}

function raceHostName(race) {
  return (
    race?.hostName ||
    race?.organizerName ||
    race?.organiserName ||
    race?.organizer ||
    race?.organiser ||
    raceHostId(race) ||
    "Unbekannter Ausrichter"
  );
}

function isFavoriteRaceHost(race) {
  return isFavoriteHostId(raceHostId(race));
}

function isFavoriteRace(race) {
  return isFavoriteRaceHost(race);
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

function updateFavoriteFilterUi() {
  if (!favoriteFilter) return;

  favoriteFilter
    .querySelectorAll("button[data-favorite-filter]")
    .forEach(button => {
      const active = button.dataset.favoriteFilter === selectedFavoriteFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
}

function updateRegistrationVisibilityUi() {
  if (!registrationVisibilityFilter) return;

  registrationVisibilityFilter
    .querySelectorAll("button[data-registration-visibility]")
    .forEach(button => {
      const active = button.dataset.registrationVisibility === (showOpenOnly ? "open" : "all");
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
}

function activePillColor(button) {
  return button?.dataset.favoriteFilter === "favorites"
    ? "#C8B090"
    : "#213769";
}

function updateSlidingPill(control) {
  if (!control) return;

  const activeButton = control.querySelector("button.active");
  if (!activeButton) return;

  control.style.setProperty("--pill-x", `${activeButton.offsetLeft}px`);
  control.style.setProperty("--pill-width", `${activeButton.offsetWidth}px`);
  control.style.setProperty("--pill-color", activePillColor(activeButton));
  control.classList.add("is-pill-ready");
}

function updateSlidingPills() {
  [rangeFilter, favoriteFilter, registrationVisibilityFilter].forEach(updateSlidingPill);
}

let slidingPillFrame = null;

function scheduleSlidingPillUpdate() {
  if (slidingPillFrame !== null) {
    cancelAnimationFrame(slidingPillFrame);
  }

  slidingPillFrame = requestAnimationFrame(() => {
    slidingPillFrame = null;
    updateSlidingPills();
  });
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

  if (selectedFavoriteFilter === "favorites") {
    chips.push(`
      <button class="active-filter-chip" type="button" data-clear-filter="favorites">
        Favoriten<span aria-hidden="true">×</span>
      </button>
    `);
  }

  if (showOpenOnly) {
    chips.push(`
      <button class="active-filter-chip" type="button" data-clear-filter="registration">
        Offen<span aria-hidden="true">×</span>
      </button>
    `);
  }

  activeFilterChips.innerHTML = chips.join("");
  activeFilterChips.classList.toggle("is-empty", chips.length === 0);
}

function syncFilterUi() {
  updateFilterPanelState();
  updateFavoriteFilterUi();
  updateRegistrationVisibilityUi();
  updateSlidingPills();
  renderActiveFilterChips();
}


const fallbackSeriesCatalog = [
  {
    id: "ets",
    name: "Euro Touring Series",
    shortName: "ETS",
    scope: "international",
    aliases: ["ETS", "Euro Touring Series"]
  },
  {
    id: "tos",
    name: "ToniSport Onroad Series",
    shortName: "TOS",
    scope: "national",
    aliases: ["TOS", "ToniSport Onroad Series", "Tonisport Onroad Series"]
  },
  {
    id: "tec",
    name: "Tamiya Euro Cup",
    shortName: "TEC",
    scope: "national",
    aliases: ["TEC", "Tamiya Euro Cup", "Tamiya Euro-Cup", "TAMIYA EURO-CUP"]
  },
  {
    id: "sk",
    name: "Sportkreis",
    shortName: "SK",
    scope: "national",
    aliases: ["SK", "SK Lauf", "SK-Lauf", "Sportkreis", "Sportkreis-Meisterschaft"]
  },
  {
    id: "rck-challenge",
    name: "RCK Challenge",
    scope: "national",
    aliases: ["RCK Challenge", "RCK-Challenge", "RCK Challenge Süd", "RCK Challenge Nord"]
  },
  {
    id: "rck-kleinserie",
    name: "RCK Kleinserie",
    scope: "national",
    aliases: ["RCK Kleinserie", "RCK-Kleinserie", "RCK KleinSerie"]
  },
  {
    id: "btm",
    name: "Berlin Touring Masters",
    shortName: "BTM",
    scope: "regional",
    aliases: ["BTM", "Berlin Touring Masters"]
  },
  {
    id: "ostmasters",
    name: "Ostmasters",
    scope: "regional",
    aliases: ["Ostmasters"]
  },
  {
    id: "tamico-offroad-cup",
    name: "Tamico Offroad Cup",
    scope: "regional",
    aliases: ["Tamico Offroad Cup", "TAMICO Offroad Cup"]
  }
];

function normalizeSeriesText(value = "") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[–—]/g, "-")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function seriesKeyFromValue(value = "") {
  return normalizeSeriesText(value).replace(/\s+/g, "-");
}

function seriesCatalogDisplayName(item) {
  if (!item) return "";
  if (item.displayName) return item.displayName;
  if (item.shortName && item.name && !String(item.name).includes(String(item.shortName))) {
    return `${item.name} (${item.shortName})`;
  }
  return item.name || item.shortName || item.id || "";
}

function normalizeSeriesCatalog(items) {
  const input = Array.isArray(items) && items.length ? items : fallbackSeriesCatalog;

  return input
    .filter(item => item && (item.name || item.shortName || item.id))
    .map(item => {
      const name = String(item.name || item.displayName || item.shortName || item.id).trim();
      const shortName = item.shortName ? String(item.shortName).trim() : "";
      const id = String(item.id || seriesKeyFromValue(shortName || name)).trim();
      const aliases = [
        id,
        name,
        shortName,
        item.displayName,
        ...(Array.isArray(item.aliases) ? item.aliases : [])
      ]
        .filter(Boolean)
        .map(value => String(value).trim())
        .filter(Boolean);

      return {
        ...item,
        id,
        name,
        shortName,
        key: id,
        displayName: seriesCatalogDisplayName({ ...item, id, name, shortName }),
        aliases: [...new Set(aliases)],
        matchValues: [...new Set(aliases.map(normalizeSeriesText).filter(Boolean))]
      };
    });
}

function seriesCatalogItemForValue(value) {
  const normalized = normalizeSeriesText(value);
  if (!normalized) return null;

  return seriesCatalog.find(item =>
    item.matchValues?.includes(normalized) ||
    normalizeSeriesText(item.key) === normalized
  ) || null;
}

function seriesCatalogItemForKey(key) {
  const normalized = normalizeSeriesText(key);
  if (!normalized) return null;

  return seriesCatalog.find(item =>
    normalizeSeriesText(item.key) === normalized ||
    item.matchValues?.includes(normalized)
  ) || null;
}

function seriesFilterValue(series) {
  const item = seriesCatalogItemForValue(series);
  return item?.key || series;
}

function seriesScopeGroup(item) {
  const scope = normalizeSeriesText(item?.scope || item?.level || "");

  if (
    scope === "international" ||
    scope === "national" ||
    scope === "ueberregional" ||
    scope === "uberregional" ||
    scope === "overregional"
  ) {
    return "overregional";
  }

  if (scope === "regional" || scope === "local" || scope === "lokal") {
    return "regional";
  }

  return "regional";
}


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
  const item = seriesCatalogItemForKey(series) || seriesCatalogItemForValue(series);
  return item?.displayName || String(series || "");
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
  return selectedSeries === "all" ||
    raceSeries(race).some(series => seriesFilterValue(series) === selectedSeries);
}

function matchesFavoriteFilter(race) {
  return selectedFavoriteFilter !== "favorites" || isFavoriteRace(race);
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

function formatDataUpdateTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";

  const datePart = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);

  const timePart = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);

  return `Stand ${datePart} | ${timePart} Uhr`;
}

function resultLineText(count, detail = "gefunden") {
  const updateTimestamp = formatDataUpdateTimestamp(dataLastUpdatedAt);
  const base = `${count} Rennen ${detail}`;

  return updateTimestamp ? `${base} | ${updateTimestamp}` : base;
}

function emptyVenueResultLineText() {
  const updateTimestamp = formatDataUpdateTimestamp(dataLastUpdatedAt);
  const base = "Keine kommenden Rennen an dieser Strecke";

  return updateTimestamp ? `${base} | ${updateTimestamp}` : base;
}

function responseLastModifiedDate(response) {
  const value = response?.headers?.get?.("last-modified");
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function latestResponseLastModified(responses = []) {
  return responses
    .map(responseLastModifiedDate)
    .filter(Boolean)
    .sort((a, b) => b - a)[0] || null;
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
  if (count >= 120) return rcRaceMapColors.marker;
  if (count >= 70) return "#2D447C";
  if (count >= 40) return "#405B94";
  if (count >= 20) return "#5A73AA";
  if (count >= 10) return "#788FC0";
  return "#9AAAD0";
}

function markerFavoriteColorForRegistrationCount(count) {
  if (count >= 120) return rcRaceMapColors.favorite;
  if (count >= 70) return "#D0BA9C";
  if (count >= 40) return "#D9C7AE";
  if (count >= 20) return "#E1D2BF";
  if (count >= 10) return "#E9DECF";
  return "#F0E8DD";
}

function ensureRegistrationStatusStyles() {
  if (document.getElementById("registration-status-styles")) return;

  const style = document.createElement("style");
  style.id = "registration-status-styles";
  style.textContent = `
    .race-card.registration-upcoming {
      background: #FAF8F3;
      border-color: #DDDDDD;
    }

    .race-card.registration-closed {
      background: #D6D6D6;
      border-color: #BEBEBE;
    }

    .race-card.registration-closed .race-date,
    .race-card.registration-closed .race-name,
    .race-card.registration-closed .race-venue,
    .race-card.registration-closed .tag {
      color: #716F6F;
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
      background: var(--status-open, #73FF60);
    }

    .registration-dot-upcoming {
      background: var(--status-upcoming, #FFA700);
    }

    .registration-dot-login_required {
      background: var(--status-upcoming, #FFA700);
    }

    .registration-dot-closed {
      background: var(--status-closed, #E51354);
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
      color: var(--status-closed, #E51354);
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
    .map-marker-venue-inactive,
    .map-marker-venue-inactive-favorite {
      cursor: pointer;
      pointer-events: auto;
    }

    .map-marker-open *,
    .map-marker-closed *,
    .map-marker-venue-inactive *,
    .map-marker-venue-inactive-favorite * {
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
      background: var(--map-marker, #213769) !important;
    }

    .map-marker-active-replacement-closed {
      background: var(--status-closed, #E51354) !important;
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
      --venue-pin-color: var(--map-marker, #213769);
    }

    .map-marker-venue-inactive:not(.map-marker-active-replacement),
    .map-marker-venue-inactive-favorite {
      display: block;
      width: 10px;
      height: 12px;
      border: 0;
      background-color: transparent !important;
      background-repeat: no-repeat;
      background-position: center bottom;
      background-size: contain;
      box-sizing: border-box;
      box-shadow: none;
    }

    .map-marker-active-replacement.map-marker-venue-inactive {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.9);
      box-sizing: border-box;
      box-shadow: none;
    }

    .map-marker-venue-inactive-favorite {
      --venue-pin-color: var(--favorite, #C8B090);
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
  const text = normalizeSeriesText(name);

  if (!text) return [];

  const matches = [];

  for (const item of seriesCatalog) {
    const matched = item.matchValues?.some(alias => {
      if (!alias) return false;

      if (alias.length <= 3) {
        return new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(text);
      }

      return text.includes(alias);
    });

    if (matched) matches.push(item.shortName || item.name || item.key);
  }

  if (matches.length) return [...new Set(matches)];

  const rules = [
    { label: "BTM", re: /berlin touring masters|\bbtm\b/i },
    { label: "ETS", re: /euro touring series|\bets\b/i },
    { label: "Ostmasters", re: /ostmasters/i },
    { label: "RCK Challenge", re: /rck[ -]?challenge/i },
    { label: "RCK Kleinserie", re: /rck[ -]?kleinserie/i },
    { label: "SK", re: /\bsk[- ]?lauf\b|sk lauf|sportkreis/i },
    { label: "Tamico Offroad Cup", re: /tamico offroad cup|tamico/i },
    { label: "TEC", re: /tamiya euro[- ]?cup|\btec\b/i },
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

function slugifyMatchValue(value = "") {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function venueIdsForMatching(venue) {
  return [
    venue?.id,
    venue?.venueId,
    venue?.myrcmOrgId ? `myrcm-${venue.myrcmOrgId}` : null,
    ...(Array.isArray(venue?.aliases) ? venue.aliases : [])
  ]
    .filter(Boolean)
    .map(String);
}

function addVenueLookupValue(value, venue) {
  if (!value || !venue) return;

  const raw = String(value);
  const slug = slugifyMatchValue(raw);

  if (raw && !venueLookup.has(raw)) {
    venueLookup.set(raw, venue);
  }

  if (slug && !venueLookup.has(slug)) {
    venueLookup.set(slug, venue);
  }
}

function buildVenueLookup() {
  venueLookup = new Map();

  venues.forEach(venue => {
    venueIdsForMatching(venue).forEach(value => addVenueLookupValue(value, venue));
  });
}

function venueById(id) {
  if (!id) return null;

  const lookupId = String(id);
  const lookupSlug = slugifyMatchValue(lookupId);

  return (
    venueLookup.get(lookupId) ||
    venueLookup.get(lookupSlug) ||
    null
  );
}

function compactAddressValue(value = "") {
  return slugifyMatchValue(
    String(value)
      .replace(/strasse/gi, "str")
      .replace(/straße/gi, "str")
      .replace(/\./g, "")
  );
}

function venueMatchesRaceAddress(venue, race) {
  const raceAddress = compactAddressValue(race?.venueAddress || "");
  if (!raceAddress) return false;

  const venueAddress = compactAddressValue(venue?.address || venue?.venueAddress || "");
  if (!venueAddress) return false;

  const racePostalCode = String(race?.venuePostalCode || "").trim();
  const venuePostalCode = String(venue?.postalCode || venue?.venuePostalCode || "").trim();

  if (racePostalCode && venuePostalCode && racePostalCode !== venuePostalCode) return false;

  return venueAddress.includes(raceAddress) || raceAddress.includes(venueAddress);
}

function venueMatchesRaceNameAndCity(venue, race) {
  const raceVenueName = slugifyMatchValue(race?.venueName || "");
  const venueName = slugifyMatchValue(venue?.name || venue?.venueName || "");
  if (!raceVenueName || !venueName || raceVenueName !== venueName) return false;

  const raceCity = slugifyMatchValue(
    race?.venueCity ||
    race?.venueLocation ||
    race?.rckLocation ||
    ""
  );

  if (!raceCity) return true;

  const venueCities = [
    venue?.city,
    venue?.location,
    venue?.venueLocation,
    venue?.rckLocation
  ]
    .filter(Boolean)
    .map(slugifyMatchValue);

  return venueCities.length === 0 || venueCities.includes(raceCity);
}

function venueByRaceAddress(race) {
  if (!race?.venueAddress) return null;
  return venues.find(venue => venueMatchesRaceAddress(venue, race)) || null;
}

function venueByRaceNameAndCity(race) {
  if (!race?.venueName) return null;
  return venues.find(venue => venueMatchesRaceNameAndCity(venue, race)) || null;
}

function venueForRace(race) {
  if (!race) return null;

  return (
    venueById(race.venueId) ||
    venueByRaceAddress(race) ||
    venueByRaceNameAndCity(race) ||
    null
  );
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

function hostWebsiteForRace(race) {
  const hostId = raceHostId(race);
  const host = hostId ? hostsById.get(String(hostId)) : null;

  if (host?.website) return normalizeUrl(host.website);

  const hostOrgId =
    orgIdFromValue(race?.detailUrl) ||
    orgIdFromValue(race?.url) ||
    orgIdFromValue(race?.myrcmUrl);

  if (hostOrgId) {
    const website = hostWebsiteByOrgId(hostOrgId);
    if (website) return website;

    const target = new URL("https://www.myrcm.ch/myrcm/main");
    target.searchParams.set("hId[1]", "org");
    target.searchParams.set("dId[O]", hostOrgId);
    target.searchParams.set("pLa", "en");
    return target.toString();
  }

  return null;
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
  const directVenueWebsite = normalizeUrl(race?.venueWebsite);
  if (directVenueWebsite) return directVenueWebsite;

  const venue = venueForRace(race);

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
    : `<span class="venue-name-text">${name}</span>`;

  return `<span class="venue-name">${nameHtml}</span>`;
}

function normalizedDisplayText(value = "") {
  return slugifyMatchValue(value);
}

function normalizedRelationId(value = "") {
  return slugifyMatchValue(String(value ?? ""));
}

function relationIdsFromValues(values = []) {
  return new Set(
    values
      .filter(value => value !== null && value !== undefined && value !== "")
      .map(normalizedRelationId)
      .filter(Boolean)
  );
}

function raceHostAndVenueAreSame(race) {
  const venue = venueForRace(race);
  if (!venue) return false;

  const hostIds = relationIdsFromValues([
    race?.hostId,
    raceHostId(race),
    race?.hostName,
    raceHostName(race)
  ]);

  if (!hostIds.size) return false;

  const venueHostIds = relationIdsFromValues([
    venue.hostId,
    ...(Array.isArray(venue.hostIds) ? venue.hostIds : []),
    venue.myrcmOrgId ? `myrcm-${venue.myrcmOrgId}` : null
  ]);

  for (const hostId of hostIds) {
    if (venueHostIds.has(hostId)) return true;
  }

  const hostName = normalizedDisplayText(raceHostName(race));
  const venueName = normalizedDisplayText(venue?.name || race?.venueName || "");

  return Boolean(hostName && venueName && hostName === venueName);
}

function raceVenueMetaHtml(race) {
  if (!hasMappableVenue(race)) return "";
  if (raceHostAndVenueAreSame(race)) return "";

  return `<div class="race-venue">${mapPinIconHtml("race-venue-pin")}${raceVenueNameHtml(race)}</div>`;
}

function raceHostNameHtml(race) {
  const hostId = raceHostId(race);
  const hostName = raceHostName(race);
  const favorite = favoriteHostButtonHtml(hostId, hostName);
  const favoriteClass = isFavoriteHostId(hostId) ? " venue-link-favorite" : "";
  const website = hostWebsiteForRace(race);

  const hostHtml = website
    ? `<a class="venue-link${favoriteClass}" href="${escapeHtml(website)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escapeHtml(hostName)}</a>`
    : `<span class="host-name${favoriteClass}">${escapeHtml(hostName)}</span>`;

  return `<span class="venue-name-with-favorite${favoriteClass ? " is-favorite" : ""}">${favorite}${hostHtml}</span>`;
}

function raceVenueNameHtml(race) {
  const name = escapeHtml(venueDisplayName(race));
  const website = raceWebsite(race);
  const nameHtml = website
    ? `<a class="venue-link" href="${escapeHtml(website)}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">${name}</a>`
    : `<span class="venue-name-text">${name}</span>`;

  return `<span class="venue-name">${nameHtml}</span>`;
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
        <span class="race-link-text">Nennung ↗</span>
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
  const venue = venueForRace(race);
  return Boolean(venue && hasLatLng(venue));
}

function hasVerifiedVenue(race) {
  const venue = venueForRace(race);
  return Boolean(venue && hasLatLng(venue) && !isUnverifiedVenue(venue));
}

function venueDisplayName(race) {
  const venue = venueForRace(race);

  return (
    race?.venueName ||
    venue?.name ||
    race?.venueLocation ||
    race?.venueId ||
    "Unbekannte Strecke"
  );
}

function raceSearchText(race) {
  const venue = venueForRace(race);

  return [
    race.name,
    race.venueName,
    race.venueLocation,
    race.venueId,
    race.hostId,
    race.hostName,
    raceHostName(race),
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
  if (!race || !venueId) return false;

  const venue = venueById(venueId);
  if (!venue) return false;

  const raceVenue = venueForRace(race);
  return Boolean(raceVenue && raceVenue.id === venue.id);
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
    .filter(matchesFavoriteFilter)
    .filter(race => !query || raceSearchText(race).includes(query))
    .sort((a, b) => {
      const favoriteOrder = Number(isFavoriteRace(b)) - Number(isFavoriteRace(a));
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

    const markerWidth = hasUpcomingRaces ? Math.round(raceMapMarkerBaseWidth * markerScale) : 10;
    const markerHeight = hasUpcomingRaces ? Math.round(raceMapMarkerBaseHeight * markerScale) : 12;

    const markerAnchor = hasUpcomingRaces
      ? [Math.round(markerWidth / 2), markerHeight]
      : [Math.round(markerWidth / 2), markerHeight];

    const replacementClass = hasActiveRegistration(venueRaces)
      ? "map-marker-active-replacement-open"
      : "map-marker-active-replacement-closed";

    const isFavoriteVenue = venueRaces.some(race => isFavoriteRaceHost(race));

    let markerColor = isFavoriteVenue
      ? markerFavoriteColorForRegistrationCount(registrationTotal)
      : hasUpcomingRaces
        ? markerColorForRegistrationCount(registrationTotal)
        : "rgba(33, 55, 105, 0.58)";

    if (!hasUpcomingRaces && isFavoriteVenue) {
      markerColor = rcRaceMapColors.favorite;
    }

    const markerSvg = raceMapMarkerSvgDataUri(markerColor, markerWidth, markerHeight);

    const inactiveClass = isFavoriteVenue
      ? "map-marker-venue-inactive-favorite"
      : "map-marker-venue-inactive";
    const inactiveMarkerSvg = mapPinSvgDataUri(markerColor, markerWidth, markerHeight);

    const markerHtml = hasUpcomingRaces
      ? `<div class="map-marker-switcher map-marker-visual" style="width: ${markerWidth}px; height: ${markerHeight}px; --marker-delay: 0ms;">
          <div class="${markerClass}" style="width: ${markerWidth}px; height: ${markerHeight}px; background-image: url('${markerSvg}');"></div>
          <div class="map-marker-venue-inactive map-marker-active-replacement ${replacementClass}" style="background: ${markerColor} !important;"></div>
        </div>`
      : `<div class="${inactiveClass} map-marker-visual" style="width: ${markerWidth}px; height: ${markerHeight}px; background-image: url('${inactiveMarkerSvg}'); --marker-delay: 0ms;"></div>`;

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
          resultLine.textContent = resultLineText(venueRaces.length, "an dieser Strecke");
        } else {
          renderList([]);
          resultLine.textContent = emptyVenueResultLineText();
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
        resultLine.textContent = resultLineText(venueRaces.length, "an dieser Strecke");
      } else {
        renderList([]);
        resultLine.textContent = emptyVenueResultLineText();
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

  const venue = venueForRace(race);

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
  const venue = venueForRace(race);
  if (!venue) return;

  activeVenueId = venue.id;
  activeRaceId = null;
  updateAppModeClass();

  const baseList = filteredRaces();
  const venueList = baseList.filter(item => isRaceAtVenue(item, activeVenueId));

  renderList(venueList);
  resultLine.textContent = resultLineText(venueList.length, "an dieser Strecke");

  map.setView([venue.lat, venue.lng], 12);

  const marker = markers.get(venue.id);
  if (marker) {
    marker.setPopupContent(buildPopup(venue, venueList, latestPastRaceForVenue(venue)));
    marker.openPopup();
  }
}
function renderList(list) {
  resultLine.textContent = resultLineText(list.length);
  raceList.innerHTML = "";

  if (!list.length) {
    raceList.innerHTML = `<div class="empty-state">Keine Rennen für diesen Filter gefunden.</div>`;
    return;
  }

  const hasFavoriteRaces = list.some(isFavoriteRaceHost);
  const hasNormalRaces = list.some(race => !isFavoriteRaceHost(race));
  const showSectionDividers = hasFavoriteRaces && hasNormalRaces;
  let didRenderFavoriteDivider = false;
  let didRenderNormalDivider = false;

  for (const race of list) {
    const isFavorite = isFavoriteRaceHost(race);

    if (showSectionDividers && isFavorite && !didRenderFavoriteDivider) {
      const divider = document.createElement("div");
      divider.className = "race-section-divider race-section-divider-favorites";
      divider.textContent = "★ Favorisierte Ausrichter";
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
            ${series.map(item => `<span class="tag">${escapeHtml(seriesDisplayName(item))}</span>`).join("")}
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
          <div class="race-host">${raceHostNameHtml(race)}</div>
          ${raceVenueMetaHtml(race)}
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
        if (event.target.closest("[data-favorite-host-id]")) return;
        focusRace(race);
      });

      card.addEventListener("keydown", event => {
        if (event.target.closest("[data-favorite-venue-id]")) return;
        if (event.target.closest("[data-favorite-host-id]")) return;
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
    resultLine.textContent = resultLineText(venueList.length, "an dieser Strecke");
    return;
  }

  renderList(filteredRaces());
}

document.addEventListener("click", event => {
  const favoriteVenueButton = event.target.closest("[data-favorite-venue-id]");
  const favoriteHostButton = event.target.closest("[data-favorite-host-id]");
  const favoriteButton = favoriteVenueButton || favoriteHostButton;

  if (!favoriteButton) return;

  event.preventDefault();
  event.stopPropagation();

  if (favoriteHostButton) {
    toggleFavoriteHost(favoriteHostButton.dataset.favoriteHostId);
  } else if (favoriteVenueButton) {
    toggleFavoriteVenue(favoriteVenueButton.dataset.favoriteVenueId);
  }

  const list = filteredRaces();
  updateMarkers(list, false);

  if (activeVenueId) {
    const venueList = list.filter(race => isRaceAtVenue(race, activeVenueId));
    renderList(venueList);
    resultLine.textContent = resultLineText(venueList.length, "an dieser Strecke");
  } else {
    renderList(list);
    resultLine.textContent = resultLineText(list.length);
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
  const seriesByKey = new Map();

  races.forEach(race => {
    raceSeries(race).forEach(rawSeries => {
      const key = seriesFilterValue(rawSeries);
      if (!key) return;

      const item = seriesCatalogItemForKey(key) || seriesCatalogItemForValue(rawSeries) || {
        key,
        name: String(rawSeries),
        displayName: String(rawSeries),
        scope: "regional"
      };

      if (!seriesByKey.has(key)) {
        seriesByKey.set(key, item);
      }
    });
  });

  seriesFilter.innerHTML = `<option value="all">Alle Serien</option>`;

  const groups = {
    overregional: [],
    regional: [],
    other: []
  };

  for (const item of seriesByKey.values()) {
    const group = seriesScopeGroup(item);
    if (group === "overregional") {
      groups.overregional.push(item);
    } else if (group === "regional") {
      groups.regional.push(item);
    } else {
      groups.other.push(item);
    }
  }

  const sortByDisplayName = (a, b) =>
    seriesDisplayName(a.key).localeCompare(seriesDisplayName(b.key), "de", {
      sensitivity: "base"
    });

  groups.overregional.sort(sortByDisplayName);
  groups.regional.sort(sortByDisplayName);
  groups.other.sort(sortByDisplayName);

  const appendGroup = (label, items) => {
    if (!items.length) return;

    const group = document.createElement("optgroup");
    group.label = label;

    items.forEach(item => {
      const option = document.createElement("option");
      option.value = item.key;
      option.textContent = seriesDisplayName(item.key);
      group.appendChild(option);
    });

    seriesFilter.appendChild(group);
  };

  appendGroup("Überregional", groups.overregional);
  appendGroup("Regional", groups.regional);
  appendGroup("Weitere Serien", groups.other);
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
      resultLine.textContent = resultLineText(venueList.length, "an dieser Strecke");
    } else {
      const venue = venues.find(item => item.id === activeVenueId);
      const latestPastRace = venue ? latestPastRaceForVenue(venue) : null;

      if (latestPastRace) {
        activeRaceId = null;
        renderList([]);
        resultLine.textContent = emptyVenueResultLineText();
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

if (favoriteFilter) {
  favoriteFilter.addEventListener("click", event => {
    const button = event.target.closest("button[data-favorite-filter]");
    if (!button) return;

    selectedFavoriteFilter = button.dataset.favoriteFilter === "favorites"
      ? "favorites"
      : "all";
    saveFavoriteFilter(selectedFavoriteFilter);
    activeVenueId = null;
    activeRaceId = null;
    updateAppModeClass();
    updateFavoriteFilterUi();

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

    if (button.dataset.clearFilter === "favorites") {
      selectedFavoriteFilter = "all";
      saveFavoriteFilter(selectedFavoriteFilter);
    }

    if (button.dataset.clearFilter === "registration") {
      showOpenOnly = false;
      updateRegistrationVisibilityUi();
    }

    activeVenueId = null;
    activeRaceId = null;
    updateAppModeClass();
    render();
  });
}

window.addEventListener("resize", scheduleSlidingPillUpdate);

if (document.fonts?.ready) {
  document.fonts.ready
    .then(scheduleSlidingPillUpdate)
    .catch(() => {});
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

async function responseJsonOrFallback(response, fallback) {
  try {
    if (!response?.ok) return fallback;
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

function mergeVenues(baseVenues, candidateVenues, options = {}) {
  const byId = new Map();
  const requireVerifiedAddress = options.requireVerifiedAddress !== false;

  for (const venue of baseVenues) {
    if (!venue?.id) continue;
    byId.set(venue.id, venue);
  }

  for (const venue of candidateVenues) {
    if (!venue?.id || !hasLatLng(venue)) continue;
    if (requireVerifiedAddress && !venue.addressVerifiedFromPdf) continue;
    if (byId.has(venue.id)) continue;
    byId.set(venue.id, venue);
  }

  return Array.from(byId.values());
}

async function init() {
  ensureRegistrationStatusStyles();

  const cacheBuster = Date.now();

  const [venuesResponse, racesResponse, rckRacesRawResponse, rckVenueCandidatesResponse, hostsResponse, myrcmHostsResponse, seriesCatalogResponse] = await Promise.all([
    fetch(`venues.json?v=${cacheBuster}`),
    fetch(`races.json?v=${cacheBuster}`),
    fetch(`rck-races.json?v=${cacheBuster}`).catch(() => null),
    fetchJsonOrFallback(`rck-venue-candidates.json?v=${cacheBuster}`, []),
    fetchJsonOrFallback(`hosts.json?v=${cacheBuster}`, []),
    fetchJsonOrFallback(`myrcm-hosts-germany.json?v=${cacheBuster}`, []),
    fetchJsonOrFallback(`series.json?v=${cacheBuster}`, fallbackSeriesCatalog)
  ]);

  dataLastUpdatedAt = latestResponseLastModified([
    venuesResponse,
    racesResponse,
    rckRacesRawResponse
  ]);

  const baseVenues = await venuesResponse.json();
  const myrcmRaces = await racesResponse.json();
  const rckRacesResponse = await responseJsonOrFallback(rckRacesRawResponse, []);
  const rckRaces = Array.isArray(rckRacesResponse) ? rckRacesResponse : [];
  const rckVenueCandidates = Array.isArray(rckVenueCandidatesResponse) ? rckVenueCandidatesResponse : [];
  seriesCatalog = normalizeSeriesCatalog(seriesCatalogResponse);

  venues = mergeVenues(
    baseVenues,
    rckVenueCandidates,
    { requireVerifiedAddress: true }
  );
  buildVenueLookup();

  races = [
    ...myrcmRaces
      .filter(race => !isRckEventFromMyRcm(race))
      .map(race => normalizeRaceFromSource(race, "myrcm")),
    ...rckRaces
      .filter(isUsefulRckRace)
      .map(race => normalizeRaceFromSource(race, "rck"))
  ];

  const hostRecords = Array.isArray(hostsResponse) ? hostsResponse : [];
  const myrcmHostRecords = Array.isArray(myrcmHostsResponse) ? myrcmHostsResponse : [];

  hosts = [
    ...hostRecords,
    ...myrcmHostRecords
  ];

  hostsById = new Map(
    hosts
      .filter(host => host?.id)
      .map(host => [String(host.id), host])
  );

  hostsByOrgId = new Map(
    hosts
      .filter(host => host?.orgId || host?.myrcmOrgId)
      .map(host => [String(host.orgId || host.myrcmOrgId), host])
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
