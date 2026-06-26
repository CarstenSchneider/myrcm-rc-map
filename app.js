const app = document.getElementById("app");
const raceList = document.getElementById("raceList");
const resultLine = document.getElementById("resultLine");
const searchInput = document.getElementById("searchInput");
const seriesFilter = document.getElementById("seriesFilter");
const rangeFilter = document.getElementById("rangeFilter");
const mapWideButton = document.getElementById("mapWideButton");
const listWideButton = document.getElementById("listWideButton");
const filterToggleButton = document.getElementById("filterToggleButton");
const mobFilterBtn = document.getElementById("mobFilterBtn");
const activeFilterChips = document.getElementById("activeFilterChips");
const registrationVisibilityFilter = document.getElementById("registrationVisibilityFilter");
const favoriteFilter = document.getElementById("favoriteFilter");
let dataLastUpdatedAt = null;

const map = L.map("map", {
  scrollWheelZoom: true,
  zoomControl: false,
  attributionControl: false,
  minZoom: 6
}).setView([48.5, 10.5], 6);

// Bounds are wider than DACH: panToVisible shifts the actual map center south by up
// to ~200px to place venues in the visible area above the mobile drawer. Leaflet's
// _limitCenter enforces bounds against the full container view (not the visible area),
// so the south edge needs room for that shift + container half-height at zoom 6.
const MAX_BOUNDS = [[35.0, -5.0], [62.0, 30.0]];
map.setMaxBounds(MAX_BOUNDS);


L.control.zoom({
  position: "bottomleft"
}).addTo(map);

let _userLocationLayer = null;
let _userLatLng = null;
let _locateBtn = null;

const LocateControl = L.Control.extend({
  options: { position: "bottomleft" },
  onAdd() {
    _locateBtn = L.DomUtil.create("button", "locate-btn");
    _locateBtn.type = "button";
    _locateBtn.setAttribute("aria-label", "Meinen Standort anzeigen");
    _locateBtn.title = "Meinen Standort anzeigen";
    _locateBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>`;
    L.DomEvent.on(_locateBtn, "click", L.DomEvent.stop);
    L.DomEvent.on(_locateBtn, "click", () => locateUser(_locateBtn));
    return _locateBtn;
  }
});
new LocateControl().addTo(map);

const COUNTRY_BOUNDS = {
  DE: [[47.2, 5.8], [55.1, 15.1]],
  AT: [[46.2, 9.4], [49.0, 17.2]],
  CH: [[45.7, 5.9], [47.9, 10.6]],
  all: [[45.7, 5.8], [55.1, 17.5]],
};

function detectCountryFromLocale() {
  // Language tags first: "de-AT" → "AT", "fr-CH" → "CH", "de-DE" → "DE"
  const langs = Array.from(navigator.languages?.length ? navigator.languages : [navigator.language]);
  for (const lang of langs) {
    const match = lang.toUpperCase().match(/-([A-Z]{2})$/);
    if (match && COUNTRY_BOUNDS[match[1]]) return match[1];
  }
  // Timezone fallback: handles bare "de" locale in Germany/Austria/Switzerland
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tzCountry = { "Europe/Berlin": "DE", "Europe/Busingen": "DE", "Europe/Vienna": "AT", "Europe/Zurich": "CH" };
    if (tzCountry[tz]) return tzCountry[tz];
  } catch (_) {}
  return "all";
}

function fitToCountry(country) {
  const bounds = COUNTRY_BOUNDS[country] || COUNTRY_BOUNDS.all;
  fitMapToBounds(bounds, { maxZoom: 10, skipIconShift: true });
}

const _validCountries = new Set(["all", "DE", "AT", "CH"]);
const _savedCountry = localStorage.getItem("rcRaceMapCountry");
let selectedCountry = _validCountries.has(_savedCountry) ? _savedCountry : detectCountryFromLocale();
let _zoomToCountryPending = false;

const countryFlags = [
  { country: "all", code: "eu", label: "Alle Länder" },
  { country: "DE",  code: "de", label: "Deutschland" },
  { country: "AT",  code: "at", label: "Österreich" },
  { country: "CH",  code: "ch", label: "Schweiz" },
];
let _countryPill = null;

function updateCountryPill() {
  if (!_countryPill) return;
  const ordered = [
    countryFlags.find(f => f.country === selectedCountry),
    ...countryFlags.filter(f => f.country !== selectedCountry),
  ];
  _countryPill.innerHTML = ordered.map(f =>
    `<button class="country-pill-btn${f.country === selectedCountry ? " is-active" : ""}" data-country="${f.country}" aria-label="${f.label}">` +
    `<span class="fi fi-${f.code} fis country-flag-icon" aria-hidden="true"></span>` +
    `</button>`
  ).join("");
}

_countryPill = document.createElement("div");
_countryPill.className = "country-pill";

let _pillIsExpanded = false;
let _pillLastClose = 0;
let _pillTouchHandled = false;

function _pillOpen() {
  _pillIsExpanded = true;
  _countryPill.classList.add("is-expanded");
}
function _pillClose(country) {
  _pillIsExpanded = false;
  _pillLastClose = Date.now();
  _countryPill.classList.remove("is-expanded");
  if (country !== selectedCountry) {
    selectedCountry = country;
    localStorage.setItem("rcRaceMapCountry", country);
    updateCountryPill();
    populateSeries();
    _zoomToCountryPending = true;
    setTimeout(render, 270); // defer past 250ms close transition
  } else {
    setTimeout(() => fitToCountry(country), 270);
  }
}

// Touch: touchstart + preventDefault stops all iOS synthetic events
_countryPill.addEventListener("touchstart", e => {
  e.preventDefault();
  _pillTouchHandled = true;
  const btn = e.target.closest(".country-pill-btn");
  if (_pillIsExpanded) {
    // Fallback to active btn if touch missed (border-radius hit-test edge case)
    const country = (btn ?? _countryPill.querySelector(".country-pill-btn.is-active"))?.dataset.country ?? selectedCountry;
    _pillClose(country);
  } else if (btn && Date.now() - _pillLastClose > 300) {
    _pillOpen();
  }
}, { passive: false });

// Desktop mouse click (skipped when touch already handled it)
_countryPill.addEventListener("click", e => {
  if (_pillTouchHandled) { _pillTouchHandled = false; return; }
  const btn = e.target.closest(".country-pill-btn");
  if (!btn) return;
  e.stopPropagation();
  if (_pillIsExpanded) _pillClose(btn.dataset.country);
  else _pillOpen();
});

// Close when tapping anywhere outside the pill
document.addEventListener("touchstart", e => {
  if (_pillIsExpanded && !_countryPill.contains(e.target)) {
    _pillIsExpanded = false;
    _pillLastClose = Date.now();
    _countryPill.classList.remove("is-expanded");
  }
}, { passive: true });

// Desktop hover expansion (only on real pointer devices)
if (window.matchMedia("(hover: hover)").matches) {
  _countryPill.addEventListener("mouseenter", _pillOpen);
  _countryPill.addEventListener("mouseleave", () => {
    _pillIsExpanded = false;
    _countryPill.classList.remove("is-expanded");
  });
}
document.body.appendChild(_countryPill);
updateCountryPill();

// Move locate button out of Leaflet control into the correct slot
const _locateBtnLeafletContainer = _locateBtn?.parentElement;
if (window.matchMedia("(max-width: 860px)").matches) {
  if (_locateBtn) document.body.appendChild(_locateBtn);
} else {
  const desktopSlot = document.getElementById("locateDesktopSlot");
  if (desktopSlot && _locateBtn) desktopSlot.appendChild(_locateBtn);
}
if (_locateBtnLeafletContainer?.classList.contains("leaflet-control")) {
  _locateBtnLeafletContainer.remove();
}

// Position country pill on desktop: same center-to-center gap as hamburger→locate
function positionCountryPillDesktop() {
  if (window.matchMedia("(max-width: 860px)").matches) {
    if (_countryPill) _countryPill.style.top = "";
    return;
  }
  if (!_locateBtn || !_countryPill) return;
  const menuBtn = document.getElementById("appMenuButton");
  if (!menuBtn) return;
  const menuRect = menuBtn.getBoundingClientRect();
  const locateRect = _locateBtn.getBoundingClientRect();
  const menuCenter = menuRect.top + menuRect.height / 2;
  const locateCenter = locateRect.top + locateRect.height / 2;
  const spacing = locateCenter - menuCenter;
  _countryPill.style.top = Math.round(locateCenter + spacing - _countryPill.offsetHeight / 2) + "px";
}
requestAnimationFrame(positionCountryPillDesktop);
if (!localStorage.getItem("locateBtnHinted")) {
  setTimeout(() => {
    if (!_locateBtn) return;
    _locateBtn.classList.add("attention-pulse");
    _locateBtn.addEventListener("animationend", () => {
      _locateBtn.classList.remove("attention-pulse");
      localStorage.setItem("locateBtnHinted", "1");
    }, { once: true });
  }, 2500);
}

function clearLocationFilter() {
  if (!_locateBtn?.classList.contains("is-active")) return;
  _locateBtn.classList.remove("is-active");
  _userLatLng = null;
  if (_userLocationLayer) { map.removeLayer(_userLocationLayer); _userLocationLayer = null; }
  renderList(filteredRaces());
  updateMarkers(filteredRaces(), true);
}

function locateUser(btn) {
  localStorage.setItem("locateBtnHinted", "1");
  btn.classList.remove("attention-pulse");
  if (!navigator.geolocation) return;
  if (btn.classList.contains("is-active")) { clearLocationFilter(); return; }
  btn.classList.add("is-locating");
  navigator.geolocation.getCurrentPosition(
    ({ coords: { latitude: lat, longitude: lng, accuracy } }) => {
      btn.classList.remove("is-locating");
      btn.classList.add("is-active");
      const latlng = L.latLng(lat, lng);
      _userLatLng = { lat, lng };
      if (_userLocationLayer) map.removeLayer(_userLocationLayer);
      _userLocationLayer = L.layerGroup([
        L.circle(latlng, {
          radius: Math.min(accuracy, 10000),
          color: "#4A9EE8", fillColor: "#4A9EE8", fillOpacity: 0.12,
          weight: 1, interactive: false
        }),
        L.marker(latlng, {
          icon: L.divIcon({
            className: "",
            html: '<div class="user-location-dot"></div>',
            iconSize: [16, 16], iconAnchor: [8, 8]
          }),
          interactive: false, zIndexOffset: 2000
        })
      ]).addTo(map);

      const hasNearbyVenues = venues.some(v => hasLatLng(v) && haversineKm(lat, lng, v.lat, v.lng) <= GEO_RADIUS_KM);
      const list = filteredRaces();
      renderList(list);
      updateMarkers(list, false);
      if (hasNearbyVenues) {
        centerOnUserRadius(lat, lng);
      } else {
        panToVisible(latlng, 9);
      }
    },
    (err) => {
      btn.classList.remove("is-locating");
      console.warn("Geolocation:", err.message);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

// Zentriert den User-Standort exakt in der Mitte des sichtbaren Kartenbereichs
// und zeigt den vollen GEO_RADIUS_KM-Radius. Auf Mobile: symmetrisches Padding
// links/oben/rechts + nur unten Drawer-Abstand, so dass der Mittelpunkt auf H*0.25 landet.
function centerOnUserRadius(lat, lng) {
  const isMobileNow = window.matchMedia("(max-width: 860px)").matches;
  const dLat = GEO_RADIUS_KM / 111;
  const dLng = GEO_RADIUS_KM / (111 * Math.cos(lat * Math.PI / 180));
  const bounds = [[lat - dLat, lng - dLng], [lat + dLat, lng + dLng]];
  if (isMobileNow) {
    // Symmetrisches Padding links/oben/rechts = 20px; unten = Drawer-Höhe
    // → Inhalt-Mittelpunkt landet bei H*0.25 = Mitte des sichtbaren Bereichs über dem Drawer
    const { pb } = mapPadding();
    map.fitBounds(bounds, { paddingTopLeft: [20, 20], paddingBottomRight: [20, pb] });
  } else {
    // Desktop: symmetrische Box → panToVisible zentriert User im sichtbaren Bereich
    fitMapToBounds(bounds);
  }
}

const stadiaApiKey = "8b841ee3-0006-49fa-b575-45544e8d1b5e";
const rcRaceMapColorsLight = {
  water: "#ffffff", land: "#f4f4f4", settlement: "#ebebeb",
  landcover: "#f4f4f4", building: "#f4f4f4", road: "#d4d4d4", roadMinor: "#cccccc",
  boundary: "#d8d8d8", label: "#716F6F", labelHalo: "#ebebeb",
  marker: "#213769", markerClosed: "#c0bdb8", favorite: "#C8B090",
  statusOpen: "#73FF60", statusClosed: "#E51354", statusUpcoming: "#4A9EE8",
};
const rcRaceMapColorsDark = {
  water: "#0c1829", land: "#0f1e35", settlement: "#132442",
  landcover: "#0e1c32", building: "#132442", road: "#1e3a5f", roadMinor: "#1e3a5f",
  boundary: "#1e3a5f", label: "#6a9fd8", labelHalo: "#0f1e35",
  marker: "#4569a5", markerClosed: "#3d6090", favorite: "#c8b090",
  statusOpen: "#73FF60", statusClosed: "#E51354", statusUpcoming: "#4A9EE8",
};
const rcRaceMapColors = { ...rcRaceMapColorsLight };

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

// Favorite star icon (viewBox 0 0 24 24): circle + scaled Feather star as cutout
const _favIconPath = `M23,12 A11,11 0 1,1 1,12 A11,11 0 1,1 23,12 Z M12,5.6 L13.98,9.6 L18.4,10.25 L15.2,13.37 L15.96,17.77 L12,15.69 L8.04,17.77 L8.8,13.37 L5.6,10.25 L10.02,9.6 Z`;
const _favIconSvg  = (cls = "favorite-toggle-icon") =>
  `<svg class="${cls}" viewBox="1 1 22 22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" pointer-events="none"><path fill-rule="evenodd" d="${_favIconPath}" fill="currentColor"/></svg>`;

// Bell icon for notifications — circle + bell-body cutout, same fill-rule evenodd style as the star
// Bell subpaths: body, clapper arc, top stem — all become cutouts inside the circle
const _bellIconPath = `M23,12 A11,11 0 1,1 1,12 A11,11 0 1,1 23,12 Z M12,6.5 C9.8,6.5 8,8.3 8,10.5 L8,14.5 L6.5,15.5 L17.5,15.5 L16,14.5 L16,10.5 C16,8.3 14.2,6.5 12,6.5 Z M10.2,15.5 C10.2,16.6 11,17.5 12,17.5 C13,17.5 13.8,16.6 13.8,15.5 Z M11,6.5 L11,6 C11,5.4 11.4,5 12,5 C12.6,5 13,5.4 13,6 L13,6.5 Z`;
const _bellIconSvg = (cls = "notification-toggle-icon") =>
  `<svg class="${cls}" width="18" height="18" viewBox="1 1 22 22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill-rule="evenodd" d="${_bellIconPath}" fill="currentColor"/></svg>`;

// Based on racemap_icon.svg: the lower layer is white for favorites, transparent otherwise; the top colour layer gets the marker state color.
function raceMapMarkerSvgDataUri(color, width, height, bgColor = "transparent") {
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${raceMapMarkerViewBox.width} ${raceMapMarkerViewBox.height}" xmlns="http://www.w3.org/2000/svg">
      <g id="white" fill="${bgColor}">
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

const _initDark = (() => {
  const s = localStorage.getItem("rcracemap-theme") || "auto";
  if (s === "dark") return true;
  if (s === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
})();
if (_initDark) Object.assign(rcRaceMapColors, rcRaceMapColorsDark);

const baseMapLayer = L.maplibreGL({
  style: _initDark
    ? `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${stadiaApiKey}`
    : `https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key=${stadiaApiKey}`,
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

    // Hide contour/elevation lines
    if (layerLooksLike(layer, ["contour", "elevation", "hillshade"])) {
      setMapLayout(maplibreMap, id, "visibility", "none");
      return;
    }

    if (layer.type === "background") {
      maplibreMap.setPaintProperty(id, "background-color", rcRaceMapColors.land);
      maplibreMap.setPaintProperty(id, "background-opacity", 1);
      return;
    }

    if (layer.type === "fill" && layerLooksLike(layer, ["water", "ocean", "sea", "lake", "river"])) {
      maplibreMap.setPaintProperty(id, "fill-color", rcRaceMapColors.water);
      maplibreMap.setPaintProperty(id, "fill-opacity", 1);
      return;
    }

    if (layer.type === "line" && layerLooksLike(layer, ["water", "river", "stream", "canal"])) {
      maplibreMap.setPaintProperty(id, "line-color", rcRaceMapColors.water);
      maplibreMap.setPaintProperty(id, "line-opacity", 1);
      return;
    }

    if (layer.type === "fill" && layerLooksLike(layer, ["residential", "urban", "suburb", "populated"])) {
      maplibreMap.setPaintProperty(id, "fill-color", rcRaceMapColors.settlement);
      maplibreMap.setPaintProperty(id, "fill-opacity", 1);
      return;
    }

    if (layer.type === "fill" && layerLooksLike(layer, ["landcover", "landuse", "park", "wood", "forest", "grass"])) {
      maplibreMap.setPaintProperty(id, "fill-color", rcRaceMapColors.landcover);
      maplibreMap.setPaintProperty(id, "fill-opacity", 1);
      return;
    }

    if (layer.type === "fill" && layerLooksLike(layer, ["building"])) {
      maplibreMap.setPaintProperty(id, "fill-color", rcRaceMapColors.building);
      maplibreMap.setPaintProperty(id, "fill-opacity", 1);
      return;
    }

    if (layer.type === "line" && majorRoadLayerIds.has(id)) {
      applyMajorRoadStyle(maplibreMap, id);
      return;
    }

    // Railway lines
    if (layer.type === "line" && layerLooksLike(layer, ["rail", "railway", "transit", "tram", "subway", "metro"])) {
      setMapPaint(maplibreMap, id, "line-color", rcRaceMapColors.roadMinor);
      setMapPaint(maplibreMap, id, "line-opacity", 0.7);
      return;
    }

    // Minor roads (residential, service, track, path, etc.)
    if (layer.type === "line" && layerLooksLike(layer, ["road", "highway", "tunnel", "bridge", "ferry", "aeroway"]) && !majorRoadLayerIds.has(id)) {
      setMapPaint(maplibreMap, id, "line-color", rcRaceMapColors.roadMinor);
      setMapPaint(maplibreMap, id, "line-opacity", 0.85);
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
        // Hide settlement dot icons (only show text)
        setMapPaint(maplibreMap, id, "icon-opacity", 0);

        if (!countryRegionLabelLayerIds.has(id)) {
          // Only hide small settlements at low zoom; leave city/capital/unknown layers at Stadia defaults
          let minZoom = null;
          if (id.includes("suburb") || id.includes("neighbourhood") || id.includes("quarter")) minZoom = 12;
          else if (id.includes("hamlet") || id.includes("locality")) minZoom = 11;
          else if (id.includes("village")) minZoom = 10;
          else if (id.includes("town") && !id.includes("city")) minZoom = 8;
          if (minZoom !== null) {
            setMapPaint(maplibreMap, id, "text-opacity", ["step", ["zoom"], 0, minZoom, 1]);
          }
        }
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

baseMapLayer.getMaplibreMap?.().on("load", () => { applyRcRaceMapStyle(); });
baseMapLayer.getMaplibreMap?.().on("styledata", applyRcRaceMapStyle);
// Reveal map only after all tiles are fully rendered (idle = nothing more to fetch/paint)
baseMapLayer.getMaplibreMap?.().once("idle", revealMap);
baseMapLayer.getMaplibreMap?.().getCanvas()?.addEventListener("webglcontextrestored", () => {
  requestAnimationFrame(applyRcRaceMapStyle);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) requestAnimationFrame(applyRcRaceMapStyle);
});


let venues = [];
let races = [];
let seriesCatalog = [];
let hosts = [];
let hostsByOrgId = new Map();
let hostsById = new Map();
let venueLookup = new Map();
let markers = new Map();
const _venueForRaceCache = new Map();
let activeRaceId = null;
let activeVenueId = null;
let initialRenderDone = false;
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

// Resolve any alias (race hostId, venue hostId, hostIds[]) to the canonical venue.id.
// Returns the input unchanged if no venue matches (keeps unknown IDs intact).
function canonicalVenueId(anyId) {
  if (!anyId) return anyId;
  const id = String(anyId);
  const venue = venues.find(v =>
    String(v.id) === id ||
    (v.hostId && String(v.hostId) === id) ||
    (Array.isArray(v.hostIds) && v.hostIds.some(h => String(h) === id))
  );
  return venue ? String(venue.id) : id;
}

// ── Supabase ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://ncsqbncxctofkmabmwku.supabase.co";
const SUPABASE_KEY = "sb_publishable_Y9b0eW34GzqNfG3u8JZmiA_EI7fSc6P";
const sbClient = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY) ?? null;

let sbUser = null;

async function sbInit() {
  if (!sbClient) return;
  try {
    const { data: { session } } = await sbClient.auth.getSession();
    sbUser = session?.user ?? null;
    sbClient.auth.onAuthStateChange(async (_event, session) => {
      sbUser = session?.user ?? null;
      if (sbUser) await sbPullAll();
      else { selectedFavoriteFilter = "all"; saveFavoriteFilter("all"); _notifIds = new Set(); }
      document.body.classList.toggle("user-logged-in", !!sbUser);
      if (typeof showMenuHome === "function") showMenuHome();
      render();
    });
    if (sbUser) await sbPullAll();
    else { selectedFavoriteFilter = "all"; saveFavoriteFilter("all"); }
    document.body.classList.toggle("user-logged-in", !!sbUser);
  } catch (e) {
    console.error("Supabase init failed:", e);
  }
}

async function sbSendMagicLink(email) {
  if (!sbClient) return { error: { message: "Supabase not loaded" } };
  return sbClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname }
  });
}

async function sbSignOut() {
  if (!sbClient) return;
  await sbClient.auth.signOut();
}

async function sbPullAll() {
  if (!sbClient || !sbUser) return;
  selectedFavoriteFilter = loadFavoriteFilter();
  await Promise.all([sbPullFavorites(), sbPullPreferences(), sbPullNotifications()]);
}

async function sbPullFavorites() {
  const { data, error } = await sbClient.from("user_favorites").select("host_id").eq("user_id", sbUser.id);
  if (error) { console.error("sbPullFavorites:", error); return; }
  // Normalize all IDs to canonical venue.id
  const remoteIds = data.map(r => canonicalVenueId(r.host_id));
  const localIds = getFavoriteHostIds().map(id => canonicalVenueId(id));
  const merged = [...new Set([...localIds, ...remoteIds])];
  saveFavoriteHostIds(merged);
  // Sync any new local IDs to Supabase
  const toInsert = merged.filter(id => !remoteIds.includes(id)).map(host_id => ({ user_id: sbUser.id, host_id }));
  if (toInsert.length) {
    const { error: upsertErr } = await sbClient.from("user_favorites").upsert(toInsert);
    if (upsertErr) console.error("sbPullFavorites upsert:", upsertErr);
  }
  // Migrate any non-canonical remote IDs so future deletes work correctly
  const toMigrate = data.filter(r => canonicalVenueId(r.host_id) !== r.host_id);
  if (toMigrate.length) {
    const canonEntries = toMigrate.map(r => ({ user_id: sbUser.id, host_id: canonicalVenueId(r.host_id) }));
    await sbClient.from("user_favorites").upsert(canonEntries);
    const oldIds = toMigrate.map(r => r.host_id);
    await sbClient.from("user_favorites").delete().eq("user_id", sbUser.id).in("host_id", oldIds);
  }
}

async function sbPullPreferences() {
  const { data, error } = await sbClient.from("user_preferences").select("theme").eq("user_id", sbUser.id).maybeSingle();
  if (error) { console.error("sbPullPreferences:", error); return; }
  if (data?.theme && data.theme !== (localStorage.getItem(THEME_KEY) || "auto")) setTheme(data.theme);
}

async function sbToggleFavorite(hostId, isNowFavorite) {
  if (!sbClient || !sbUser) return;
  const { error } = isNowFavorite
    ? await sbClient.from("user_favorites").upsert({ user_id: sbUser.id, host_id: hostId })
    : await sbClient.from("user_favorites").delete().eq("user_id", sbUser.id).eq("host_id", hostId);
  if (error) console.error("sbToggleFavorite:", error);
}

async function sbSaveTheme(theme) {
  if (!sbClient || !sbUser) return;
  const { error } = await sbClient.from("user_preferences").upsert({ user_id: sbUser.id, theme, updated_at: new Date().toISOString() });
  if (error) console.error("sbSaveTheme:", error);
}

// ── Ads ───────────────────────────────────────────────────────────────────
let _ads = [];
const _adsTimers = new Map(); // bannerId → intervalId

async function loadAds() {
  if (!sbClient) return;
  const { data, error } = await sbClient.from("ads").select("*").eq("active", true).order("sort_order");
  if (error) { console.error("loadAds error (check RLS policy):", error.message); return; }
  console.log("loadAds: got", data?.length ?? 0, "ads");
  _ads = data ?? [];
  renderAllAdsBanners();
}

function renderAllAdsBanners() {
  appendAdsCard();
}

function appendAdsCard() {
  if (!raceList) return;
  raceList.querySelector(".club-card")?.remove();
  if (!_ads.length) return;

  const bannerId = "club-main";
  if (_adsTimers.has(bannerId)) {
    clearInterval(_adsTimers.get(bannerId));
    _adsTimers.delete(bannerId);
  }

  const card = document.createElement("div");
  card.className = "club-card";
  card.innerHTML = `
    <div class="club-carousel" data-banner="${bannerId}">
      <span class="club-ad-label">Anzeige</span>
      <div class="club-slides">
        ${_ads.map((ad, i) => `
          <div class="club-slide${i === 0 ? " is-active" : ""}">
            ${ad.link_url
              ? `<a href="${escapeHtml(ad.link_url)}" target="_blank" rel="noopener noreferrer sponsored">`
              : `<div>`}
            <img src="${escapeHtml(ad.image_url)}" alt="${escapeHtml(ad.alt_text || "")}" class="club-img" loading="lazy" />
            ${ad.link_url ? `</a>` : `</div>`}
          </div>`).join("")}
      </div>
      ${_ads.length > 1 ? `
      <div class="club-dots">
        ${_ads.map((_, i) => `<button class="club-dot${i === 0 ? " is-active" : ""}" type="button" aria-label="Bild ${i + 1}"></button>`).join("")}
      </div>` : ""}
    </div>`;

  raceList.appendChild(card);
  if (_ads.length > 1) initAdsCarousel(card, bannerId);
}

function initAdsCarousel(container, id) {
  const slides = [...container.querySelectorAll(".club-slide")];
  const dots = [...container.querySelectorAll(".club-dot")];
  let current = 0;

  function goTo(n) {
    slides[current].classList.remove("is-active");
    dots[current]?.classList.remove("is-active");
    current = ((n % slides.length) + slides.length) % slides.length;
    slides[current].classList.add("is-active");
    dots[current]?.classList.add("is-active");
  }

  const timer = setInterval(() => goTo(current + 1), 5000);
  _adsTimers.set(id, timer);

  dots.forEach((dot, i) => dot.addEventListener("click", () => {
    clearInterval(timer);
    goTo(i);
    const t = setInterval(() => goTo(current + 1), 5000);
    _adsTimers.set(id, t);
  }));
}

// Admin: ads CRUD
async function adminLoadAds() {
  if (!sbClient) return [];
  const { data, error } = await sbClient.from("ads").select("*").order("sort_order");
  if (error) { console.error("adminLoadAds:", error); return []; }
  return data ?? [];
}

async function adminSaveAd({ imageUrl, linkUrl, altText }) {
  const maxOrder = _ads.reduce((m, a) => Math.max(m, a.sort_order ?? 0), 0);
  const { error } = await sbClient.from("ads").insert({
    image_url: imageUrl,
    link_url: linkUrl || null,
    alt_text: altText || "",
    sort_order: maxOrder + 1,
    active: true
  });
  return error;
}

async function adminDeleteAd(id) {
  const { error } = await sbClient.from("ads").delete().eq("id", id);
  return error;
}

async function adminToggleAdActive(id, active) {
  const { error } = await sbClient.from("ads").update({ active }).eq("id", id);
  return error;
}

async function adminUploadAdImage(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await sbClient.storage.from("media").upload(path, file, { cacheControl: "31536000", upsert: false });
  if (error) throw error;
  return sbClient.storage.from("media").getPublicUrl(path).data.publicUrl;
}

function renderAdminAdsTab(container) {
  container.innerHTML = `<p class="admin-loading">Lade…</p>`;
  adminLoadAds().then(items => {
    container.innerHTML = `
      ${items.length ? `
      <div class="admin-ad-list">
        ${items.map(ad => `
          <div class="admin-ad-item" data-ad-id="${escapeHtml(String(ad.id))}">
            <img class="admin-ad-thumb" src="${escapeHtml(ad.image_url)}" alt="" />
            <div class="admin-ad-meta">
              <span class="admin-ad-link">${escapeHtml(ad.link_url || "Kein Link")}</span>
              <span class="admin-ad-status">${ad.active ? "Aktiv" : "Inaktiv"}</span>
            </div>
            <div class="admin-ad-actions">
              <button type="button" class="admin-btn admin-btn-toggle" data-active="${ad.active}">${ad.active ? "Pause" : "Aktivieren"}</button>
              <button type="button" class="admin-btn admin-btn-delete">Löschen</button>
            </div>
          </div>`).join("")}
      </div>` : `<p class="admin-empty">Noch keine Anzeigen.</p>`}
      <div class="admin-ad-add">
        <p class="admin-ad-add-title">Neue Anzeige</p>
        <label class="admin-ad-file-label">
          <input type="file" id="adImageFile" class="admin-ad-file-input" accept="image/*" />
          <div class="admin-ad-preview" id="adPreview">
            <span class="admin-ad-preview-placeholder">Bild auswählen…</span>
            <img id="adPreviewImg" class="admin-ad-preview-img" hidden />
          </div>
        </label>
        <input type="url" id="adLinkUrl" class="admin-input admin-input-coords" placeholder="https://..." />
        <input type="text" id="adAltText" class="admin-input admin-input-coords" placeholder="Beschreibung (optional)" />
        <div class="admin-entry-actions">
          <button type="button" class="admin-btn admin-btn-save" id="adSaveBtn">Hochladen & Speichern</button>
        </div>
        <p class="admin-entry-status" id="adSaveStatus"></p>
      </div>`;

    // Live preview on file select
    container.querySelector("#adImageFile")?.addEventListener("change", ev => {
      const file = ev.target.files?.[0];
      const preview = container.querySelector("#adPreview");
      const img = container.querySelector("#adPreviewImg");
      const placeholder = preview?.querySelector(".admin-ad-preview-placeholder");
      if (!file || !img) return;
      img.src = URL.createObjectURL(file);
      img.hidden = false;
      if (placeholder) placeholder.hidden = true;
    });

    // Delete
    container.querySelectorAll(".admin-btn-delete").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-ad-id]").dataset.adId;
        if (!confirm("Anzeige löschen?")) return;
        btn.disabled = true;
        const err = await adminDeleteAd(id);
        if (err) { alert("Fehler: " + err.message); btn.disabled = false; return; }
        await loadAds();
        renderAdminAdsTab(container);
      });
    });

    // Toggle active
    container.querySelectorAll(".admin-btn-toggle").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-ad-id]").dataset.adId;
        const nowActive = btn.dataset.active === "true";
        btn.disabled = true;
        const err = await adminToggleAdActive(id, !nowActive);
        if (err) { alert("Fehler: " + err.message); btn.disabled = false; return; }
        await loadAds();
        renderAdminAdsTab(container);
      });
    });

    // Save new ad
    container.querySelector("#adSaveBtn")?.addEventListener("click", async () => {
      const fileInput = container.querySelector("#adImageFile");
      const linkUrl = container.querySelector("#adLinkUrl")?.value.trim();
      const altText = container.querySelector("#adAltText")?.value.trim();
      const status = container.querySelector("#adSaveStatus");
      const file = fileInput?.files?.[0];
      if (!file) { status.textContent = "Bitte ein Bild auswählen."; return; }
      status.textContent = "Lade hoch…";
      container.querySelector("#adSaveBtn").disabled = true;
      try {
        const imageUrl = await adminUploadAdImage(file);
        const err = await adminSaveAd({ imageUrl, linkUrl, altText });
        if (err) throw err;
        status.textContent = "Gespeichert!";
        await loadAds();
        setTimeout(() => renderAdminAdsTab(container), 800);
      } catch (e) {
        status.textContent = "Fehler: " + e.message;
        container.querySelector("#adSaveBtn").disabled = false;
      }
    });
  });
}

// ── Venue notifications ───────────────────────────────────────────────────
let _notifIds = new Set();

async function sbPullNotifications() {
  if (!sbClient || !sbUser) return;
  const { data, error } = await sbClient.from("venue_notifications").select("host_id").eq("user_id", sbUser.id);
  if (error) { console.error("sbPullNotifications:", error); return; }
  _notifIds = new Set((data ?? []).map(r => String(r.host_id)));
}

function isNotificationEnabled(hostId) {
  return _notifIds.has(String(hostId));
}

async function toggleNotification(hostId) {
  if (!sbClient || !sbUser) return;
  const id = String(hostId);
  const enabling = !_notifIds.has(id);
  if (enabling) {
    _notifIds.add(id);
    const { error } = await sbClient.from("venue_notifications").upsert({ user_id: sbUser.id, host_id: id });
    if (error) { console.error("toggleNotification upsert:", error); _notifIds.delete(id); }
  } else {
    _notifIds.delete(id);
    const { error } = await sbClient.from("venue_notifications").delete().eq("user_id", sbUser.id).eq("host_id", id);
    if (error) { console.error("toggleNotification delete:", error); _notifIds.add(id); }
  }
}
function syncNotificationUi(hostId) {
  // Update favorites page if visible
  const fp = document.getElementById("favoritesPage");
  if (fp && !fp.hidden) {
    const favQuery = (document.getElementById("favSearch")?.value || "").trim().toLowerCase();
    renderFavoritesPage(favQuery);
  }
  // Update race list (re-renders all cards with correct bell state)
  const list = filteredRaces();
  const vid = activeVenueId || pinnedVenueId;
  if (vid) {
    const vl = list.filter(r => isRaceAtVenue(r, vid));
    if (vl.length) {
      renderList(vl);
      resultLine.textContent = resultLineText(vl.length, "an dieser Strecke");
    } else {
      const venue = venues.find(v => v.id === vid);
      if (venue) renderVenueNoRaces(latestPastRaceForVenue(venue));
    }
  } else {
    renderList(list);
    resultLine.textContent = resultLineText(list.length);
  }
}
// ─────────────────────────────────────────────────────────────────────────────

function loadFavoriteFilter() {
  if (!sbUser) return "all";
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

// Don't load from localStorage here — auth hasn't resolved yet. Reset to "all" at startup,
// then load from storage in sbPullAll() once we know a user is logged in.
selectedFavoriteFilter = "all";

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
  if (!hostId || !sbUser) return false;
  const ids = getFavoriteHostIds();
  return ids.includes(String(hostId)) || ids.includes(canonicalVenueId(hostId));
}

function toggleFavoriteHost(hostId) {
  if (!hostId) return;

  const id = canonicalVenueId(hostId);
  const favoriteIds = getFavoriteHostIds();
  const isNowFavorite = !favoriteIds.includes(id);

  if (isNowFavorite) {
    saveFavoriteHostIds([...favoriteIds, id]);
  } else {
    saveFavoriteHostIds(favoriteIds.filter(item => item !== id));
    // Remove notification subscription when unfavoriting
    if (_notifIds.has(id)) {
      toggleNotification(id).catch(e => console.error("toggleNotification on unfav:", e));
    }
  }
  sbToggleFavorite(id, isNowFavorite).catch(e => console.error("toggleFavoriteHost sync:", e));
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
  >${_favIconSvg()}</button>`;
}

function notificationHostButtonHtml(hostId, label = "Ausrichter") {
  if (!hostId) return "";

  const active = isNotificationEnabled(hostId);
  const title = active
    ? `Benachrichtigungen für ${label} deaktivieren`
    : `Benachrichtigungen für ${label} aktivieren`;

  return `<button
    class="venue-notification-button${active ? " active" : ""}"
    type="button"
    data-notification-host-id="${escapeHtml(hostId)}"
    title="${escapeHtml(title)}"
    aria-label="${escapeHtml(title)}"
    aria-pressed="${active ? "true" : "false"}"
  >${_bellIconSvg()}</button>`;
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
  if (!venueId || !sbUser) return false;
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
  >${_favIconSvg()}</button>`;
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
  const venue = venueForRace(race);
  if (venue) return isFavoriteHostId(venue.id);
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

function updateMobFilterDot() {
  if (!mobFilterBtn) return;
  const hasActive = selectedRange !== "2" || selectedSeries !== "all" ||
    selectedFavoriteFilter !== "all" || showOpenOnly;
  mobFilterBtn.classList.toggle("has-active-filters", hasActive);
}

function syncFilterUi() {
  updateFilterPanelState();
  updateFavoriteFilterUi();
  updateRegistrationVisibilityUi();
  updateSlidingPills();
  renderActiveFilterChips();
  updateMobFilterDot();
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

const _countryNameToCode = { Austria: "AT", Switzerland: "CH", Germany: "DE" };
function venueCountry(venue) {
  if (!venue?.myrcmOrgId) return null;
  const c = hostsByOrgId.get(String(venue.myrcmOrgId))?.country ?? null;
  if (!c) return null;
  return _countryNameToCode[c] ?? c;
}

function matchesCountryFilter(race) {
  if (selectedCountry === "all") return true;
  const venue = venueForRace(race);
  if (!venue) return false;
  const venueC = venueCountry(venue);
  if (!venueC) return true; // no country data yet → show in all filters
  if (venueC === selectedCountry) return true;
  // Cross-border races: also match by organizer's country
  const hostId = raceHostId(race);
  const rawHostC = hostId ? hostsById.get(String(hostId))?.country : null;
  if (!rawHostC) return false;
  const hostC = _countryNameToCode[rawHostC] ?? rawHostC;
  return hostC === selectedCountry;
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
    .filter(matchesCountryFilter)
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
  return "";

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
  const status = race.registrationStatus;
  if (race.registrationRequiresLogin && !status) return "login_required";
  // If race end date is in the past, registration is implicitly closed
  const raceEnd = race.to || race.from;
  if (raceEnd && new Date(raceEnd) < new Date(new Date().toDateString())) return "closed";
  return status || "open";
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
  if (isDarkActive()) {
    // Night: large pins lightest (stand out on dark bg)
    if (count >= 120) return "#9AAAD0";
    if (count >= 70)  return "#788FC0";
    if (count >= 40)  return "#5A73AA";
    if (count >= 20)  return "#405B94";
    if (count >= 10)  return "#2D447C";
    return rcRaceMapColors.marker;
  }
  // Day: large pins darkest
  if (count >= 120) return rcRaceMapColors.marker;
  if (count >= 70)  return "#2D447C";
  if (count >= 40)  return "#405B94";
  if (count >= 20)  return "#5A73AA";
  if (count >= 10)  return "#788FC0";
  return "#9AAAD0";
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

    .race-card.registration-open .tag-class {
      background: var(--pill-bg) !important;
      color: var(--host-blue) !important;
    }

    .race-card.registration-closed .race-date,
    .race-card.registration-closed .race-name,
    .race-card.registration-closed .race-venue,
    .race-card.registration-closed .race-registration-count,
    .race-card.registration-closed .race-link-item-status-closed {
      color: var(--muted) !important;
    }

    .race-card.registration-closed .tag-class,
    .race-card.registration-closed .tag {
      background: var(--muted) !important;
      color: var(--bg) !important;
      border-color: transparent !important;
    }

    :root.theme-dark .race-card.registration-open .tag-class {
      background: #4d68a1 !important;
      color: #172037 !important;
    }

    :root.theme-dark .race-card.registration-closed .race-date,
    :root.theme-dark .race-card.registration-closed .race-name,
    :root.theme-dark .race-card.registration-closed .race-venue,
    :root.theme-dark .race-card.registration-closed .race-registration-count,
    :root.theme-dark .race-card.registration-closed .race-link-item-status-closed {
      color: #3d5380 !important;
    }

    :root.theme-dark .race-card.registration-closed .tag-class,
    :root.theme-dark .race-card.registration-closed .tag {
      background: var(--card) !important;
      color: #3d5380 !important;
      border-color: transparent !important;
    }

    @media (prefers-color-scheme: dark) {
      :root:not(.theme-light) .race-card.registration-open .tag-class {
        background: #4d68a1 !important;
        color: #172037 !important;
      }

      :root:not(.theme-light) .race-card.registration-closed .race-date,
      :root:not(.theme-light) .race-card.registration-closed .race-name,
      :root:not(.theme-light) .race-card.registration-closed .race-venue,
      :root:not(.theme-light) .race-card.registration-closed .race-registration-count,
      :root:not(.theme-light) .race-card.registration-closed .race-link-item-status-closed {
        color: #3d5380 !important;
      }

      :root:not(.theme-light) .race-card.registration-closed .tag-class,
      :root:not(.theme-light) .race-card.registration-closed .tag {
        background: var(--card) !important;
        color: #3d5380 !important;
        border-color: transparent !important;
      }
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
      background: var(--status-upcoming, #4A9EE8);
    }

    .registration-dot-login_required {
      background: var(--status-upcoming, #4A9EE8);
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
      --venue-pin-color: var(--favorite, #BE9E73);
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
  const key = race.id;
  if (key !== undefined && _venueForRaceCache.has(key)) return _venueForRaceCache.get(key);
  const result = venueById(race.venueId) || venueByRaceAddress(race) || venueByRaceNameAndCity(race) || null;
  if (key !== undefined) _venueForRaceCache.set(key, result);
  return result;
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
  if (!hasMappableVenue(race)) {
    return `<div class="race-venue race-venue-unknown">${mapPinIconHtml("race-venue-pin")}<span>Ort unbekannt</span></div>`;
  }
  if (raceHostAndVenueAreSame(race)) return "";
  return `<div class="race-venue">${mapPinIconHtml("race-venue-pin")}${raceVenueNameHtml(race)}</div>`;
}

function raceHostNameHtml(race) {
  const hostId = raceHostId(race);
  const hostName = raceHostName(race);
  const favoriteClass = isFavoriteHostId(hostId) ? " venue-link-favorite" : "";
  const website = hostWebsiteForRace(race);

  const hostHtml = website
    ? `<a class="venue-link${favoriteClass}" href="${escapeHtml(website)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escapeHtml(hostName)}</a>`
    : `<span class="host-name${favoriteClass}">${escapeHtml(hostName)}</span>`;

  const isFav = isFavoriteHostId(hostId);
  const actions = `<span class="venue-action-buttons">${isFav ? notificationHostButtonHtml(hostId, hostName) : ""}${favoriteHostButtonHtml(hostId, hostName)}</span>`;
  return `<span class="venue-name-with-favorite${favoriteClass ? " is-favorite" : ""}">${hostHtml}${actions}</span>`;
}

function raceVenueNameHtml(race) {
  const name = escapeHtml(venueDisplayName(race));
  return `<span class="venue-name"><span class="venue-name-text">${name}</span></span>`;
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

  let list = races
    .filter(isUsefulRckRace)
    .filter(isInSelectedRange)
    .filter(matchesRegistrationVisibility)
    .filter(matchesSelectedSeries)
    .filter(matchesFavoriteFilter)
    .filter(matchesCountryFilter);

  // Geocode aktiv: Radius-Filter statt Textsuche, damit Filteränderungen den Geocode-Bereich behalten
  if (_geocodeMarkerCoords) {
    const { lat, lng } = _geocodeMarkerCoords;
    const nearbyIds = new Set();
    venues.forEach(venue => {
      if (!hasLatLng(venue)) return;
      if (haversineKm(lat, lng, venue.lat, venue.lng) <= GEO_RADIUS_KM)
        nearbyIds.add(String(venue.id));
    });
    list = list.filter(race => {
      const venue = venueForRace(race);
      return venue && nearbyIds.has(String(venue.id));
    });
    return list.sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
  }

  // Textsuche (nur wenn kein Geocode aktiv)
  list = list.filter(race => !query || raceSearchText(race).includes(query));

  if (_userLatLng) {
    const { lat, lng } = _userLatLng;
    const nearbyIds = new Set();
    venues.forEach(venue => {
      if (!hasLatLng(venue)) return;
      if (haversineKm(lat, lng, venue.lat, venue.lng) <= GEO_RADIUS_KM)
        nearbyIds.add(String(venue.id));
    });
    list = list.filter(race => {
      const venue = venueForRace(race);
      return venue && nearbyIds.has(String(venue.id));
    });
    return list.sort((a, b) => {
      const va = venueForRace(a), vb = venueForRace(b);
      const da = va ? haversineKm(lat, lng, Number(va.lat), Number(va.lng)) : Infinity;
      const db = vb ? haversineKm(lat, lng, Number(vb.lat), Number(vb.lng)) : Infinity;
      return da - db || a.from.localeCompare(b.from);
    });
  }

  return list.sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const dφ = (lat2 - lat1) * Math.PI / 180;
  const dλ = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const _geocodeCache = {};
const GEO_RADIUS_KM = 75;
let _geocodePending = false;
let _geocodeMarker = null;
let _geocodeMarkerCoords = null;

async function geocodeFallback(query) {
  const key = query.trim().toLowerCase();
  if (!key) return false;
  const queryStillCurrent = () => searchInput.value.trim().toLowerCase() === key;
  let coords = _geocodeCache[key];
  if (!coords) {
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(key)}&format=json&limit=1&countrycodes=de,at,ch`,
        { headers: { "Accept-Language": "de", "User-Agent": "rcracemap.com/1.0" } }
      );
      const data = await resp.json();
      if (!data.length) return false;
      coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      _geocodeCache[key] = coords;
    } catch { return false; }
  }
  if (!queryStillCurrent()) return false;
  const nearbyIds = new Set();
  venues.forEach(venue => {
    if (!hasLatLng(venue)) return;
    if (haversineKm(coords.lat, coords.lng, venue.lat, venue.lng) <= GEO_RADIUS_KM)
      nearbyIds.add(String(venue.id));
  });
  if (!nearbyIds.size) return false;
  const list = races
    .filter(isUsefulRckRace)
    .filter(isInSelectedRange)
    .filter(matchesRegistrationVisibility)
    .filter(matchesSelectedSeries)
    .filter(matchesFavoriteFilter)
    .filter(race => { const venue = venueForRace(race); return venue && nearbyIds.has(String(venue.id)); })
    .sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
  if (!list.length) return false;
  if (!queryStillCurrent()) return false;
  _geocodePending = false;
  setGeocodeMarker(coords.lat, coords.lng);
  renderList(list);
  updateMarkers(list, false);
  centerOnUserRadius(coords.lat, coords.lng);
  return true;
}

function clearGeocodeMarker() {
  if (_geocodeMarker) { _geocodeMarker.remove(); _geocodeMarker = null; }
  _geocodeMarkerCoords = null;
}

function setGeocodeMarker(lat, lng) {
  clearGeocodeMarker();
  clearLocationFilter();
  _geocodeMarkerCoords = { lat, lng };
  const h = raceMapMarkerBaseHeight;
  const w = Math.round(h * mapPinViewBox.width / mapPinViewBox.height);
  const svg = mapPinSvgDataUri(rcRaceMapColors.markerClosed, w, h);
  _geocodeMarker = L.marker([lat, lng], {
    interactive: false,
    zIndexOffset: -100,
    icon: L.divIcon({
      className: "",
      html: `<div class="map-marker-venue-inactive map-marker-visual" style="width:${w}px;height:${h}px;background-image:url('${svg}');--marker-delay:0ms;"></div>`,
      iconSize: [w, h],
      iconAnchor: [Math.round(w / 2), h]
    })
  }).addTo(map);
}

function googleMapsRouteUrl(venue) {
  if (!hasLatLng(venue)) return "#";
  return `https://www.google.com/maps/dir/?api=1&destination=${Number(venue.lat)},${Number(venue.lng)}`;
}

function buildPopup(venue, venueRaces, latestPastRace = null, overrideName = null) {
  const venueName = escapeHtml(overrideName || venue?.name || "Unbekannte Strecke");
  const venueWs = venueWebsite(venue);
  const titleHtml = venueWs
    ? `<a class="popup-venue-link" href="${escapeHtml(venueWs)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${venueName}</a>`
    : `<span class="venue-name-text">${venueName}</span>`;

  return `
    <div class="popup-title">${titleHtml}</div>
    <div class="popup-route">
      <a class="popup-route-btn" href="${googleMapsRouteUrl(venue)}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()" title="Route planen">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M21.71 11.29l-9-9a1 1 0 0 0-1.42 0l-9 9a1 1 0 0 0 0 1.42l9 9a1 1 0 0 0 1.42 0l9-9a1 1 0 0 0 0-1.42zM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5-3.5 3.5z"/>
        </svg>
        Route
      </a>
    </div>
  `;
}

function resetVenueSelection() {
  if (!activeVenueId && !activeRaceId) return;

  const prevVenueId = activeVenueId;
  pinnedVenueId = null;
  activeVenueId = null;
  activeRaceId = null;
  updateAppModeClass();
  renderList(filteredRaces());

  // Restore drawer state on mobile, then scroll after transition completes
  const isMobile = window.matchMedia("(max-width: 860px)").matches;
  if (drawerStateBeforeVenue && isMobile) {
    setDrawerState(drawerStateBeforeVenue);
    drawerStateBeforeVenue = null;
  }

  // Restore exact scroll position
  if (listScrollBeforeVenue !== null) {
    const savedScroll = listScrollBeforeVenue;
    listScrollBeforeVenue = null;
    const applyScroll = () => {
      const scrollEl = isMobile
        ? document.getElementById("mobRaceList")
        : document.querySelector(".race-panel");
      if (scrollEl) scrollEl.scrollTop = savedScroll;
    };
    // Set immediately to avoid visible jump, then re-apply after drawer transition
    requestAnimationFrame(applyScroll);
    if (isMobile) setTimeout(applyScroll, 320);
  }
}

// Returns {pl, pr, pt, pb} padding for the currently visible map area.
// Desktop: right panel 414px, topbar 80px.
// Mobile collapsed: hamburger 66px left, handle 84px bottom.
// Mobile half: half-drawer covers lower half of screen.
function mapPadding() {
  const isMobile = window.matchMedia("(max-width: 860px)").matches;
  if (!isMobile) return { pl: 0, pr: 414, pt: 80, pb: 40 };
  // Drawer in half state covers 50dvh from the bottom.
  // Top: 80px topbar + 20px breathing room.
  // Bottom: actual drawer height + 20px so no pin lands under the drawer.
  const pb = drawerState === "collapsed"
    ? 104
    : Math.round(window.innerHeight * 0.5) + 20;
  return { pl: 66, pr: 20, pt: 100, pb };
}

// Center a single latlng in the visible map area at the given zoom.
// Computes the shifted map center directly so only ONE setView call is needed —
// avoiding the visible map-shift caused by setView → moveend → revealMap → panBy.
//
// Mobile collapsed: visible center = (W/2, H/2 + 8)  → shift pixel by (0, +8)
// Desktop: visible center = (W/2 - 207, H/2 + 40)   → shift pixel by (+207, -40)
// panBy([dx, dy]) moves the map center by (dx, dy) pixels, so to achieve that
// offset without panBy: add (dx, dy) to the projected point before unproject.
let lastVisibleCenter = null;

function panToVisible(latlng, zoom) {
  lastVisibleCenter = latlng;
  const isMobile = window.matchMedia("(max-width: 860px)").matches;
  const px = map.project(latlng, zoom);
  let shifted;
  if (isMobile) {
    const H = window.innerHeight;
    // Compute expected drawer top from CSS snap states (avoids mid-transition DOM reads):
    // .mob-drawer: top:80px, height:H-80. translateY values per state:
    //   full:      translateY(0)          → top = 80
    //   half:      translateY(50%)        → top = 80 + (H-80)*0.5
    //   collapsed: translateY(100%-64px)  → top = H-64
    const drawerTop = drawerState === "collapsed"
      ? H - 64
      : drawerState === "full"
      ? 80
      : 80 + (H - 80) * 0.5;
    const topbarH = 80;
    const shift = Math.round(H / 2 - (topbarH + drawerTop) / 2);
    shifted = L.point(px.x, px.y + Math.max(shift, 4));
  } else {
    shifted = L.point(px.x + 207, px.y - 40);
  }
  map.setMaxBounds(null);
  map.setView(map.unproject(shifted, zoom), zoom, { animate: false });
  map.setMaxBounds(MAX_BOUNDS);
}

// Fit multiple latlng bounds in the visible map area.
// Mobile: use Leaflet fitBounds with padding (works reliably).
// Desktop: Leaflet fitBounds padding is unreliable with the floating panel overlay.
//   Instead: calculate correct zoom via getBoundsZoom with symmetric padding
//   matching the visible area size, then use panToVisible for reliable centering.
function fitMapToBounds(bounds, options = {}) {
  const isMobile = window.matchMedia("(max-width: 860px)").matches;
  if (isMobile) {
    const { pl, pr, pt, pb } = mapPadding();
    map.fitBounds(bounds, {
      paddingTopLeft: [pl, pt],
      paddingBottomRight: [pr, pb],
      ...options
    });
    return;
  }
  // Desktop visible area: x=[0, W-414], y=[80, H].
  // getBoundsZoom with symmetric padding (207,40) matches the visible area size.
  // Compute bounds pixel center directly (geographic center is wrong in Mercator).
  // One setView shifts bounds pixel center to visible area center (W/2-207, H/2+40).
  const lBounds = L.latLngBounds(bounds);
  let zoom = map.getBoundsZoom(lBounds, false, L.point(207, 40));
  if (options.maxZoom !== undefined) zoom = Math.min(zoom, options.maxZoom);
  if (options.minZoom !== undefined) zoom = Math.max(zoom, options.minZoom);
  zoom = Math.max(zoom, map.getMinZoom() || 0);
  const nwPx = map.project(lBounds.getNorthWest(), zoom);
  const sePx = map.project(lBounds.getSouthEast(), zoom);
  const cPx = nwPx.add(sePx).divideBy(2);
  // Shift the viewport center downward if the northernmost venue is too close to the topbar
  // to show marker icons (which extend above their anchor point). On large screens with
  // plenty of room the shift is 0. On small/tight screens the center moves down enough
  // to give 50px of clearance below the topbar (y=80) for icons.
  const boundsH = sePx.y - nwPx.y;
  const mapH = map.getSize().y;
  const topOfBoundsY = mapH / 2 + 40 - boundsH / 2;
  // iconShift protects space for marker icons below the topbar — skip for country bounds
  const iconShift = options.skipIconShift ? 0 : Math.max(0, 130 - topOfBoundsY);
  panToVisible(map.unproject(L.point(cPx.x, cPx.y - iconShift), zoom), zoom);
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
    const venueHasActiveRegistration = hasActiveRegistration(venueRaces);
    const markerClass = hasUpcomingRaces
      ? (venueHasActiveRegistration ? "map-marker-open" : "map-marker-closed")
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

    const replacementClass = venueHasActiveRegistration
      ? "map-marker-active-replacement-open"
      : "map-marker-active-replacement-closed";

    const venueHostIds = [
      venue.id,
      venue.hostId,
      ...(Array.isArray(venue.hostIds) ? venue.hostIds : []),
      venue.myrcmOrgId ? `myrcm-${venue.myrcmOrgId}` : null,
      venue.hostName ? slugifyMatchValue(venue.hostName) : null
    ].filter(Boolean).map(String);
    const isFavoriteVenue = venueRaces.some(race => isFavoriteRaceHost(race))
      || venueHostIds.some(id => isFavoriteHostId(id));

    let markerColor;
    if (isFavoriteVenue) {
      markerColor = rcRaceMapColors.favorite;
    } else if (hasUpcomingRaces && !venueHasActiveRegistration) {
      markerColor = rcRaceMapColors.markerClosed;
    } else if (hasUpcomingRaces) {
      markerColor = markerColorForRegistrationCount(registrationTotal);
    } else {
      markerColor = rcRaceMapColors.markerClosed;
    }

    const markerSvg = raceMapMarkerSvgDataUri(markerColor, markerWidth, markerHeight, (isFavoriteVenue || venueHasActiveRegistration) ? "#fff" : "transparent");

    const inactiveClass = isFavoriteVenue
      ? "map-marker-venue-inactive-favorite"
      : "map-marker-venue-inactive";
    const inactiveMarkerSvg = mapPinSvgDataUri(markerColor, markerWidth, markerHeight);

    const markerHtml = hasUpcomingRaces
      ? `<div class="map-marker-switcher map-marker-visual${isFavoriteVenue ? " map-marker-is-favorite" : ""}" style="width: ${markerWidth}px; height: ${markerHeight}px; --marker-delay: 0ms;">
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
        offset: popupOffset,
        autoPan: false,
        className: isFavoriteVenue ? "popup-favorite" : "popup-standard"
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
        if (isPopupPinned || pinnedVenueId === venue.id) return;

        clearTimeout(hoverTimer);
        hoverTimer = window.setTimeout(() => {
          marker.closePopup();
        }, 150);
      });

      popupElement.addEventListener("click", event => {
        if (event.target.closest(".leaflet-popup-close-button")) {
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
          renderVenueNoRaces(latestPastRace);
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
        renderVenueNoRaces(latestPastRace);
      }

      marker.setPopupContent(buildPopup(venue, venueRaces, latestPastRace));
      marker.openPopup();

      panToVisible([venue.lat, venue.lng], map.getZoom());

      window.setTimeout(() => {
        isSwitchingMarkerPopup = false;
      }, 0);
    });

    markers.set(venue.id, marker);
    if (hasUpcomingRaces) bounds.push([venue.lat, venue.lng]);
  });

  if (shouldFitBounds && bounds.length >= 1) {
    fitMapToBounds(bounds, { maxZoom: bounds.length === 1 ? 12 : undefined });
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

  // Save scroll position before switching to venue view
  const isMobile = window.matchMedia("(max-width: 860px)").matches;
  const scrollEl = isMobile
    ? document.getElementById("mobRaceList")
    : document.querySelector(".race-panel");
  listScrollBeforeVenue = scrollEl ? scrollEl.scrollTop : null;

  activeVenueId = venue.id;
  activeRaceId = null;
  updateAppModeClass();

  const baseList = filteredRaces();
  const venueList = baseList.filter(item => isRaceAtVenue(item, activeVenueId));

  renderList(venueList);
  resultLine.textContent = resultLineText(venueList.length, "an dieser Strecke");

  const marker = markers.get(venue.id);
  if (marker) {
    marker.setPopupContent(buildPopup(venue, venueList, latestPastRaceForVenue(venue), race.venueName || null));
    marker.openPopup();
  }

  const targetZoom = Math.max(map.getZoom(), 12);
  panToVisible([venue.lat, venue.lng], targetZoom);
}
function buildPastRaceCardEl(race) {
  const isFavorite = isFavoriteRaceHost(race);
  const series = raceSeries(race);
  const label = document.createElement("div");
  label.className = "venue-last-race-label";
  label.textContent = "Zuletzt:";
  const card = document.createElement("article");
  card.className = `race-card registration-${registrationStatus(race)}${isRckRace(race) ? " race-card-rck" : " race-card-myrcm"}${isFavorite ? " race-card-favorite-venue" : ""}`;
  card.dataset.raceId = race.id;
  card.innerHTML = `
    <div class="race-host">${raceHostNameHtml(race)}</div>
    <div class="race-card-header">
      <div class="race-date">${formatDateRange(race.from, race.to)}</div>
      <div class="race-name-row">
        <div class="race-name">${escapeHtml(race.name)}</div>
        ${registrationCountHtml(race)}
      </div>
      <div class="race-tags race-series-tags">
        ${series.map(item => `<span class="tag">${escapeHtml(seriesDisplayName(item))}</span>`).join("")}
      </div>
    </div>
    ${documentLinksHtml(race)}
    ${statusDetailsHtml(race)}
  `;
  return [label, card];
}

function renderVenueNoRaces(latestPastRace) {
  resultLine.textContent = emptyVenueResultLineText();
  raceList.innerHTML = "";
  if (!latestPastRace) {
    raceList.innerHTML = `<div class="empty-state">Keine Rennen an dieser Strecke.</div>`;
    return;
  }
  buildPastRaceCardEl(latestPastRace).forEach(el => raceList.appendChild(el));
}

function renderList(list) {
  document.querySelector(".race-panel")?.scrollTo(0, 0);
  document.getElementById("mobRaceList")?.scrollTo(0, 0);
  resultLine.textContent = resultLineText(list.length);
  raceList.innerHTML = "";

  if (!list.length) {
    if (!venues.length) return; // data not yet loaded — don't flash the empty state
    if (_geocodePending) {
      raceList.innerHTML = `<div class="empty-state">Suche…</div>`;
      return;
    }
    raceList.innerHTML = `<div class="empty-state">Keine Rennen für diesen Filter gefunden.</div>`;
    return;
  }

  for (const race of list) {
    const isFavorite = isFavoriteRaceHost(race);
    const series = raceSeries(race);
    const card = document.createElement("article");

    card.className = `race-card registration-${registrationStatus(race)}${isRckRace(race) ? " race-card-rck" : " race-card-myrcm"}${isFavorite ? " race-card-favorite-venue" : ""}${hasMappableVenue(race) ? " is-clickable" : ""}${race.id === activeRaceId ? " active" : ""}`;
    card.dataset.raceId = race.id;
    card.tabIndex = 0;

    card.innerHTML = `
      ${newRaceBadgeHtml(race)}
      <div class="race-host">${raceHostNameHtml(race)}</div>
      <div class="race-card-header">
        <div class="race-date">${formatDateRange(race.from, race.to)}</div>
        <div class="race-name-row">
          <div class="race-name">${race.name}</div>
          ${registrationCountHtml(race)}
        </div>

        <div class="race-tags race-series-tags">
          ${series.map(item => `<span class="tag">${escapeHtml(seriesDisplayName(item))}</span>`).join("")}
        </div>
      </div>
      ${raceVenueMetaHtml(race)}
      ${documentLinksHtml(race)}
      ${statusDetailsHtml(race)}

      ${
        Array.isArray(race.classes) && race.classes.length
          ? `<div class="race-tags race-class-tags">
              ${
                race.classes
                  .map((item, i) => {
                    const collapsed = !expandedClassRaceIds.has(race.id) && race.classes.length > 6 && i >= 4;
                    return `<span class="tag tag-class"${collapsed ? ' style="display:none"' : ""}>${escapeHtml(classTagLabel(item))}</span>`;
                  })
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
        if (event.target.closest("[data-notification-host-id]")) return;
        focusRace(race);
      });

      card.addEventListener("keydown", event => {
        if (event.target.closest("[data-favorite-venue-id]")) return;
        if (event.target.closest("[data-favorite-host-id]")) return;
        if (event.target.closest("[data-notification-host-id]")) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          focusRace(race);
        }
      });
    }

    raceList.appendChild(card);
  }

  if (selectedFavoriteFilter === "favorites") {
    const venueIdsInList = new Set();
    for (const race of list) {
      const v = venueForRace(race);
      if (v) venueIdsInList.add(String(v.id));
    }
    for (const venue of venues) {
      if (venueIdsInList.has(String(venue.id))) continue;
      if (!isFavoriteHostId(venue.id)) continue;
      if (_userLatLng && hasLatLng(venue) && haversineKm(_userLatLng.lat, _userLatLng.lng, venue.lat, venue.lng) > GEO_RADIUS_KM) continue;
      const past = latestPastRaceForVenue(venue);
      if (!past) continue;
      const [, card] = buildPastRaceCardEl(past);
      raceList.appendChild(card);
    }
  }

  renderAllAdsBanners();
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
  const notificationHostButton = event.target.closest("[data-notification-host-id]");
  const favoriteVenueButton = event.target.closest("[data-favorite-venue-id]");
  const favoriteHostButton = event.target.closest("[data-favorite-host-id]");
  const favoriteButton = favoriteVenueButton || favoriteHostButton;

  if (!favoriteButton && !notificationHostButton) return;

  event.preventDefault();
  event.stopPropagation();

  if (!sbUser) {
    showLoginPrompt();
    return;
  }

  if (notificationHostButton) {
    const hostId = notificationHostButton.dataset.notificationHostId;
    toggleNotification(hostId).then(() => syncNotificationUi(hostId)).catch(e => console.error("toggleNotification:", e));
    return;
  }

  if (favoriteHostButton) {
    toggleFavoriteHost(favoriteHostButton.dataset.favoriteHostId);
  } else if (favoriteVenueButton) {
    toggleFavoriteVenue(favoriteVenueButton.dataset.favoriteVenueId);
  }

  // Update open popup color if the toggled button is inside a popup
  const popupEl = favoriteButton.closest(".leaflet-popup");
  if (popupEl) {
    const hostId = favoriteButton.dataset.favoriteHostId;
    const isFav = hostId ? isFavoriteHostId(hostId) : isFavoriteVenueId(favoriteButton.dataset.favoriteVenueId);
    popupEl.classList.toggle("popup-favorite", isFav);
    popupEl.classList.toggle("popup-standard", !isFav);
  }

  const list = filteredRaces();
  const reopenVenueId = pinnedVenueId; // always reopen popup if one was open
  updateMarkers(list, false);
  if (reopenVenueId) {
    const m = markers.get(reopenVenueId);
    if (m) {
      pinnedVenueId = reopenVenueId;
      m.openPopup();
      // Ensure popup class matches actual current favorite state,
      // in case isFavoriteVenue in updateMarkers resolved incorrectly.
      const hostId = favoriteButton.dataset.favoriteHostId;
      const isFav = hostId
        ? isFavoriteHostId(hostId)
        : isFavoriteVenueId(favoriteButton.dataset.favoriteVenueId);
      const popupEl = m.getPopup()?.getElement();
      if (popupEl) {
        popupEl.classList.toggle("popup-favorite", isFav);
        popupEl.classList.toggle("popup-standard", !isFav);
      }
    }
  }

  if (activeVenueId) {
    const venueList = list.filter(race => isRaceAtVenue(race, activeVenueId));
    if (venueList.length) {
      renderList(venueList);
      resultLine.textContent = resultLineText(venueList.length, "an dieser Strecke");
    } else {
      const venue = venues.find(v => v.id === activeVenueId);
      if (venue) renderVenueNoRaces(latestPastRaceForVenue(venue));
    }
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

  races.filter(r => matchesCountryFilter(r) && isInSelectedRange(r)).forEach(race => {
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

  if (selectedSeries !== "all" && !seriesFilter.querySelector(`option[value="${selectedSeries}"]`)) {
    selectedSeries = "all";
    seriesFilter.value = "all";
  }
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
  const mapEl = document.getElementById("map");
  if (!mapEl || mapEl.classList.contains("map-ready")) return;
  mapEl.classList.add("map-ready");
  document.body.classList.add("map-is-ready");
  document.querySelector(".map-loader")?.classList.add("map-loader-done");
  // Fade pins in after map fade-in completes (220ms transition + small buffer)
  setTimeout(() => mapEl.classList.add("map-markers-ready"), 320);
}

function revealMapWhenReady() {
  const mapElement = document.getElementById("map");

  // Fallback: reveal map if applyRcRaceMapStyle() never runs (e.g. no WebGL)
  window.setTimeout(() => {
    revealMap();
  }, 1500);
}

function render() {
  updateAppModeClass();
  syncFilterUi();
  const list = filteredRaces();

  // Phase 1: list panel updates immediately
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
        renderVenueNoRaces(latestPastRace);
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

  // Phase 2: map markers deferred — browser paints list first, then updates map
  const mapPanel = document.querySelector(".map-panel");
  // Skip updateMarkers' own fitBounds when fitToCountry will handle the zoom
  const shouldFitBounds = !initialRenderDone && !_zoomToCountryPending;
  if (initialRenderDone) mapPanel?.classList.add("map-is-updating");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      updateMarkers(list, shouldFitBounds);
      if (venues.length > 0) initialRenderDone = true;
      mapPanel?.classList.remove("map-is-updating");
      if (_zoomToCountryPending) {
        _zoomToCountryPending = false;
        fitToCountry(selectedCountry);
      }
    });
  });
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

  populateSeries();
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

    if (!sbUser && button.dataset.favoriteFilter === "favorites") {
      showLoginPrompt();
      return;
    }

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


let _searchDebounce;
const isMobile = () => window.matchMedia("(max-width: 860px)").matches;

searchInput.addEventListener("input", () => {
  activeVenueId = null;
  activeRaceId = null;
  updateAppModeClass();
  clearTimeout(_searchDebounce);
  _geocodePending = false;
  clearGeocodeMarker();
  clearLocationFilter();
  const query = searchInput.value.trim();
  renderActiveFilterChips(); // Suchpille sofort anzeigen/entfernen
  // Sofortiger Update bei leerem Feld (X-Button) — kein Debounce, kein blur nötig
  if (!query) {
    const list = filteredRaces();
    renderList(list);
    updateMarkers(list, true);
    return;
  }
  if (isMobile()) {
    // 500ms Pause, dann erst Ortssuche, sonst Textsuche
    _searchDebounce = setTimeout(async () => {
      _geocodePending = true;
      renderList([]);
      const ok = await geocodeFallback(query);
      if (!ok && searchInput.value.trim().toLowerCase() === query.toLowerCase()) {
        _geocodePending = false;
        const list = filteredRaces();
        renderList(list);
      }
    }, 500);
    return;
  }
  // Desktop: erst Ortssuche, Textsuche als Fallback
  _searchDebounce = setTimeout(async () => {
    _geocodePending = true;
    renderList([]); // zeigt "Suche…"
    const ok = await geocodeFallback(query);
    if (!ok && searchInput.value.trim().toLowerCase() === query.toLowerCase()) {
      _geocodePending = false;
      const list = filteredRaces();
      renderList(list);
      updateMarkers(list, true);
    }
  }, 300);
});

// Enter: sofortige Aktualisierung auf Desktop (schmales Fenster) wo kein blur feuert
searchInput.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  clearTimeout(_searchDebounce);
  _geocodePending = false;
  clearGeocodeMarker();
  clearLocationFilter();
  const query = searchInput.value.trim();
  if (!query) {
    const list = filteredRaces();
    renderList(list);
    updateMarkers(list, true);
    return;
  }
  _geocodePending = true;
  renderList([]); // zeigt "Suche…"
  const ok = await geocodeFallback(query);
  if (!ok && searchInput.value.trim().toLowerCase() === query.toLowerCase()) {
    _geocodePending = false;
    const list = filteredRaces();
    renderList(list);
    updateMarkers(list, true);
  }
});

searchInput.addEventListener("blur", () => {
  if (!isMobile()) return;
  const query = searchInput.value.trim();
  clearGeocodeMarker();
  clearLocationFilter();
  // Wait for keyboard to fully dismiss so window.innerHeight is correct
  setTimeout(async () => {
    if (!query) {
      const list = filteredRaces();
      renderList(list);
      updateMarkers(list, true);
      return;
    }
    _geocodePending = true;
    renderList([]); // zeigt "Suche…"
    const ok = await geocodeFallback(query);
    if (!ok && searchInput.value.trim().toLowerCase() === query.toLowerCase()) {
      _geocodePending = false;
      const list = filteredRaces();
      renderList(list);
      updateMarkers(list, true);
    }
  }, 150);
});

if (filterToggleButton) {
  filterToggleButton.addEventListener("click", () => {
    isFilterPanelOpen = !isFilterPanelOpen;
    updateFilterPanelState();
  });
}

if (mobFilterBtn) {
  mobFilterBtn.addEventListener("click", () => {
    const topbar = mobFilterBtn.closest(".topbar");
    if (!topbar) return;
    const expanded = topbar.classList.toggle("mob-filters-expanded");
    mobFilterBtn.classList.toggle("active", expanded);
    mobFilterBtn.setAttribute("aria-expanded", String(expanded));

    const body = topbar.querySelector(".mob-filters-body");
    if (!body) return;

    if (expanded) {
      body.style.display = "flex";
      // Double RAF: first frame applies display:flex, second triggers transition
      requestAnimationFrame(() => requestAnimationFrame(() => {
        body.classList.add("is-expanded");
        updateSlidingPills();
      }));
    } else {
      body.classList.remove("is-expanded");
      // Wait specifically for max-height to finish (opacity ends 100ms earlier at 200ms;
      // { once: true } would fire on opacity, setting display:none while height is still animating)
      const onEnd = (e) => {
        if (e.propertyName !== "max-height") return;
        body.removeEventListener("transitionend", onEnd);
        if (!body.classList.contains("is-expanded")) body.style.display = "none";
      };
      body.addEventListener("transitionend", onEnd);
    }
  });
}

if (activeFilterChips) {
  activeFilterChips.addEventListener("click", event => {
    const button = event.target.closest("button[data-clear-filter]");
    if (!button) return;

    if (button.dataset.clearFilter === "search") {
      searchInput.value = "";
      clearGeocodeMarker();
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

let resizeRecenterTimer = null;
let resizeWasMobile = window.matchMedia("(max-width: 860px)").matches;
let _resizeBpCrossing = false;
window.addEventListener("resize", () => {
  const _isMobileCheck = window.matchMedia("(max-width: 860px)").matches;
  if (_isMobileCheck !== resizeWasMobile && !_resizeBpCrossing) {
    _resizeBpCrossing = true;
    document.body.classList.add("is-breakpoint-crossing");
  }
  clearTimeout(resizeRecenterTimer);
  resizeRecenterTimer = setTimeout(() => {
    resizeRecenterTimer = null;
    _resizeBpCrossing = false;
    if (!map) return;
    const isMobile = window.matchMedia("(max-width: 860px)").matches;
    const crossedBreakpoint = isMobile !== resizeWasMobile;
    resizeWasMobile = isMobile;
    map.invalidateSize({ pan: false });
    if (crossedBreakpoint && _locateBtn) {
      const desktopSlot = document.getElementById("locateDesktopSlot");
      if (isMobile) {
        document.body.appendChild(_locateBtn);
      } else if (desktopSlot) {
        desktopSlot.appendChild(_locateBtn);
      }
    }
    requestAnimationFrame(() => {
      positionCountryPillDesktop();
      document.body.classList.remove("is-breakpoint-crossing");
    });
    if (!lastVisibleCenter) return;
    if (isMobile && !crossedBreakpoint) return;
    const zoom = map.getZoom();
    panToVisible(lastVisibleCenter, zoom);
  }, 150);
});

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
    fetchJsonOrFallback(`myrcm-hosts-dach.json?v=${cacheBuster}`, []),
    fetchJsonOrFallback(`series.json?v=${cacheBuster}`, fallbackSeriesCatalog),
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
  _venueForRaceCache.clear();

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

  if (selectedCountry !== "all") _zoomToCountryPending = true;
  render();
  revealMapWhenReady();
  loadAds();
}

const _unsubUserId = new URLSearchParams(window.location.search).get("unsubscribe");
if (_unsubUserId) {
  (async () => {
    try {
      await fetch(`https://ncsqbncxctofkmabmwku.supabase.co/functions/v1/send-race-notifications?unsubscribe=${encodeURIComponent(_unsubUserId)}`);
    } catch (e) { /* ignore */ }
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:var(--bg,#f0f2f5);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
    overlay.innerHTML = `<div style="background:var(--panel,#fff);border-radius:16px;padding:48px 40px;max-width:380px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.1);">
      <svg width="36" height="40" viewBox="0 0 477 528.98" xmlns="http://www.w3.org/2000/svg" style="margin-bottom:20px;"><g fill="#C8B090"><path d="M249.52,205.37v66.26c22.09-2.98,44.17-5.96,66.26-6.71v-66.26c-22.09.75-44.17,3.73-66.26,6.71Z"/><path d="M477,238.5C477,106.78,370.22,0,238.5,0S0,106.78,0,238.5c0,111.19,76.09,204.61,179.04,231.03l59.46,59.46,59.46-59.46c102.95-26.42,179.04-119.84,179.04-231.03ZM382.05,271.63c-22.09-5.96-44.17-7.45-66.26-6.71v66.26c-22.09.75-44.17,3.73-66.26,6.71v-66.26c-22.09,2.98-44.17,5.96-66.26,6.71v66.26c-22.09.75-44.17-.75-66.26-6.71v-66.26c22.09,5.96,44.17,7.45,66.26,6.71v-66.26c-22.09.75-44.17-.75-66.26-6.71v-66.26c22.09,5.96,44.17,7.45,66.26,6.71v66.26c22.09-.75,44.17-3.73,66.26-6.71v-66.26c22.09-2.98,44.17-5.96,66.26-6.71v66.26c22.09-.75,44.17.75,66.26,6.71v66.26Z"/></g></svg>
      <h1 style="color:#213769;font-size:20px;margin:0 0 12px;font-weight:700;">Abgemeldet</h1>
      <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 28px;">Du erhältst keine E-Mail-Benachrichtigungen mehr.<br>Du kannst sie jederzeit in deinen Favoriten wieder aktivieren.</p>
      <a href="/" style="display:inline-block;background:#213769;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 28px;border-radius:999px;">Zur Karte</a>
    </div>`;
    document.body.appendChild(overlay);
  })();
} else {
  init().catch(error => {
    console.error(error);
    resultLine.textContent = "Fehler beim Laden der Daten.";
  });
}


/* ============================================================
   Mobile Bottom Drawer
   ============================================================ */

const mobDrawer       = document.getElementById("mobDrawer");
const mobDrawerHandle = document.getElementById("mobDrawerHandle");
const mobRaceList     = document.getElementById("mobRaceList");
const mobResultBadge  = document.getElementById("mobResultBadge");

const mobFilterMount = document.getElementById("mobFilterMount");

// ── Drawer snap state ──────────────────────────────────────────
const DRAWER_STATES = ["collapsed", "half", "full"];
let drawerState = "half";
let drawerStateBeforeVenue = null;
let listScrollBeforeVenue = null;

function setDrawerState(state) {
  drawerState = state;
  if (!mobDrawer) return;
  mobDrawer.classList.remove("mob-drawer--collapsed", "mob-drawer--half", "mob-drawer--full");
  mobDrawer.classList.add(`mob-drawer--${state}`);
  // Let Leaflet know the full map area is available regardless of drawer position.
  // pan:false prevents Leaflet from re-centering the map when the container size changes.
  if (map) requestAnimationFrame(() => map.invalidateSize({ pan: false }));
}

// ── Track filter section height via CSS variable ───────────────
// Chrome ignores padding-bottom in overflow:auto containers when height is
// flex-determined. Keeping max-height equal to the available space makes it
// the binding constraint so Chrome counts padding-bottom correctly in all states.
{
  const mobDrawerFiltersEl = mobDrawer?.querySelector(".mob-drawer-filters");
  if (mobDrawerFiltersEl && mobDrawer) {
    new ResizeObserver(() => {
      mobDrawer.style.setProperty("--mob-filters-h", mobDrawerFiltersEl.offsetHeight + "px");
    }).observe(mobDrawerFiltersEl);
  }
}

// ── Drag / swipe (touch-only, mobile breakpoint guard) ────────
const mobMq = window.matchMedia("(max-width: 860px)");
if (mobDrawer && mobDrawerHandle) {
  let dragStartY = 0;
  let dragStartTime = 0;
  let currentTranslateY = 0;
  let isDragging = false;

  function getSnapTranslateY(state) {
    const dh = window.innerHeight - 80; // drawer height = 100dvh - 80px (top offset)
    if (state === "collapsed") return dh - 64;
    if (state === "half")      return dh * 0.50;
    return 0; // full-open: drawer already at top:80px, no translation needed
  }

  function onDragStart(clientY) {
    isDragging = true;
    dragStartY = clientY;
    dragStartTime = Date.now();
    const transform = getComputedStyle(mobDrawer).transform;
    const matrix = new DOMMatrix(transform);
    currentTranslateY = matrix.m42;
    mobDrawer.classList.add("mob-drawer--dragging");
  }

  function onDragMove(clientY) {
    if (!isDragging) return;
    const delta = clientY - dragStartY;
    const dh = window.innerHeight - 80;
    const newY = Math.max(0, Math.min(dh - 64, currentTranslateY + delta));
    mobDrawer.style.transform = `translateY(${newY}px)`;
  }

  function onDragEnd(clientY) {
    if (!isDragging) return;
    isDragging = false;
    mobDrawer.classList.remove("mob-drawer--dragging");
    mobDrawer.style.transform = "";

    const delta = clientY - dragStartY;
    const velocity = delta / Math.max(1, Date.now() - dragStartTime); // px/ms
    const h = window.innerHeight;
    const finalY = currentTranslateY + delta;

    // Velocity-based snap: fast swipe → jump state
    if (Math.abs(velocity) > 0.4) {
      if (velocity < 0) {
        // Swipe up → next open state
        const nextState = drawerState === "collapsed" ? "half"
                        : drawerState === "half"      ? "full"
                        : "full";
        setDrawerState(nextState);
      } else {
        // Swipe down → next closed state
        const nextState = drawerState === "full"      ? "half"
                        : drawerState === "half"      ? "collapsed"
                        : "collapsed";
        setDrawerState(nextState);
      }
      return;
    }

    // Position-based snap (translateY relative to drawer top, which is already at 80px)
    const dh2 = h - 80;
    const halfY = dh2 * 0.50;
    const collY = dh2 - 64;
    if (finalY < halfY * 0.5) {
      setDrawerState("full");
    } else if (finalY < (halfY + collY) / 2) {
      setDrawerState("half");
    } else {
      setDrawerState("collapsed");
    }
  }

  // Touch events — only active on mobile breakpoint
  mobDrawerHandle.addEventListener("touchstart", e => {
    if (!mobMq.matches) return;
    onDragStart(e.touches[0].clientY);
  }, { passive: true });

  mobDrawer.addEventListener("touchmove", e => {
    if (!isDragging || !mobMq.matches) return;
    if (drawerState === "full") {
      // List scrolls natively in full state — never intercept touches on it
      if (mobRaceList && mobRaceList.contains(e.target)) return;
    }
    e.preventDefault();
    onDragMove(e.touches[0].clientY);
  }, { passive: false });

  document.addEventListener("touchend", e => {
    if (!isDragging || !mobMq.matches) return;
    onDragEnd(e.changedTouches[0].clientY);
  }, { passive: true });

  // Mouse drag (for desktop browser narrowed to mobile breakpoint)
  mobDrawerHandle.addEventListener("mousedown", e => {
    if (!mobMq.matches) return;
    e.preventDefault();
    onDragStart(e.clientY);
  });

  document.addEventListener("mousemove", e => {
    if (!isDragging || !mobMq.matches) return;
    onDragMove(e.clientY);
  });

  document.addEventListener("mouseup", e => {
    if (!isDragging || !mobMq.matches) return;
    onDragEnd(e.clientY);
  });

  // Keyboard accessibility on handle
  mobDrawerHandle.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const next = drawerState === "collapsed" ? "half"
                 : drawerState === "half"      ? "full"
                 : "collapsed";
      setDrawerState(next);
    }
    if (e.key === "ArrowUp")   setDrawerState(drawerState === "collapsed" ? "half" : "full");
    if (e.key === "ArrowDown") setDrawerState(drawerState === "full" ? "half" : "collapsed");
  });
}

// ── Sync result badge ──────────────────────────────────────────
function syncResultBadge(text) {
  if (!mobResultBadge) return;
  const idx = text.indexOf(' | ');
  if (idx !== -1) {
    mobResultBadge.innerHTML =
      escHtml(text.slice(0, idx)) + '<br>' + escHtml(text.slice(idx + 3));
  } else {
    mobResultBadge.textContent = text;
  }
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Patch resultLine to mirror text to mobile badge
if (resultLine) {
  const observer = new MutationObserver(() => syncResultBadge(resultLine.textContent));
  observer.observe(resultLine, { childList: true, characterData: true, subtree: true });
}

// ── DOM-move: entire topbar ↔ mobile drawer ───────────────────
// Moving the whole <header class="topbar"> preserves all CSS context,
// including sliding-pill, button styles, and search icon pseudo-elements
// which are all scoped to ".layout-prototype .topbar .something".
const _topbarEl     = document.querySelector(".layout-prototype .topbar");
const _topbarParent = _topbarEl?.parentNode;
const _topbarNext   = _topbarEl?.nextSibling;

function applyMobileLayout(isMobile) {
  if (!mobFilterMount || !_topbarEl) return;
  if (isMobile) {
    // Wrap the 4 filter groups in a collapsible container (mobile-only)
    if (!_topbarEl.querySelector(".mob-filters-body")) {
      const body = document.createElement("div");
      body.className = "mob-filters-body";
      body.style.display = "none";
      [".topbar-range", ".topbar-series", ".topbar-favorites", ".topbar-registration"].forEach(sel => {
        const el = _topbarEl.querySelector(sel);
        if (el) body.appendChild(el);
      });
      const ref = _topbarEl.querySelector(".mob-filter-btn") || _topbarEl.querySelector(".topbar-search");
      ref ? ref.before(body) : _topbarEl.appendChild(body);
    }
    mobFilterMount.appendChild(_topbarEl);
    requestAnimationFrame(updateSlidingPills);
  } else {
    // Unwrap filter groups back as direct topbar children before returning to desktop
    const body = _topbarEl.querySelector(".mob-filters-body");
    if (body) {
      body.classList.remove("is-expanded");
      _topbarEl.classList.remove("mob-filters-expanded");
      if (mobFilterBtn) {
        mobFilterBtn.classList.remove("active");
        mobFilterBtn.setAttribute("aria-expanded", "false");
      }
      const insertPoint = _topbarEl.querySelector(".mob-filter-btn") || body;
      Array.from(body.children).forEach(child => insertPoint.before(child));
      body.remove();
    }
    if (_topbarNext && _topbarNext.parentNode === _topbarParent) {
      _topbarParent.insertBefore(_topbarEl, _topbarNext);
    } else if (_topbarParent) {
      _topbarParent.appendChild(_topbarEl);
    }
    requestAnimationFrame(updateSlidingPills);
  }
}

// Handle breakpoint change
mobMq.addEventListener("change", e => {
  applyMobileLayout(e.matches);
  if (e.matches) syncMobRaceList();
  else render();
});

// Init
applyMobileLayout(mobMq.matches);

// ── Mobile race list rendering ─────────────────────────────────
// renderList renders into desktop raceList. We mirror cards into mobRaceList.
function syncMobRaceList() {
  if (!mobRaceList) return;
  mobRaceList.innerHTML = "";
  // Clone all children from desktop raceList
  raceList.childNodes.forEach(node => {
    mobRaceList.appendChild(node.cloneNode(true));
  });
  // Re-attach click/keydown on cloned cards
  mobRaceList.querySelectorAll(".race-card.is-clickable").forEach(card => {
    const raceId = card.dataset.raceId;
    card.addEventListener("click", event => {
      if (event.target.closest("[data-class-toggle]")) return;
      if (event.target.closest("[data-favorite-venue-id]")) return;
      if (event.target.closest("[data-favorite-host-id]")) return;
      if (event.target.closest("[data-notification-host-id]")) return;
      const race = races.find(r => String(r.id) === raceId);
      if (race) {
        drawerStateBeforeVenue = drawerState;
        setDrawerState("collapsed");
        focusRace(race);
      }
    });
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const race = races.find(r => String(r.id) === raceId);
        if (race) {
          drawerStateBeforeVenue = drawerState;
          setDrawerState("collapsed");
          focusRace(race);
        }
      }
    });
  });
  // Append footer links as last scrollable item
  const drawerFooterSrc = document.querySelector(".mob-drawer > .mob-drawer-footer");
  if (drawerFooterSrc) {
    mobRaceList.appendChild(drawerFooterSrc.cloneNode(true));
  }
  // Class-pills measurement
  requestAnimationFrame(() => {
    mobRaceList.querySelectorAll(".race-card").forEach(fitClassPills);
  });
}

// ── Class Pills measurement ────────────────────────────────────
function fitClassPills(card) {
  const container = card.querySelector(".race-class-tags");
  if (!container) return;

  // Reset: remove any previous more-button or desktop count-based toggle
  container.querySelectorAll(".tag-class-toggle, .tag-class-more").forEach(el => el.remove());
  const pills = Array.from(container.querySelectorAll(".tag-class"));
  if (!pills.length) return;

  pills.forEach(p => { p.style.display = ""; });

  const containerWidth = container.getBoundingClientRect().width;
  if (!containerWidth) return;

  // Direct wrap detection: fixed-height pills on the same flex row share the same
  // top value. Width-based totalW comparisons can fail due to sub-pixel rounding.
  const firstTop = pills[0].getBoundingClientRect().top;
  if (pills.every(p => Math.abs(p.getBoundingClientRect().top - firstTop) < 2)) return;

  const gap = 5; // matches .race-tags { gap: 5px }
  const widths = pills.map(p => p.getBoundingClientRect().width);

  // Probe more-button with worst-case text to get exact rendered width.
  // Absolutely positioned so it doesn't affect flex layout during measurement.
  const probe = document.createElement("button");
  probe.className = "tag tag-class tag-class-more";
  probe.type = "button";
  probe.textContent = `+${pills.length} weitere`;
  probe.style.cssText = "position:absolute;opacity:0;pointer-events:none";
  container.appendChild(probe);
  const moreBtnW = probe.getBoundingClientRect().width;
  probe.remove();

  // Find cut point: last index where pills[0..i] + gap + button still fits
  let usedW = 0;
  let cutAt = pills.length;
  for (let i = 0; i < pills.length; i++) {
    const next = usedW + (i > 0 ? gap : 0) + widths[i];
    if (next + gap + moreBtnW > containerWidth) {
      cutAt = i;
      break;
    }
    usedW = next;
    cutAt = i + 1;
  }

  if (pills.length - cutAt <= 0) return;

  for (let i = cutAt; i < pills.length; i++) {
    pills[i].style.display = "none";
  }

  const moreBtn = document.createElement("button");
  moreBtn.className = "tag tag-class tag-class-more";
  moreBtn.type = "button";
  moreBtn.textContent = `+${pills.length - cutAt} weitere`;
  container.appendChild(moreBtn);

  // Layout verification: if the button still wrapped to a new row (probe was
  // slightly off or sub-pixel rounding), hide one more pill and repeat.
  while (cutAt > 0) {
    const btnTop = moreBtn.getBoundingClientRect().top;
    const refTop = pills[cutAt - 1].getBoundingClientRect().top; // last visible pill
    if (Math.abs(btnTop - refTop) < 2) break;
    cutAt--;
    pills[cutAt].style.display = "none";
    moreBtn.textContent = `+${pills.length - cutAt} weitere`;
  }

  moreBtn.addEventListener("click", event => {
    event.stopPropagation();
    pills.forEach(p => { p.style.display = ""; });
    moreBtn.remove();

    const lessBtn = document.createElement("button");
    lessBtn.className = "tag tag-class tag-class-more";
    lessBtn.type = "button";
    lessBtn.textContent = "weniger anzeigen";
    lessBtn.addEventListener("click", ev => {
      ev.stopPropagation();
      lessBtn.remove();
      fitClassPills(card);
    });
    container.appendChild(lessBtn);
  });
  container.appendChild(moreBtn);
}

// ── Hook into renderList to sync mobile ───────────────────────
// Observe desktop raceList for changes and mirror to mobile
const mobRaceListObserver = new MutationObserver(() => {
  if (window.matchMedia("(max-width: 860px)").matches) {
    syncMobRaceList();
  } else {
    // Apply width-based pill trimming on desktop too (replaces count-based toggle)
    requestAnimationFrame(() => {
      raceList.querySelectorAll(".race-card").forEach(fitClassPills);
    });
  }
  syncResultBadge(resultLine.textContent);
});

if (raceList) {
  mobRaceListObserver.observe(raceList, { childList: true });
}

// Re-trim pills when a list container changes WIDTH (e.g. window resize, panel open/close).
// Width-only guard prevents infinite loops: fitClassPills changes container HEIGHT (fewer rows)
// which would re-trigger a naive observer, but width stays constant so we skip re-runs.
{
  const listWidths = new WeakMap();
  const pillResizeObs = new ResizeObserver(entries => {
    const toUpdate = [];
    for (const e of entries) {
      const w = Math.round(e.contentRect.width);
      if (listWidths.get(e.target) !== w) {
        listWidths.set(e.target, w);
        toUpdate.push(e.target);
      }
    }
    if (toUpdate.length) {
      requestAnimationFrame(() =>
        toUpdate.forEach(list => list.querySelectorAll(".race-card").forEach(fitClassPills))
      );
    }
  });
  if (raceList) pillResizeObs.observe(raceList);
  if (mobRaceList) pillResizeObs.observe(mobRaceList);
}

// ── Theme ─────────────────────────────────────────────────────
const THEME_KEY = "rcracemap-theme";

function isDarkActive() {
  const saved = localStorage.getItem(THEME_KEY) || "auto";
  if (saved === "dark") return true;
  if (saved === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme) {
  document.documentElement.classList.remove("theme-light", "theme-dark");
  if (theme === "light") document.documentElement.classList.add("theme-light");
  if (theme === "dark")  document.documentElement.classList.add("theme-dark");

  const dark = isDarkActive();
  Object.assign(rcRaceMapColors, dark ? rcRaceMapColorsDark : rcRaceMapColorsLight);

  const mlMap = baseMapLayer?.getMaplibreMap?.();
  if (mlMap?.isStyleLoaded?.()) {
    const url = dark
      ? `https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json?api_key=${stadiaApiKey}`
      : `https://tiles.stadiamaps.com/styles/alidade_smooth.json?api_key=${stadiaApiKey}`;
    mlMap.setStyle(url);
  }

  if (venues?.length) {
    updateMarkers(filteredRaces(), false);
  }
  if (_geocodeMarkerCoords) setGeocodeMarker(_geocodeMarkerCoords.lat, _geocodeMarkerCoords.lng);
}

function setTheme(theme) {
  document.documentElement.classList.add("theme-transitioning");
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
  document.querySelectorAll(".theme-toggle-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.theme === theme);
  });
  sbSaveTheme(theme);
  setTimeout(() => document.documentElement.classList.remove("theme-transitioning"), 400);
}

applyTheme(localStorage.getItem(THEME_KEY) || "auto");

// ── App menu panel ────────────────────────────────────────────
const appMenuPanel   = document.getElementById("appMenuPanel");
const appMenuOverlay = document.getElementById("appMenuOverlay");
const appMenuContent = document.getElementById("appMenuContent");
const appMenuClose   = document.getElementById("appMenuClose");
const menuButtons    = [
  document.getElementById("appMenuButton"),
  document.getElementById("mobMenuBtn"),
];

function openAppMenu() {
  appMenuPanel?.classList.add("is-open");
  appMenuOverlay?.classList.add("is-open");
  appMenuPanel?.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-menu-open");
  menuButtons.forEach(b => b?.setAttribute("aria-label", "Menü schließen"));
}

function closeAppMenu() {
  appMenuPanel?.classList.remove("is-open");
  appMenuOverlay?.classList.remove("is-open");
  appMenuPanel?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-menu-open");
  menuButtons.forEach(b => b?.setAttribute("aria-label", "Menü öffnen"));
  const fp = document.getElementById("favoritesPage");
  if (fp) fp.hidden = true;
  showMenuHome();
}

const lessrainSvg = `<svg viewBox="0 0 82.21 14.42" xmlns="http://www.w3.org/2000/svg" class="app-menu-footer-logo" aria-label="Lessrain"><g><path d="M6.11,10.53c0,.36-.02,1.03.08,1.35.22.73,1.13.38,1.13,1.23,0,1.35-2.46,1.25-3.33,1.25s-3.73.1-3.73-1.33c0-.71.87-.44,1.11-1.19.26-.83.26-3.35.26-4.34,0-.79.04-2.3-.14-3.21C1.19,2.8,0,3.33,0,2.18,0,.42,5.24,0,5.53,0,6.21,0,6.37.44,6.37,1.05c0,.46-.26,2.68-.26,5.57v3.91Z"/><path d="M13.41,6.96c0-.73-.44-1.29-1.19-1.29-.67,0-1.21.69-1.21,1.33,0,.73.69.57,1.21.57s1.19.12,1.19-.61M11.66,9.5c-.22,0-.54-.06-.54.28,0,1.01,1.31,1.86,2.26,1.86,1.51,0,2.26-.91,2.68-.91s.79.63.79,1.01c0,1.55-2.84,2.68-4.66,2.68-3.63,0-5.51-2.62-5.51-5.22,0-3.11,2.64-5.37,5.67-5.37,3.43,0,4.94,2.64,4.94,4.16,0,1.33-.6,1.51-1.25,1.51h-4.38Z"/><path d="M22.59,3.95c.36.06.69.14.83.14.2,0,.36-.06.55-.14.18-.06.36-.12.54-.12.93,0,1.86,1.86,1.86,2.68,0,.55-.46.95-.99.95-1.15,0-1.8-1.59-2.68-1.59-.36,0-.73.3-.73.69,0,1.29,4.44,1.53,4.44,4.66,0,1.9-1.84,3.21-3.93,3.21-.4,0-.99-.06-1.49-.14-.5-.06-.95-.12-1.07-.12-.14,0-.26.02-.4.04-.12.02-.24.04-.38.04-.4,0-.6-.06-.89-.38-.5-.56-1.01-1.71-1.01-2.48,0-.52.18-.95.77-.95.89,0,1.69,2,2.82,2,.4,0,.79-.2.79-.64,0-1.19-3.95-1.33-3.95-4.66,0-2.02,1.65-3.29,3.73-3.29.4,0,.83.04,1.21.12"/><path d="M32.29,3.95c.36.06.69.14.83.14.2,0,.36-.06.55-.14.18-.06.36-.12.54-.12.93,0,1.86,1.86,1.86,2.68,0,.55-.46.95-.99.95-1.15,0-1.8-1.59-2.68-1.59-.36,0-.73.3-.73.69,0,1.29,4.44,1.53,4.44,4.66,0,1.9-1.83,3.21-3.93,3.21-.4,0-.99-.06-1.49-.14-.5-.06-.95-.12-1.07-.12-.14,0-.26.02-.4.04-.12.02-.24.04-.38.04-.4,0-.6-.06-.89-.38-.51-.56-1.01-1.71-1.01-2.48,0-.52.18-.95.77-.95.89,0,1.69,2,2.82,2,.4,0,.79-.2.79-.64,0-1.19-3.95-1.33-3.95-4.66,0-2.02,1.65-3.29,3.73-3.29.4,0,.83.04,1.21.12"/><path d="M40.05,8.03c0-1.98-1.25-.87-1.25-2.1,0-1.59,4.72-2.04,4.9-2.04.77,0,.79.2.87.89.02.24,0,.71.34.71.48,0,.79-1.59,2.52-1.59,1.35,0,2.24,1.01,2.24,2.34s-1.15,2.42-2.48,2.42-1.67-1.15-2.2-1.15c-.56,0-.46,1.35-.46,1.71,0,.61.06,1.45.16,2.22.12.89,1.65.34,1.65,1.55s-1.77,1.37-3.99,1.37c-.93,0-3.67.04-3.67-1.35,0-.85.93-.85,1.15-1.55.16-.5.22-1.65.22-2.22v-1.21Z"/><path d="M53.48,11.09c0,.52.28,1.09.87,1.09.77,0,.83-.83.83-1.43,0-.44.02-.95-.54-.95-.69,0-1.15.64-1.15,1.29M59.54,9.32c0,3.55,1.21,1.61,1.21,2.7,0,1.15-1.57,2.4-3.04,2.4-1.59,0-1.63-1.03-2.14-1.03-.24,0-.51.26-.95.5-.44.26-1.05.53-1.98.53-1.67,0-3.35-.89-3.35-2.88,0-1.43,1.37-3.21,4.92-3.21.63,0,.91.04.91-.69,0-.67-.02-2.06-.95-2.06-1.21,0-1.33,2.18-3.13,2.18-.65,0-1.13-.46-1.13-1.11,0-1.71,3.41-2.82,5.32-2.82,1.15,0,4.3.44,4.3,3.47v2.02Z"/><path d="M62.78,3.25c-.85,0-1.75-.38-1.75-1.37C61.03.54,63.69,0,64.72,0c.81,0,1.96.26,1.96,1.27,0,1.57-2.74,1.98-3.89,1.98M66.78,10.41c0,2.38,1.19,1.51,1.19,2.58,0,1.37-2.56,1.37-3.47,1.37-3.47,0-3.61-.79-3.61-1.27,0-.73.83-.77,1.07-1.39.26-.71.3-3.63.08-4.38-.18-.71-1.21-.48-1.21-1.39,0-1.43,5.12-2.04,5.33-2.04.61,0,.62.46.62.89v5.63Z"/><path d="M74.2,10.77c0,1.96.69,1.61.69,2.38,0,1.25-2.68,1.21-3.51,1.21s-2.86,0-2.86-1.21c0-.97.93-.1.99-2.08l.08-3.03c.04-1.49-1.19-1.01-1.19-2.08s4.64-2.08,5.04-2.08c.44,0,.73.38.73.79,0,.12-.02.24-.02.36,0,.24.1.52.4.52.32,0,.5-.42.91-.85.4-.4,1.01-.83,2.16-.83,4.18,0,3.47,4.09,3.67,7.16.1,1.59.93,1.23.93,2.1,0,.36.08,1.21-3.71,1.21-.73,0-2.66.04-2.66-1.09,0-.73.67-.38.77-1.69.1-1.43.67-4.66-1.23-4.66-1.29,0-1.17,1.39-1.17,2.3v1.55Z"/></g></svg>`;

function showMenuHome() {
  if (!appMenuContent) return;
  const current = localStorage.getItem(THEME_KEY) || "auto";
  const chevron = `<svg class="app-menu-row-chevron" viewBox="0 0 14 14"><polyline points="5,2 10,7 5,12"/></svg>`;
  const iconStar = `<svg viewBox="0 0 24 24"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>`;
  const iconBell = `<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
  const iconSun = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
  const iconPin = `<svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  const iconInfo = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  const iconUser = `<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

  const authSection = sbUser
    ? `<div class="app-menu-auth-user">
        <span class="app-menu-auth-avatar">${sbUser.email[0].toUpperCase()}</span>
        <div class="app-menu-auth-info">
          <span class="app-menu-auth-email">${maskEmail(sbUser.email)}</span>
          <span class="app-menu-auth-status">Angemeldet</span>
        </div>
        <button type="button" class="app-menu-auth-signout" id="sbSignOutBtn">Abmelden</button>
      </div>`
    : `<button type="button" class="app-menu-row" id="sbLoginBtn">
        <span class="app-menu-row-icon">${iconUser}</span>
        <span class="app-menu-row-label">Anmelden &amp; Favoriten</span>
        ${chevron}
      </button>`;

  appMenuContent.innerHTML = `
    ${authSection}
    <div class="app-menu-sep"></div>
    <div class="app-menu-row app-menu-theme-row">
      <span class="app-menu-row-icon">${iconSun}</span>
      <span class="app-menu-row-label">Darstellung</span>
      <div class="theme-toggle">
        <button type="button" class="theme-toggle-btn${current==="auto"?" active":""}" data-theme="auto">Auto</button>
        <button type="button" class="theme-toggle-btn${current==="light"?" active":""}" data-theme="light">Tag</button>
        <button type="button" class="theme-toggle-btn${current==="dark"?" active":""}" data-theme="dark">Nacht</button>
      </div>
    </div>
    ${sbUser ? `
    <button type="button" class="app-menu-row" data-menu="favorites">
      <span class="app-menu-row-icon">${iconStar}</span>
      <span class="app-menu-row-label">Favoriten</span>
      ${chevron}
    </button>
` : ""}
    <div class="app-menu-sep"></div>
    <button type="button" class="app-menu-row" data-menu="about">
      <span class="app-menu-row-icon">${iconInfo}</span>
      <span class="app-menu-row-label">Über RC RaceMap</span>
      ${chevron}
    </button>
    <button type="button" class="app-menu-row" data-menu="impressum">
      <span class="app-menu-row-icon">${iconInfo}</span>
      <span class="app-menu-row-label">Impressum &amp; Datenschutz</span>
      ${chevron}
    </button>
    ${isAdmin() ? `
    <div class="app-menu-sep"></div>
    <button type="button" class="app-menu-row" data-menu="admin">
      <span class="app-menu-row-icon">${iconPin}</span>
      <span class="app-menu-row-label">Ausrichter verorten</span>
      ${chevron}
    </button>` : ""}
    <div class="app-menu-footer">
      <a href="https://lessrain.com" target="_blank" rel="noopener noreferrer" class="app-menu-footer-brand">
        ${lessrainSvg}
      </a>
      <div class="app-menu-footer-legal">
        <div class="app-menu-footer-legal-row">
          <span>Daten:</span>
          <a href="https://www.myrcm.ch" target="_blank" rel="noopener noreferrer" class="app-menu-footer-link">MyRCM</a>
          <span>·</span>
          <a href="https://www.rck-solutions.de/" target="_blank" rel="noopener noreferrer" class="app-menu-footer-link">RCK</a>
          <span>·</span>
          <span>Karte:</span>
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" class="app-menu-footer-link">OpenStreetMap</a>
        </div>
      </div>
    </div>`;

  appMenuContent.querySelectorAll(".theme-toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => setTheme(btn.dataset.theme));
  });
  appMenuContent.querySelectorAll("[data-menu]").forEach(btn => {
    btn.addEventListener("click", () => showMenuPage(btn.dataset.menu));
  });
  document.getElementById("sbLoginBtn")?.addEventListener("click", () => showMenuPage("login"));
  document.getElementById("sbSignOutBtn")?.addEventListener("click", async () => {
    await sbSignOut();
    showMenuHome();
  });
}

function maskEmail(email) {
  const [local, domain] = email.split("@");
  const [domName, ...domExt] = domain.split(".");
  const mask = s => s[0] + "*".repeat(Math.max(1, s.length - 2)) + s[s.length - 1];
  return `${mask(local)}@${mask(domName)}.${domExt.join(".")}`;
}

function loginPageHtml() {
  return `
    <div class="app-menu-login-form">
      <p class="app-menu-login-info">Gib deine E-Mail-Adresse ein. Du erhältst einen Link zum Anmelden — kein Passwort nötig.</p>
      <input type="email" id="sbEmailInput" class="app-menu-login-input" placeholder="deine@email.de" autocomplete="email" />
      <button type="button" class="app-menu-login-submit" id="sbLoginSubmit">Link senden</button>
      <p class="app-menu-login-hint" id="sbLoginHint"></p>
    </div>`;
}


const ADMIN_EMAILS = ["carsten@lessrain.com", "carsten@lessrain.net"];
const EXCLUDED_MYRCM_ORG_IDS = new Set(["60453"]); // Slottis Supreme Masters
function isAdmin() { return sbUser && ADMIN_EMAILS.includes(sbUser.email.toLowerCase()); }

const GITHUB_REPO = "CarstenSchneider/myrcm-rc-map";
const IS_DEV_SITE = window.location.hostname === "dev.rcracemap.com";
const GITHUB_BRANCH = IS_DEV_SITE ? "dev" : "main";
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}`;
const SB_ADMIN_FN = `${SUPABASE_URL}/functions/v1/admin-commit`;

async function adminLoadUnmatched() {
  const [unmatchedRes, seedsRes] = await Promise.all([
    fetch(`${RAW_BASE}/venue-unmatched.json?t=${Date.now()}`),
    fetch(`${RAW_BASE}/venue-seeds.json?t=${Date.now()}`),
  ]);
  const unmatched = (await unmatchedRes.json()).filter(u => !EXCLUDED_MYRCM_ORG_IDS.has(String(u.myrcmOrgId ?? "")));
  const seeds = await seedsRes.json();
  const unknownSeeds = seeds
    .filter(s => s.locationUnknown)
    .map(s => ({ hostId: s.hostId || s.id, hostName: s.hostName || s.name, myrcmOrgId: s.myrcmOrgId || null, locationUnknown: true }));
  // Merge: unmatched first, then unknown seeds not already in unmatched
  const unmatchedIds = new Set(unmatched.map(u => u.hostId));
  return [...unmatched, ...unknownSeeds.filter(s => !unmatchedIds.has(s.hostId))];
}

async function adminCommit(payload) {
  const { data: { session } } = await sbClient.auth.getSession();
  const res = await fetch(SB_ADMIN_FN, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
    body: JSON.stringify({ ...payload, branch: GITHUB_BRANCH })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function showLoginPrompt() {
  const existing = document.getElementById("loginPrompt");
  if (existing) return;

  const overlay = document.createElement("div");
  overlay.id = "loginPrompt";
  overlay.className = "login-prompt-overlay";
  overlay.innerHTML = `
    <div class="login-prompt-card">
      <button type="button" class="login-prompt-close" id="loginPromptClose" aria-label="Schließen">
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><line x1="1" y1="1" x2="13" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="13" y1="1" x2="1" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
      <svg class="app-menu-logo-pin" viewBox="0 0 477 528.98" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g fill="#C8B090"><path d="M249.52,205.37v66.26c22.09-2.98,44.17-5.96,66.26-6.71v-66.26c-22.09.75-44.17,3.73-66.26,6.71Z"/><path d="M477,238.5C477,106.78,370.22,0,238.5,0S0,106.78,0,238.5c0,111.19,76.09,204.61,179.04,231.03l59.46,59.46,59.46-59.46c102.95-26.42,179.04-119.84,179.04-231.03ZM382.05,271.63c-22.09-5.96-44.17-7.45-66.26-6.71v66.26c-22.09.75-44.17,3.73-66.26,6.71v-66.26c-22.09,2.98-44.17,5.96-66.26,6.71v66.26c-22.09.75-44.17-.75-66.26-6.71v-66.26c22.09,5.96,44.17,7.45,66.26,6.71v-66.26c-22.09.75-44.17-.75-66.26-6.71v-66.26c22.09,5.96,44.17,7.45,66.26,6.71v66.26c22.09-.75,44.17-3.73,66.26-6.71v-66.26c22.09-2.98,44.17-5.96,66.26-6.71v66.26c22.09-.75,44.17.75,66.26,6.71v66.26Z"/></g></svg>
      <p class="login-prompt-text">Melde dich an um Favoriten zu speichern und Benachrichtigungen zu erhalten.</p>
      <button type="button" class="login-prompt-btn" id="loginPromptBtn">Anmelden</button>
    </div>`;

  const close = () => overlay.remove();
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  overlay.querySelector("#loginPromptClose")?.addEventListener("click", close);
  overlay.querySelector("#loginPromptBtn")?.addEventListener("click", () => {
    close();
    openAppMenu();
    showMenuPage("login");
  });
}

function openAboutPage() {
  const page = document.getElementById("aboutPage");
  const content = document.getElementById("aboutPageContent");
  if (!page || !content) return;
  closeAppMenu();
  content.innerHTML = aboutHtml();
  page.hidden = false;
  document.getElementById("aboutPageBack")?.addEventListener("click", () => {
    page.hidden = true;
    openAppMenu();
  }, { once: true });
}

function openImpressumPage() {
  const page = document.getElementById("impressumPage");
  const content = document.getElementById("impressumPageContent");
  if (!page || !content) return;
  closeAppMenu();
  content.innerHTML = impressumHtml();
  page.hidden = false;
  document.getElementById("impressumPageBack")?.addEventListener("click", () => {
    page.hidden = true;
    openAppMenu();
  }, { once: true });
}

function renderAdminStreckenTab(container) {
  container.innerHTML = `<p class="admin-loading">Lade…</p>`;

  Promise.all([
    adminLoadUnmatched(),
    fetch(`${RAW_BASE}/venue-seeds.json?t=${Date.now()}`).then(r => r.json()),
  ]).then(([entries, seeds]) => {
    const pendingSeeds = seeds.filter(s => s.source === "geocoded-nominatim-dach");
    const totalDach = seeds.filter(s => s.source === "geocoded-nominatim-dach" || s.source === "verified").length;
    const alreadyDone = totalDach - pendingSeeds.length;

    container.innerHTML = "";

    // --- Section 1: Nicht zugeordnet ---
    const sec1 = document.createElement("div");
    sec1.className = "admin-section";

    if (!entries.length) {
      sec1.innerHTML = `<p class="admin-section-title">Nicht zugeordnet</p><p class="admin-empty">Alle Strecken sind zugeordnet.</p>`;
    } else {
      sec1.innerHTML = `<p class="admin-section-title">Nicht zugeordnet (${entries.length})</p>` +
        entries.map((e, i) => `
          <div class="admin-entry" data-index="${i}" data-host-id="${escapeHtml(e.hostId)}" data-myrcm-org-id="${escapeHtml(e.myrcmOrgId || "")}" data-host-name="${escapeHtml(e.hostName)}">
            <div class="admin-entry-header">
              <strong>${escapeHtml(e.hostName)}</strong>
              <span class="admin-entry-meta">${escapeHtml(e.possibleVenue || "")}${e.myrcmOrgId ? ` · MyRCM #${e.myrcmOrgId}` : ""}</span>
            </div>
            ${e.myrcmOrgId ? `<a class="admin-entry-link" href="https://www.myrcm.ch/myrcm/main?hId[1]=org&dId[O]=${e.myrcmOrgId}&pLa=de" target="_blank" rel="noopener">MyRCM-Seite ↗</a>` : ""}
            <label class="admin-entry-toggle">
              <input type="checkbox" class="admin-unknown-toggle"${e.locationUnknown ? " checked" : ""} />
              Ort unbekannt
            </label>
            <div class="admin-entry-coords"${e.locationUnknown ? " hidden" : ""}>
              <input type="text" class="admin-input admin-input-coords" placeholder="z.B. 51.077, 7.288" data-field="coords" />
            </div>
            <div class="admin-entry-actions">
              <button type="button" class="admin-btn admin-btn-save">Speichern</button>
            </div>
            <p class="admin-entry-status"></p>
          </div>`).join("");

      sec1.addEventListener("change", ev => {
        if (!ev.target.classList.contains("admin-unknown-toggle")) return;
        ev.target.closest(".admin-entry").querySelector(".admin-entry-coords").hidden = ev.target.checked;
      });

      sec1.addEventListener("click", async ev => {
        if (!ev.target.classList.contains("admin-btn-save")) return;
        const entry = ev.target.closest(".admin-entry");
        const status = entry.querySelector(".admin-entry-status");
        const hostId = entry.dataset.hostId;
        const hostName = entry.dataset.hostName;
        const myrcmOrgId = entry.dataset.myrcmOrgId;
        const isUnknown = entry.querySelector(".admin-unknown-toggle").checked;
        status.textContent = "Speichern…";
        try {
          if (isUnknown) {
            await adminCommit({ action: "mark-unknown", hostId, hostName, myrcmOrgId: myrcmOrgId || null });
          } else {
            const parts = entry.querySelector("[data-field=coords]").value.split(",").map(s => parseFloat(s.trim()));
            const [lat, lng] = parts;
            if (parts.length < 2 || isNaN(lat) || isNaN(lng)) { status.textContent = "Format: 51.077, 7.288"; return; }
            await adminCommit({ action: "add-venue", hostId, hostName, myrcmOrgId: myrcmOrgId || null, lat, lng });
          }
          status.textContent = "✓ Gespeichert";
          entry.classList.add("admin-entry-done");
        } catch (e) { status.textContent = `Fehler: ${e.message}`; }
      });
    }

    container.appendChild(sec1);

    // --- Section 2: Koordinaten prüfen ---
    const sec2 = document.createElement("div");
    sec2.className = "admin-section";

    if (!pendingSeeds.length) {
      sec2.innerHTML = `<p class="admin-section-title">Koordinaten prüfen</p><p class="admin-empty">✓ Alle ${totalDach} verifiziert.</p>`;
    } else {
      sec2.innerHTML = `<p class="admin-section-title">Koordinaten prüfen</p><div class="js-dach-wrap"></div>`;
      const wrap = sec2.querySelector(".js-dach-wrap");
      let idx = 0;

      function renderDachEntry() {
        const s = pendingSeeds[idx];
        const mapsUrl = s.lat && s.lng ? `https://www.google.com/maps?q=${s.lat},${s.lng}` : null;
        const doneCount = alreadyDone + idx;
        const pct = Math.round(doneCount / totalDach * 100);
        wrap.innerHTML = `
          <div class="admin-dach-progress">
            <span>${doneCount} / ${totalDach} verifiziert</span>
            <div class="admin-dach-bar"><div class="admin-dach-bar-fill" style="width:${pct}%"></div></div>
          </div>
          <div class="admin-entry">
            <div class="admin-entry-header">
              <strong>${escapeHtml(s.name)}</strong>
              <span class="admin-entry-meta">${escapeHtml(s.city || "")}${s.myrcmOrgId ? ` · MyRCM #${s.myrcmOrgId}` : ""}</span>
            </div>
            <div style="display:flex;gap:8px;margin:4px 0 8px;flex-wrap:wrap;">
              ${s.myrcmOrgId ? `<a class="admin-entry-link" href="https://www.myrcm.ch/myrcm/main?hId[1]=org&dId[O]=${s.myrcmOrgId}&pLa=de" target="_blank" rel="noopener">MyRCM ↗</a>` : ""}
              ${mapsUrl ? `<a class="admin-entry-link" href="${mapsUrl}" target="_blank" rel="noopener">Karte (${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}) ↗</a>` : ""}
            </div>
            <div class="admin-entry-coords">
              <input type="text" class="admin-input admin-input-coords js-dach-coords" placeholder="48.123, 14.456" value="${s.lat && s.lng ? `${s.lat}, ${s.lng}` : ""}" />
            </div>
            <div class="admin-entry-actions" style="flex-wrap:wrap;gap:8px;">
              <button type="button" class="admin-btn admin-btn-ok js-dach-ok">✓ Stimmt so</button>
              <button type="button" class="admin-btn admin-btn-save js-dach-save">Korrigieren & Weiter</button>
              <button type="button" class="admin-btn admin-btn-unknown js-dach-unknown">Kein Platz bekannt</button>
              <button type="button" class="admin-btn admin-btn-delete js-dach-delete">Löschen</button>
              ${idx > 0 ? `<button type="button" class="admin-btn admin-btn-unknown js-dach-prev" style="margin-left:auto;">← Zurück</button>` : ""}
            </div>
            <p class="admin-entry-status js-dach-status"></p>
          </div>`;

        const status = wrap.querySelector(".js-dach-status");

        async function saveSeed(lat, lng, locationUnknown = false) {
          status.textContent = "Speichern…";
          try {
            const payload = locationUnknown
              ? { action: "verify-dach-seed", seedId: s.id, seedName: s.name, locationUnknown: true }
              : { action: "verify-dach-seed", seedId: s.id, seedName: s.name, lat, lng };
            await adminCommit(payload);
            pendingSeeds.splice(idx, 1);
            if (!pendingSeeds.length) {
              wrap.innerHTML = `<p class="admin-empty">✓ Alle ${totalDach} verifiziert.</p>`;
            } else {
              if (idx >= pendingSeeds.length) idx = pendingSeeds.length - 1;
              renderDachEntry();
            }
          } catch (e) { status.textContent = `Fehler: ${e.message}`; }
        }

        async function deleteSeed() {
          status.textContent = "Löschen…";
          try {
            await adminCommit({ action: "delete-dach-seed", seedId: s.id, seedName: s.name });
            pendingSeeds.splice(idx, 1);
            if (idx >= pendingSeeds.length) idx = Math.max(0, pendingSeeds.length - 1);
            if (!pendingSeeds.length) {
              wrap.innerHTML = `<p class="admin-empty">✓ Alle AT/CH Clubs bearbeitet.</p>`;
            } else {
              renderDachEntry();
            }
          } catch (e) { status.textContent = `Fehler: ${e.message}`; }
        }

        wrap.querySelector(".js-dach-ok").addEventListener("click", () => {
          if (!s.lat || !s.lng) { status.textContent = "Keine Koordinaten vorhanden"; return; }
          saveSeed(s.lat, s.lng);
        });
        wrap.querySelector(".js-dach-save").addEventListener("click", () => {
          const parts = wrap.querySelector(".js-dach-coords").value.split(",").map(x => parseFloat(x.trim()));
          const [lat, lng] = parts;
          if (parts.length < 2 || isNaN(lat) || isNaN(lng)) { status.textContent = "Format: 48.123, 14.456"; return; }
          saveSeed(lat, lng);
        });
        wrap.querySelector(".js-dach-unknown").addEventListener("click", () => saveSeed(null, null, true));
        wrap.querySelector(".js-dach-delete").addEventListener("click", deleteSeed);
        wrap.querySelector(".js-dach-prev")?.addEventListener("click", () => { idx--; renderDachEntry(); });
      }

      renderDachEntry();
    }

    container.appendChild(sec2);
  }).catch(e => {
    container.innerHTML = `<p class="admin-error">Fehler: ${e.message}</p>`;
  });
}

function openAdminPage() {
  const adminPage = document.getElementById("adminPage");
  const listEl = document.getElementById("adminPageList");
  if (!adminPage || !listEl) return;

  closeAppMenu();
  adminPage.hidden = false;

  listEl.innerHTML = `
    <div class="admin-tabs">
      <button class="admin-tab is-active" data-tab="strecken">Strecken</button>
      <button class="admin-tab" data-tab="ads">Werbung</button>
    </div>
    <div id="adminTabContent"></div>`;

  const tabContent = listEl.querySelector("#adminTabContent");

  function showTab(name) {
    listEl.querySelectorAll(".admin-tab").forEach(t => t.classList.toggle("is-active", t.dataset.tab === name));
    if (name === "ads") {
      renderAdminAdsTab(tabContent);
    } else {
      renderAdminStreckenTab(tabContent);
    }
  }

  listEl.querySelector(".admin-tabs").addEventListener("click", ev => {
    const tab = ev.target.closest("[data-tab]")?.dataset.tab;
    if (tab) showTab(tab);
  });

  document.getElementById("adminPageBack")?.addEventListener("click", () => {
    adminPage.hidden = true;
    openAppMenu();
  }, { once: true });

  showTab("strecken");
}


let _favPageReady = false;
let _favResizeObserver = null;
function openFavoritesPage() {
  const page = document.getElementById("favoritesPage");
  if (!page) return;
  page.hidden = false;

  if (sbUser) {
    Promise.all([sbPullFavorites(), sbPullNotifications()]).then(() => {
      renderFavoritesPage((document.getElementById("favSearch")?.value || "").trim().toLowerCase());
    });
  }

  if (!_favPageReady) {
    _favPageReady = true;
    document.getElementById("favoritesPageBack")?.addEventListener("click", () => {
      page.hidden = true;
      void document.body.offsetHeight;
      openAppMenu();
    });
    const currentQuery = () => (document.getElementById("favSearch")?.value || "").trim().toLowerCase();
    page.addEventListener("click", e => {
      const tab = e.target.closest(".fav-tab");
      if (tab) {
        page.querySelectorAll(".fav-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const which = tab.dataset.favTab;
        document.getElementById("favColMine")?.classList.toggle("fav-col-active", which === "mine");
        document.getElementById("favColAll")?.classList.toggle("fav-col-active", which === "all");
        return;
      }
      const bellBtn = e.target.closest(".fav-bell-btn");
      if (bellBtn) {
        const venueId = bellBtn.dataset.venueId;
        if (venueId) toggleNotification(venueId).then(() => syncNotificationUi(venueId));
        return;
      }
      const btn = e.target.closest(".fav-star-btn");
      if (!btn) return;
      const venueId = btn.dataset.venueId;
      if (!venueId) return;
      toggleFavoriteHost(venueId);
      renderFavoritesPage(currentQuery());
    });
    document.getElementById("favSearch")?.addEventListener("input", e => {
      renderFavoritesPage(e.target.value.trim().toLowerCase());
    });
  }

  document.getElementById("favSearch").value = "";

  const body = page.querySelector(".fav-page-body");
  const tabs = page.querySelector(".fav-tabs");
  const applyLayout = () => {
    const isMobile = window.innerWidth <= 860;
    body?.classList.toggle("fav-mobile", isMobile);
    tabs?.classList.toggle("fav-tabs-visible", isMobile);
  };
  applyLayout();

  if (!_favResizeObserver) {
    _favResizeObserver = new ResizeObserver(applyLayout);
  }
  _favResizeObserver.observe(document.documentElement);

  document.getElementById("favColMine")?.classList.add("fav-col-active");
  document.getElementById("favColAll")?.classList.remove("fav-col-active");
  page.querySelectorAll(".fav-tab").forEach((t, i) => t.classList.toggle("active", i === 0));
  renderFavoritesPage("");
}

function renderFavoritesPage(query) {
  const listMine = document.getElementById("favListMine");
  const listAll  = document.getElementById("favListAll");
  const countMine = document.getElementById("favCountMine");
  const countAll  = document.getElementById("favCountAll");
  if (!listMine || !listAll) return;

  const favIds = new Set(getFavoriteHostIds());

  const allVenues = venues
    .filter(v => v.name)
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  const filtered = query
    ? allVenues.filter(v => (v.name + " " + (v.city || "")).toLowerCase().includes(query))
    : allVenues;

  const venueIsFav = v => {
    if (favIds.has(String(v.id))) return true;
    if (v.hostId && favIds.has(String(v.hostId))) return true;
    if (Array.isArray(v.hostIds)) return v.hostIds.some(id => favIds.has(String(id)));
    return false;
  };
  const mine = filtered.filter(v => venueIsFav(v));
  const rest  = filtered.filter(v => !venueIsFav(v));

  const _bellSvgFav = _bellIconSvg("fav-bell-icon");

  // Return the ID actually stored in favorites (or the best candidate for storing)
  const venueCanonicalId = v => {
    const candidates = [v.id, v.hostId, ...(Array.isArray(v.hostIds) ? v.hostIds : [])].filter(Boolean).map(String);
    const stored = candidates.find(id => favIds.has(id));
    return stored ?? candidates[0];
  };

  const rowHtml = (v, isFav) => {
    const cid = venueCanonicalId(v);
    const notifOn = sbUser && isNotificationEnabled(cid);
    const bellBtn = sbUser && isFav
      ? `<button type="button" class="fav-bell-btn${notifOn ? " active" : ""}" data-venue-id="${escapeHtml(cid)}" aria-label="${notifOn ? "Benachrichtigungen deaktivieren" : "Per E-Mail benachrichtigen"}">${_bellSvgFav}</button>`
      : "";
    return `
    <div class="fav-row" data-venue-id="${escapeHtml(v.id)}">
      <div class="fav-row-info">
        <div class="fav-row-name">${escapeHtml(v.name)}</div>
        ${v.city ? `<div class="fav-row-city">${escapeHtml(v.city)}</div>` : ""}
      </div>
      <div class="fav-row-actions">
        ${bellBtn}
        <button type="button" class="fav-star-btn${isFav ? " active" : ""}" data-venue-id="${escapeHtml(cid)}" aria-label="${isFav ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}">${_favIconSvg("fav-star-icon")}</button>
      </div>
    </div>`;
  };

  const bellHint = sbUser && mine.length
    ? `<p class="fav-bell-hint">Aktiviere ${_bellSvgFav} für E-Mail-Updates bei neuen Rennen</p>`
    : "";
  listMine.innerHTML = mine.length ? mine.map(v => rowHtml(v, true)).join("") + bellHint : `<p class="fav-empty">Keine Favoriten</p>`;
  listAll.innerHTML  = rest.length  ? rest.map(v => rowHtml(v, false)).join("") : `<p class="fav-empty">Keine Clubs</p>`;
  const mineCount = mine.length ? `${mine.length}` : "";
  const allCount  = rest.length  ? `${rest.length}`  : "";
  countMine.textContent = mineCount;
  countAll.textContent  = allCount;
  document.getElementById("favCountMineDesk").textContent = mineCount;
  document.getElementById("favCountAllDesk").textContent  = allCount;
}

function showMenuPage(page) {
  if (!appMenuContent) return;
  if (page === "admin") { openAdminPage(); return; }
  if (page === "about") { openAboutPage(); return; }
  if (page === "impressum") { openImpressumPage(); return; }
  if (page === "favorites") { closeAppMenu(); openFavoritesPage(); return; }
  const pages = { login: loginPageHtml() };
  appMenuContent.innerHTML = `
    <button type="button" class="app-menu-back"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>Zurück</button>
    <div class="app-menu-page-content">${pages[page] || ""}</div>`;
  appMenuContent.querySelector(".app-menu-back")
    ?.addEventListener("click", showMenuHome);

  if (page === "login") {
    const input = document.getElementById("sbEmailInput");
    const btn = document.getElementById("sbLoginSubmit");
    const hint = document.getElementById("sbLoginHint");
    btn?.addEventListener("click", async () => {
      const email = input?.value?.trim();
      if (!email) return;
      btn.disabled = true;
      btn.textContent = "Wird gesendet…";
      const { error } = await sbSendMagicLink(email);
      if (error) {
        hint.textContent = "Fehler: " + (error.message || JSON.stringify(error));
        console.error("Supabase magic link error:", error);
        btn.disabled = false;
        btn.textContent = "Link senden";
      } else {
        hint.textContent = "✓ Link wurde gesendet. Bitte prüfe deine E-Mails.";
        btn.textContent = "Gesendet";
      }
    });
    input?.addEventListener("keydown", e => { if (e.key === "Enter") btn?.click(); });
  }
}

function impressumHtml() {
  return `
    <h2>Impressum<br>&amp; Datenschutz</h2>
    <section class="app-menu-section">
      <h3>Angaben gemäß § 5 TMG</h3>
      <p>Less Rain GmbH<br>Große Hamburger Straße 17<br>10115 Berlin</p>
      <p>E-Mail: <a href="mailto:info@rcracemap.com">info@rcracemap.com</a></p>
    </section>
    <section class="app-menu-section">
      <h3>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h3>
      <p>Less Rain GmbH<br>Große Hamburger Straße 17<br>10115 Berlin</p>
    </section>
    <section class="app-menu-section">
      <h3>Datenschutz</h3>
      <p>Beim Besuch dieser Website werden durch den Hostinganbieter Hetzner technisch notwendige Server-Logfiles verarbeitet.</p>
      <p>Die Verarbeitung erfolgt ausschließlich zum Zweck des sicheren und störungsfreien Betriebs der Website.</p>
      <p>Zur Darstellung der Karte werden Kartendaten von OpenStreetMap verwendet.</p>
      <p>Diese Website verwendet derzeit keine Benutzerkonten, keine Newsletter, keine Analyse- oder Tracking-Dienste und keine Marketing-Cookies.</p>
    </section>
    <section class="app-menu-section">
      <h3>Hinweis zu den Renninformationen</h3>
      <p>RC Race Map ist ein unabhängiges Informationsangebot für RC-Rennveranstaltungen.</p>
      <p>Die dargestellten Renntermine werden aus öffentlich zugänglichen Quellen (MyRCM, RCK) zusammengetragen. RC Race Map steht in keiner geschäftlichen Verbindung zu diesen Plattformen.</p>
      <p>Trotz sorgfältiger Verarbeitung kann keine Gewähr für die Aktualität, Vollständigkeit oder Richtigkeit übernommen werden.</p>
      <p>Hinweise an <a href="mailto:info@rcracemap.com">info@rcracemap.com</a>.</p>
    </section>
    <div class="sub-page-content-footer">
      <a href="https://lessrain.com" target="_blank" rel="noopener noreferrer">${lessrainSvg}</a>
    </div>`;
}

function aboutHtml() {
  return `
    <h2>Über<br>RC RaceMap</h2>
    <p>RC RaceMap zeigt wo und wann die nächsten Rennen stattfinden — auf einer Karte und als Liste. Beides kann nach Vereinen und Serien gefiltert werden.</p>
    <p>Die Liste enthält den Link zur Nennung und, wenn vorhanden, zu Reglement und Ausschreibung.</p>
    <p>Markiere deine Lieblingsvereine als Favoriten und lass dich über neue Rennen per E-Mail informieren. Melde dich dazu einfach mit deiner E-Mail-Adresse an — eine Registrierung ist nicht erforderlich.</p>
    <p>Die Daten stammen direkt von <a href="https://www.myrcm.ch/" target="_blank" rel="noopener noreferrer">MyRCM</a> und <a href="https://rck-solutions.de/" target="_blank" rel="noopener noreferrer">RCK</a>. Dort findest du wie gewohnt alle Infos und die Anmeldung. RC RaceMap ist ein nicht-kommerzielles Angebot, das diese Daten visuell aufbereitet und als Karte darstellt.</p>
    <p>Keine Haftung für Fehler oder verpasste Podiumsplätze.</p>
    <div class="sub-page-content-footer">
      <a href="https://lessrain.com" target="_blank" rel="noopener noreferrer">${lessrainSvg}</a>
    </div>`;
}

menuButtons.forEach(b => b?.addEventListener("click", () => {
  if (document.body.classList.contains("is-menu-open")) closeAppMenu();
  else openAppMenu();
}));
appMenuOverlay?.addEventListener("click", closeAppMenu);
appMenuClose?.addEventListener("click", closeAppMenu);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeAppMenu(); });

// Handle footer data-menu-open buttons
document.addEventListener("click", e => {
  const btn = e.target.closest("[data-menu-open]");
  if (btn) {
    openAppMenu();
    showMenuPage(btn.dataset.menuOpen);
  }
});

showMenuHome();

// ── Init mobile state ──────────────────────────────────────────
// Hover fix: Chrome's Viz compositor routes ALL pointer events to the WebGL
// canvas (which covers the full viewport), so race-panel elements never receive
// mouseover/mousemove. MapLibre's own mousemove fires for the whole viewport —
// intercept it, use elementFromPoint (main-thread layout, always correct) to
// Forward pointer events from the map container to the canvas so MapLibre still works
// while the canvas has pointer-events:none (needed to fix Chrome compositor hover bug).
{
  const glMap = baseMapLayer?.getMaplibreMap?.();
  if (glMap) {
    const canvas = glMap.getCanvas();
    const container = glMap.getContainer();
    let _fwd = false;
    const MAP_EVENTS = ["mousedown","mouseup","mousemove","mouseover","mouseout",
                        "click","dblclick","contextmenu",
                        "touchstart","touchmove","touchend","touchcancel"];
    MAP_EVENTS.forEach(type => {
      container.addEventListener(type, e => {
        if (_fwd || e.target === canvas) return;
        _fwd = true;
        try { canvas.dispatchEvent(new e.constructor(type, e)); } catch(_) {}
        _fwd = false;
      });
    });
    container.addEventListener("wheel", e => {
      if (_fwd || e.target === canvas) return;
      _fwd = true;
      try { canvas.dispatchEvent(new WheelEvent("wheel", e)); } catch(_) {}
      _fwd = false;
    }, { passive: true });
  }
}

window.addEventListener("load", () => {
  setDrawerState("half");
  // Force Leaflet and MapLibre to re-measure after CSS is fully applied
  requestAnimationFrame(() => {
    map?.invalidateSize?.();
    baseMapLayer?.getMaplibreMap?.()?.resize?.();
    if (lastVisibleCenter && !window.matchMedia("(max-width: 860px)").matches) {
      panToVisible(lastVisibleCenter, map.getZoom());
    }
    positionCountryPillDesktop();
    // Double-RAF: forces compositor hit-test tree rebuild so CSS :hover works on first load
    requestAnimationFrame(() => { void document.body.offsetHeight; });
  });
});

sbInit();
