const config = window.YARDNAV_CONFIG;
const map = L.map("map").setView(config.center, 16);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 20,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const state = {
  start: null,
  goal: null,
  markers: [],
  route: null,
  routeAhead: null,
  routePassed: null,
  routeDirectionMarkers: [],
  recoveryRoute: null,
  recoveryRequest: null,
  recoveryTarget: null,
  recoveryRequestedAt: 0,
  offRouteActive: false,
  activeProfile: "mtb",
  routeLatLngs: [],
  routeDistances: [],
  maneuvers: [],
  watchId: null,
  locationMarker: null,
  accuracyCircle: null,
  currentLocation: null,
  filteredLocation: null,
  locationAccuracy: null,
  locationTimestamp: null,
  heading: 0,
  compassHeading: null,
  compassTimestamp: null,
  compassActive: false,
  routeAlong: null,
  followLocation: false,
  customPoints: [],
  customMarkers: [],
  wakeLock: null,
  keepScreenOn: false
};
const status = document.querySelector("#status");
const summary = document.querySelector("#summary");
const locationSummary = document.querySelector("#location-summary");
const locationState = document.querySelector("#location-state");
const routeProgress = document.querySelector("#route-progress");
const trackButton = document.querySelector("#track");
const panel = document.querySelector("#panel");
const panelToggle = document.querySelector("#panel-toggle");
const panelToggleLabel = document.querySelector("#panel-toggle-label");
const locateButton = document.querySelector("#locate");
const quickLocateButton = document.querySelector("#quick-locate");
const profileSelect = document.querySelector("#profile");
const customControls = document.querySelector("#custom-controls");
const customCount = document.querySelector("#custom-count");
const undoPointButton = document.querySelector("#undo-point");
const buildCustomButton = document.querySelector("#build-custom");
const wakeLockButton = document.querySelector("#wake-lock");
const navigationBanner = document.querySelector("#navigation-banner");
const maneuverIcon = document.querySelector("#maneuver-icon");
const maneuverDistance = document.querySelector("#maneuver-distance");
const maneuverInstruction = document.querySelector("#maneuver-instruction");
const followingManeuver = document.querySelector("#following-maneuver");

function isMobile() {
  return window.matchMedia("(max-width: 720px)").matches;
}

function setPanelCollapsed(collapsed) {
  panel.classList.toggle("collapsed", collapsed);
  panelToggle.setAttribute("aria-expanded", String(!collapsed));
  panelToggleLabel.textContent = collapsed ? "Развернуть" : "Свернуть";
  quickLocateButton.classList.toggle("panel-open", !collapsed);
  window.setTimeout(() => map.invalidateSize(), 230);
}

function updateWakeLockButton(message = null) {
  wakeLockButton.classList.toggle("active", state.wakeLock !== null);
  wakeLockButton.textContent = message || (
    state.wakeLock
      ? "Экран остаётся включённым"
      : "Не выключать экран"
  );
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) {
    state.keepScreenOn = false;
    wakeLockButton.classList.add("unsupported");
    updateWakeLockButton("Не поддерживается браузером");
    return false;
  }
  if (!window.isSecureContext) {
    state.keepScreenOn = false;
    wakeLockButton.classList.add("unsupported");
    updateWakeLockButton("Для экрана нужен HTTPS");
    return false;
  }
  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.keepScreenOn = true;
    wakeLockButton.classList.remove("unsupported");
    wakeLockButton.classList.add("supported");
    updateWakeLockButton();
    state.wakeLock.addEventListener("release", () => {
      state.wakeLock = null;
      wakeLockButton.classList.remove("supported");
      updateWakeLockButton(
        state.keepScreenOn ? "Восстанавливаю подсветку..." : null
      );
    });
    return true;
  } catch (error) {
    state.wakeLock = null;
    wakeLockButton.classList.add("unsupported");
    updateWakeLockButton("Не удалось удержать экран");
    return false;
  }
}

async function disableWakeLock() {
  state.keepScreenOn = false;
  if (state.wakeLock) {
    await state.wakeLock.release();
    state.wakeLock = null;
  }
  wakeLockButton.classList.remove("active", "supported");
  updateWakeLockButton();
}

function formatDistance(meters) {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} км`
    : `${Math.round(meters)} м`;
}

function project(latlng) {
  return L.CRS.EPSG3857.project(latlng);
}

function normalizeAngle(angle) {
  return ((angle + 540) % 360) - 180;
}

function bearing(start, end) {
  const startLat = start.lat * Math.PI / 180;
  const endLat = end.lat * Math.PI / 180;
  const deltaLon = (end.lng - start.lng) * Math.PI / 180;
  const y = Math.sin(deltaLon) * Math.cos(endLat);
  const x = Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function setLocationHeading(heading) {
  if (!Number.isFinite(heading)) return;
  state.heading = (heading + 360) % 360;
  const arrow = state.locationMarker?.getElement()
    ?.querySelector(".location-arrow");
  if (arrow) {
    arrow.style.transform = `rotate(${state.heading}deg)`;
  }
}

function deviceHeading(event) {
  if (Number.isFinite(event.webkitCompassHeading)) {
    return event.webkitCompassHeading;
  }
  if (event.absolute && Number.isFinite(event.alpha)) {
    const screenAngle = screen.orientation?.angle || window.orientation || 0;
    return 360 - event.alpha + screenAngle;
  }
  return null;
}

function handleDeviceOrientation(event) {
  const heading = deviceHeading(event);
  if (!Number.isFinite(heading)) return;
  state.compassHeading = heading;
  state.compassTimestamp = Date.now();
  setLocationHeading(heading);
}

async function enableCompass() {
  if (state.compassActive || typeof DeviceOrientationEvent === "undefined") {
    return;
  }
  try {
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") return;
    }
    window.addEventListener("deviceorientation", handleDeviceOrientation, true);
    window.addEventListener(
      "deviceorientationabsolute",
      handleDeviceOrientation,
      true
    );
    state.compassActive = true;
  } catch (error) {
    state.compassActive = false;
  }
}

function headingForPosition(position, previousLocation, fix, routeMatch) {
  if (
    Number.isFinite(state.compassHeading)
    && Date.now() - state.compassTimestamp < 5000
  ) {
    return state.compassHeading;
  }
  if (Number.isFinite(position.coords.heading)) {
    return position.coords.heading;
  }
  if (
    previousLocation
    && map.distance(previousLocation, fix.latlng) >= 4
  ) {
    return bearing(previousLocation, fix.latlng);
  }
  if (routeMatch && state.routeLatLngs[routeMatch.segmentIndex + 1]) {
    return bearing(
      routeMatch.latlng,
      state.routeLatLngs[routeMatch.segmentIndex + 1]
    );
  }
  return state.heading;
}

function routePointAt(distance) {
  if (!state.routeLatLngs.length) return null;
  if (state.routeLatLngs.length === 1) return state.routeLatLngs[0];
  const total = state.routeDistances[state.routeDistances.length - 1] || 0;
  const target = Math.max(0, Math.min(total, distance));
  let low = 1;
  let high = state.routeDistances.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (state.routeDistances[middle] < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const index = low;
  if (index >= state.routeLatLngs.length) {
    return state.routeLatLngs[state.routeLatLngs.length - 1];
  }
  const startDistance = state.routeDistances[index - 1];
  const segmentDistance = state.routeDistances[index] - startDistance;
  const ratio = segmentDistance
    ? (target - startDistance) / segmentDistance
    : 0;
  const start = state.routeLatLngs[index - 1];
  const end = state.routeLatLngs[index];
  return L.latLng(
    start.lat + (end.lat - start.lat) * ratio,
    start.lng + (end.lng - start.lng) * ratio
  );
}

function routePointsBetween(startDistance, endDistance) {
  if (state.routeLatLngs.length < 2) return [];
  const start = Math.max(0, startDistance);
  const end = Math.max(start, endDistance);
  const points = [routePointAt(start)];
  for (let index = 1; index < state.routeLatLngs.length - 1; index += 1) {
    if (
      state.routeDistances[index] > start
      && state.routeDistances[index] < end
    ) {
      points.push(state.routeLatLngs[index]);
    }
  }
  points.push(routePointAt(end));
  return points.filter(Boolean);
}

function maneuverForAngle(angle) {
  const magnitude = Math.abs(angle);
  const right = angle > 0;
  if (magnitude >= 150) {
    return { icon: "↩", instruction: "Развернитесь" };
  }
  if (magnitude >= 105) {
    return {
      icon: right ? "↱" : "↰",
      instruction: right ? "Резко поверните направо" : "Резко поверните налево"
    };
  }
  if (magnitude >= 45) {
    return {
      icon: right ? "→" : "←",
      instruction: right ? "Поверните направо" : "Поверните налево"
    };
  }
  return {
    icon: right ? "↗" : "↖",
    instruction: right ? "Держитесь правее" : "Держитесь левее"
  };
}

function buildManeuvers() {
  const total = state.routeDistances[state.routeDistances.length - 1] || 0;
  const maneuvers = [];
  const sampleDistance = 22;

  for (let index = 1; index < state.routeLatLngs.length - 1; index += 1) {
    const along = state.routeDistances[index];
    if (along < sampleDistance || total - along < sampleDistance) continue;
    const before = routePointAt(along - sampleDistance);
    const current = state.routeLatLngs[index];
    const after = routePointAt(along + sampleDistance);
    const angle = normalizeAngle(
      bearing(current, after) - bearing(before, current)
    );
    if (Math.abs(angle) < 28) continue;

    const maneuver = { ...maneuverForAngle(angle), along, angle };
    const previous = maneuvers[maneuvers.length - 1];
    if (previous && along - previous.along < 38) {
      if (Math.abs(angle) > Math.abs(previous.angle)) {
        maneuvers[maneuvers.length - 1] = maneuver;
      }
    } else {
      maneuvers.push(maneuver);
    }
  }

  maneuvers.push({
    along: total,
    angle: 0,
    icon: "●",
    instruction: "Вы прибыли"
  });
  state.maneuvers = maneuvers;
}

function updateNavigation(along = 0) {
  if (!state.maneuvers.length) {
    navigationBanner.hidden = true;
    return;
  }
  const upcomingIndex = state.maneuvers.findIndex(
    maneuver => maneuver.along >= along - 8
  );
  const index = upcomingIndex === -1
    ? state.maneuvers.length - 1
    : upcomingIndex;
  const current = state.maneuvers[index];
  const next = state.maneuvers[index + 1];
  const distance = Math.max(0, current.along - along);

  navigationBanner.hidden = false;
  maneuverIcon.textContent = current.icon;
  maneuverDistance.textContent = current.instruction === "Вы прибыли"
    ? "Финиш"
    : `Через ${formatDistance(distance)}`;
  maneuverInstruction.textContent = current.instruction;
  followingManeuver.textContent = next
    ? `Затем через ${formatDistance(next.along - current.along)}: ${next.instruction.toLowerCase()}`
    : "Конец маршрута";
}

function hideNavigation() {
  state.maneuvers = [];
  state.routeAlong = null;
  navigationBanner.hidden = true;
  navigationBanner.classList.remove("off-route");
}

function clearRecoveryRoute() {
  if (state.recoveryRequest) state.recoveryRequest.abort();
  if (state.recoveryRoute) state.recoveryRoute.remove();
  state.recoveryRoute = null;
  state.recoveryRequest = null;
  state.recoveryTarget = null;
  state.offRouteActive = false;
}

function clearDirectionMarkers() {
  state.routeDirectionMarkers.forEach(marker => marker.remove());
  state.routeDirectionMarkers = [];
}

function clearRouteGuidance() {
  if (state.routeAhead) state.routeAhead.remove();
  if (state.routePassed) state.routePassed.remove();
  clearDirectionMarkers();
  state.routeAhead = null;
  state.routePassed = null;
}

function recoveryProfile() {
  return ["custom_experimental", "experimental"].includes(state.activeProfile)
    ? "experimental"
    : state.activeProfile;
}

async function updateRecoveryRoute(current, position) {
  const now = Date.now();
  const targetAlong = Math.min(
    state.routeDistances[state.routeDistances.length - 1],
    position.along + Math.max(180, position.offRoute * 1.5)
  );
  const target = routePointAt(targetAlong);
  if (!target) return;

  const targetChanged = !state.recoveryTarget
    || map.distance(state.recoveryTarget, target) > 90;
  if (
    state.recoveryRequest
    || (!targetChanged && now - state.recoveryRequestedAt < 15000)
  ) {
    return;
  }

  state.recoveryRequestedAt = now;
  state.recoveryTarget = target;
  const requestController = new AbortController();
  state.recoveryRequest = requestController;

  try {
    const response = await fetch("/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: requestController.signal,
      body: JSON.stringify({
        start_lat: current.lat,
        start_lon: current.lng,
        goal_lat: target.lat,
        goal_lon: target.lng,
        profile: recoveryProfile()
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Recovery route failed");

    if (state.recoveryRoute) state.recoveryRoute.remove();
    state.recoveryRoute = L.geoJSON(data, {
      interactive: false,
      style: {
        color: "#168aad",
        weight: 8,
        opacity: .95,
        dashArray: "12 9"
      }
    }).addTo(map);
    state.recoveryRoute.bringToFront();
    if (state.locationMarker) state.locationMarker.bringToFront();
    followingManeuver.textContent =
      `Пунктир ведёт обратно · ${formatDistance(data.properties.distance_m)}`;
  } catch (error) {
    if (error.name === "AbortError") return;
    if (state.recoveryRoute) state.recoveryRoute.remove();
    state.recoveryRoute = L.polyline([current, target], {
      interactive: false,
      color: "#168aad",
      weight: 7,
      opacity: .85,
      dashArray: "8 10"
    }).addTo(map);
    followingManeuver.textContent =
      "Показано прямое направление к маршруту";
  } finally {
    if (state.recoveryRequest === requestController) {
      state.recoveryRequest = null;
    }
  }
}

function followRouteAhead(displayLatLng) {
  if (!state.followLocation) return;
  if (state.offRouteActive) {
    const target = state.recoveryTarget;
    const center = target
      ? L.latLng(
          displayLatLng.lat + (target.lat - displayLatLng.lat) * .35,
          displayLatLng.lng + (target.lng - displayLatLng.lng) * .35
        )
      : displayLatLng;
    if (map.getZoom() < 17) {
      map.setView(center, 17, { animate: true });
    } else {
      map.panTo(center);
    }
    return;
  }
  const along = state.routeAlong || 0;
  const lookAhead = routePointAt(along + 90);
  if (!lookAhead) {
    map.panTo(displayLatLng);
    return;
  }
  const center = L.latLng(
    displayLatLng.lat + (lookAhead.lat - displayLatLng.lat) * .55,
    displayLatLng.lng + (lookAhead.lng - displayLatLng.lng) * .55
  );
  if (map.getZoom() < 17) {
    map.setView(center, 17, { animate: true });
  } else {
    map.panTo(center);
  }
}

function updateRouteAhead(position) {
  if (!position || state.routeLatLngs.length < 2) return;
  const total = state.routeDistances[state.routeDistances.length - 1];
  const endDistance = Math.min(
    total,
    position.along + 350
  );
  const points = routePointsBetween(position.along, endDistance);

  if (!state.routeAhead) {
    state.routeAhead = L.polyline(points, {
      color: "#f4c95d",
      weight: 10,
      opacity: .92,
      interactive: false
    }).addTo(map);
  } else {
    state.routeAhead.setLatLngs(points);
  }

  const passedPoints = routePointsBetween(0, position.along);
  if (position.along >= 10 && passedPoints.length >= 2) {
    if (!state.routePassed) {
      state.routePassed = L.polyline(passedPoints, {
        color: "#737d77",
        weight: 7,
        opacity: .55,
        interactive: false
      }).addTo(map);
    } else {
      state.routePassed.setLatLngs(passedPoints);
    }
  }

  clearDirectionMarkers();
  for (
    let distance = position.along + 45;
    distance < endDistance;
    distance += 75
  ) {
    const arrowPosition = routePointAt(distance);
    const arrowTarget = routePointAt(Math.min(distance + 18, total));
    if (!arrowPosition || !arrowTarget) continue;
    const direction = bearing(arrowPosition, arrowTarget);
    const marker = L.marker(arrowPosition, {
      interactive: false,
      zIndexOffset: 700,
      icon: L.divIcon({
        className: "route-direction-marker",
        html: `<span style="transform: rotate(${direction}deg)"></span>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      })
    }).addTo(map);
    state.routeDirectionMarkers.push(marker);
  }

  if (state.routePassed) state.routePassed.bringToFront();
  state.routeAhead.bringToFront();
  state.routeDirectionMarkers.forEach(marker => marker.setZIndexOffset(800));
  if (state.locationMarker) state.locationMarker.bringToFront();
}

function routePosition(latlng) {
  if (state.routeLatLngs.length < 2) return null;
  const point = project(latlng);
  let best = null;

  for (let index = 0; index < state.routeLatLngs.length - 1; index += 1) {
    const start = project(state.routeLatLngs[index]);
    const end = project(state.routeLatLngs[index + 1]);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1,
        ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    const nearest = L.point(start.x + ratio * dx, start.y + ratio * dy);
    const nearestLatLng = L.CRS.EPSG3857.unproject(nearest);
    const offRoute = map.distance(latlng, nearestLatLng);
    if (!best || offRoute < best.offRoute) {
      const segmentLength = map.distance(
        state.routeLatLngs[index],
        state.routeLatLngs[index + 1]
      );
      best = {
        offRoute,
        along: state.routeDistances[index] + segmentLength * ratio,
        latlng: nearestLatLng,
        segmentIndex: index
      };
    }
  }
  return best;
}

function filteredPosition(position) {
  const raw = L.latLng(position.coords.latitude, position.coords.longitude);
  const accuracy = Math.max(1, Number(position.coords.accuracy) || 100);
  const timestamp = position.timestamp || Date.now();

  if (!state.filteredLocation) {
    return { latlng: raw, accuracy, timestamp, ignored: false };
  }

  const elapsedSeconds = Math.max(
    .2,
    (timestamp - state.locationTimestamp) / 1000
  );
  const distance = map.distance(state.filteredLocation, raw);
  const uncertainty = Math.max(
    6,
    Math.min(accuracy, state.locationAccuracy || accuracy) * 1.5
  );

  // Movement inside both GPS accuracy radii is indistinguishable from noise.
  if (distance <= uncertainty) {
    return {
      latlng: state.filteredLocation,
      accuracy,
      timestamp,
      ignored: true
    };
  }

  // Reject stale fixes, very inaccurate fixes and impossible bicycle jumps.
  const plausibleDistance = 12 + elapsedSeconds * 18 + uncertainty;
  if (
    timestamp < Date.now() - 20000
    || accuracy > 80
    || distance > plausibleDistance
  ) {
    return {
      latlng: state.filteredLocation,
      accuracy: state.locationAccuracy,
      timestamp: state.locationTimestamp,
      ignored: true
    };
  }

  const alpha = Math.max(
    .2,
    Math.min(.7, (distance - uncertainty) / Math.max(distance, 1))
  );
  return {
    latlng: L.latLng(
      state.filteredLocation.lat +
        (raw.lat - state.filteredLocation.lat) * alpha,
      state.filteredLocation.lng +
        (raw.lng - state.filteredLocation.lng) * alpha
    ),
    accuracy,
    timestamp,
    ignored: false
  };
}

function updateProgress(latlng) {
  const position = routePosition(latlng);
  if (!position) {
    routeProgress.textContent = "Постройте маршрут для отображения прогресса.";
    return;
  }
  const total = state.routeDistances[state.routeDistances.length - 1];
  state.routeAlong = position.along;
  updateNavigation(position.along);
  updateRouteAhead(position);
  const remaining = Math.max(0, total - position.along);
  const percent = total ? Math.min(100, position.along / total * 100) : 100;
  routeProgress.textContent =
    `Маршрут: ${percent.toFixed(0)}% · осталось ${formatDistance(remaining)}` +
    ` · отклонение ${formatDistance(position.offRoute)}`;
  const offRouteThreshold = Math.max(
    30,
    (state.locationAccuracy || 0) * 2.5
  );
  if (position.offRoute > offRouteThreshold) {
    if (!state.offRouteActive) {
      state.offRouteActive = true;
      if ("vibrate" in navigator) navigator.vibrate([180, 100, 180]);
    }
    status.textContent =
      `Вы съехали с маршрута на ${formatDistance(position.offRoute)}. Строю возврат.`;
    navigationBanner.classList.add("off-route");
    maneuverDistance.textContent = "Вы съехали с маршрута";
    maneuverInstruction.textContent = "Следуйте по синему пунктиру";
    followingManeuver.textContent =
      `Отклонение ${formatDistance(position.offRoute)} · строю возврат`;
    void updateRecoveryRoute(latlng, position);
  } else if (state.offRouteActive) {
    if (position.offRoute <= offRouteThreshold * .6) {
      clearRecoveryRoute();
      status.textContent = "Вы вернулись на основной маршрут.";
      updateNavigation(position.along);
      navigationBanner.classList.remove("off-route");
    } else {
      navigationBanner.classList.add("off-route");
      maneuverDistance.textContent = "Возвращение на маршрут";
      maneuverInstruction.textContent = "Продолжайте по синему пунктиру";
      followingManeuver.textContent =
        `До линии маршрута около ${formatDistance(position.offRoute)}`;
      if (state.recoveryRoute) state.recoveryRoute.bringToFront();
      if (state.locationMarker) state.locationMarker.bringToFront();
    }
  } else {
    navigationBanner.classList.remove("off-route");
  }
}

function updateLocation(position, centerMap = false) {
  const previousLocation = state.filteredLocation;
  const fix = filteredPosition(position);
  state.filteredLocation = fix.latlng;
  state.locationAccuracy = fix.accuracy;
  state.locationTimestamp = fix.timestamp;

  const routeMatch = routePosition(fix.latlng);
  const snapDistance = Math.max(10, fix.accuracy * 1.2);
  const displayLatLng = (
    routeMatch
    && routeMatch.offRoute <= snapDistance
  )
    ? routeMatch.latlng
    : fix.latlng;
  state.currentLocation = fix.latlng;
  const accuracy = Math.round(fix.accuracy);
  const heading = headingForPosition(
    position,
    previousLocation,
    fix,
    routeMatch
  );

  if (!state.locationMarker) {
    state.locationMarker = L.marker(displayLatLng, {
      zIndexOffset: 1000,
      icon: L.divIcon({
        className: "location-heading-marker",
        html: '<span class="location-arrow" aria-hidden="true"></span>',
        iconSize: [42, 42],
        iconAnchor: [21, 21]
      })
    }).addTo(map).bindTooltip("Вы здесь");
    state.accuracyCircle = L.circle(fix.latlng, {
      radius: fix.accuracy,
      color: "#1769aa",
      weight: 1,
      fillColor: "#4d9bd5",
      fillOpacity: .12
    }).addTo(map);
  } else {
    state.locationMarker.setLatLng(displayLatLng);
    state.accuracyCircle.setLatLng(fix.latlng).setRadius(fix.accuracy);
  }
  setLocationHeading(heading);

  locationSummary.hidden = false;
  const snapLabel = routeMatch && routeMatch.offRoute <= snapDistance
    ? " · привязано к маршруту"
    : "";
  const filterLabel = fix.ignored ? " · GPS без подтверждённого движения" : "";
  locationState.textContent =
    `Точность геолокации: ±${accuracy} м${snapLabel}${filterLabel}`;
  updateProgress(fix.latlng);
  if (centerMap) {
    map.panTo(displayLatLng);
  } else {
    followRouteAhead(displayLatLng);
  }
}

function locationError(error) {
  const messages = {
    1: "Доступ к геолокации запрещён.",
    2: "Устройство не смогло определить позицию.",
    3: "Истекло время ожидания геолокации."
  };
  status.textContent = messages[error.code] || "Ошибка геолокации.";
}

function requireGeolocation() {
  if (!navigator.geolocation) {
    status.textContent = "Этот браузер не поддерживает геолокацию.";
    return false;
  }
  if (!window.isSecureContext) {
    status.textContent =
      "Геолокация требует HTTPS. На этом Mac используйте localhost; для iPhone нужен HTTPS.";
    return false;
  }
  return true;
}

function setPoint(kind, latlng) {
  state[kind] = latlng;
  const color = kind === "start" ? "#39734f" : "#b4442f";
  const marker = L.circleMarker(latlng, {
    radius: 8,
    color: "#fff",
    weight: 3,
    fillColor: color,
    fillOpacity: 1
  }).addTo(map);
  state.markers.push(marker);
  document.querySelector(`#${kind}-label`).textContent =
    `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
}

function isCustomMode() {
  return profileSelect.value === "custom_experimental";
}

function updateCustomLabels() {
  const count = state.customPoints.length;
  customCount.textContent = `${count} ${count === 1 ? "точка" : "точек"}`;
  document.querySelector("#start-label").textContent = count
    ? `${state.customPoints[0].lat.toFixed(5)}, ${state.customPoints[0].lng.toFixed(5)}`
    : "Укажите начало";
  document.querySelector("#goal-label").textContent = count > 1
    ? `${state.customPoints[count - 1].lat.toFixed(5)}, ${state.customPoints[count - 1].lng.toFixed(5)}`
    : "Добавьте важные точки и финиш";
  buildCustomButton.disabled = count < 2;
  undoPointButton.disabled = count === 0;
}

function addCustomPoint(latlng) {
  if (state.customPoints.length >= 20) {
    status.textContent = "Можно добавить не более 20 точек.";
    return;
  }
  state.customPoints.push(latlng);
  const number = state.customPoints.length;
  const marker = L.marker(latlng, {
    icon: L.divIcon({
      className: "",
      html: `<span class="custom-waypoint-label">${number}</span>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    })
  }).addTo(map);
  state.customMarkers.push(marker);
  if (state.route) {
    state.route.remove();
    clearRouteGuidance();
    clearRecoveryRoute();
    state.route = null;
    state.routeLatLngs = [];
    state.routeDistances = [];
    hideNavigation();
    summary.hidden = true;
  }
  updateCustomLabels();
  status.textContent = number === 1
    ? "Старт добавлен. Добавьте важные точки и последним кликом финиш."
    : `Точка ${number} добавлена. Нажмите «Построить», когда последняя точка будет финишем.`;
}

async function requestRoute() {
  if (isCustomMode() && state.customPoints.length < 2) {
    status.textContent = "Добавьте минимум старт и финиш.";
    return;
  }
  status.textContent = "Строю маршрут...";
  try {
    const endpoint = isCustomMode() ? "/api/custom-route" : "/api/route";
    const payload = isCustomMode()
      ? {
          points: state.customPoints.map(point => ({
            lat: point.lat,
            lon: point.lng
          }))
        }
      : {
          start_lat: state.start.lat,
          start_lon: state.start.lng,
          goal_lat: state.goal.lat,
          goal_lon: state.goal.lng,
          profile: profileSelect.value
        };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось построить маршрут");

    if (state.route) state.route.remove();
    clearRouteGuidance();
    clearRecoveryRoute();
    state.route = null;
    state.routeAlong = 0;

    const routeColor = ["experimental", "custom_experimental"].includes(
      data.properties.profile
    )
      ? "#8b4db8"
      : "#d65b35";
    state.route = L.geoJSON(data, {
      style: { color: routeColor, weight: 7, opacity: .9 }
    }).addTo(map);
    state.activeProfile = data.properties.profile;
    state.routeLatLngs = data.geometry.coordinates.map(
      coordinate => L.latLng(coordinate[1], coordinate[0])
    );
    state.routeDistances = [0];
    for (let index = 1; index < state.routeLatLngs.length; index += 1) {
      state.routeDistances.push(
        state.routeDistances[index - 1] +
        map.distance(state.routeLatLngs[index - 1], state.routeLatLngs[index])
      );
    }
    buildManeuvers();
    updateNavigation(state.currentLocation ? state.routeAlong || 0 : 0);
    if (state.currentLocation) {
      updateProgress(state.currentLocation);
    } else {
      updateRouteAhead({
        along: 0,
        latlng: state.routeLatLngs[0],
        segmentIndex: 0
      });
    }
    map.fitBounds(state.route.getBounds(), { padding: [45, 45] });
    if (isMobile()) setPanelCollapsed(true);
    summary.hidden = false;
    summary.innerHTML =
      `${data.properties.distance_m} м · ${data.properties.duration_min} мин` +
      ` · ${data.properties.average_speed_kmh} км/ч` +
      `<small>Дворовые сегменты: ${data.properties.interior_distance_m} м` +
      ` · Вдоль улиц: ${data.properties.roadside_distance_m} м` +
      ` · По улицам: ${data.properties.public_road_distance_m} м` +
      ` · Неразмеченные переходы: ${data.properties.informal_crossing_edges}` +
      ` · Светофорные: ${data.properties.signal_crossing_edges}` +
      ` · Бордюры: ${data.properties.kerb_edges}` +
      ` · Барьеры: ${data.properties.barrier_edges}</small>`;
    if (data.properties.profile === "custom_experimental") {
      status.textContent =
        `Кастомный маршрут построен через ${data.properties.via_count} обязательных точек.`;
    } else if (data.properties.profile === "experimental") {
      status.textContent =
        "Экспериментальный маршрут построен по тропам и дворовым проходам; скорость не оптимизируется.";
    } else if (data.properties.profile === "mtb") {
      status.textContent = data.properties.meets_speed_target
        ? "MTB-маршрут без непроезжаемых лестниц; цель 10 км/ч достигнута."
        : "Лестниц нет, но по данным OSM цель 10 км/ч здесь не достигается.";
    } else {
      status.textContent = "Пеший маршрут построен с учетом дворового профиля.";
    }
  } catch (error) {
    status.textContent = error.message;
  }
}

function reset() {
  state.markers.forEach(marker => marker.remove());
  if (state.route) state.route.remove();
  clearRouteGuidance();
  clearRecoveryRoute();
  state.start = null;
  state.goal = null;
  state.markers = [];
  state.route = null;
  state.routeLatLngs = [];
  state.routeDistances = [];
  hideNavigation();
  state.customMarkers.forEach(marker => marker.remove());
  state.customPoints = [];
  state.customMarkers = [];
  summary.hidden = true;
  document.querySelector("#start-label").textContent = "Укажите начало";
  document.querySelector("#goal-label").textContent = "Укажите конец";
  updateCustomLabels();
  status.textContent = "Первый клик задает начало.";
}

map.on("click", event => {
  if (isCustomMode()) {
    addCustomPoint(event.latlng);
    return;
  }
  if (state.goal) reset();
  if (!state.start) {
    setPoint("start", event.latlng);
    status.textContent = "Теперь укажите конец.";
    return;
  }
  setPoint("goal", event.latlng);
  requestRoute();
});

document.querySelector("#reset").addEventListener("click", reset);
locateButton.addEventListener("click", async () => {
  if (!requireGeolocation()) return;
  await enableCompass();
  status.textContent = "Определяю местоположение...";
  navigator.geolocation.getCurrentPosition(
    position => {
      updateLocation(position, true);
      if (isCustomMode() && state.customPoints.length === 0) {
        addCustomPoint(state.currentLocation);
        status.textContent = "Текущее местоположение выбрано как старт.";
      } else if (!state.start) {
        setPoint("start", state.currentLocation);
        status.textContent = "Текущее местоположение выбрано как начало.";
      }
    },
    locationError,
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
  );
});
quickLocateButton.addEventListener("click", () => locateButton.click());
panelToggle.addEventListener("click", () => {
  setPanelCollapsed(!panel.classList.contains("collapsed"));
});
trackButton.addEventListener("click", async () => {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
    state.followLocation = false;
    trackButton.classList.remove("active");
    trackButton.textContent = "Отслеживать";
    status.textContent = "Отслеживание остановлено.";
    disableWakeLock();
    return;
  }
  if (!requireGeolocation()) return;
  await enableCompass();
  state.followLocation = true;
  trackButton.classList.add("active");
  trackButton.textContent = "Остановить отслеживание";
  status.textContent = "Отслеживание местоположения включено.";
  requestWakeLock();
  state.watchId = navigator.geolocation.watchPosition(
    position => updateLocation(position),
    locationError,
    {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 2000
    }
  );
});
wakeLockButton.addEventListener("click", async () => {
  if (state.keepScreenOn) {
    await disableWakeLock();
    status.textContent = "Автоблокировка экрана снова разрешена.";
  } else {
    const enabled = await requestWakeLock();
    status.textContent = enabled
      ? "Экран будет оставаться включённым, пока открыта карта."
      : "Браузер не разрешил постоянную подсветку экрана.";
  }
});
undoPointButton.addEventListener("click", () => {
  const marker = state.customMarkers.pop();
  if (marker) marker.remove();
  state.customPoints.pop();
  if (state.route) {
    state.route.remove();
    clearRouteGuidance();
    clearRecoveryRoute();
    state.route = null;
    state.routeLatLngs = [];
    state.routeDistances = [];
    hideNavigation();
    summary.hidden = true;
  }
  updateCustomLabels();
  status.textContent = "Последняя точка удалена.";
});
buildCustomButton.addEventListener("click", requestRoute);
profileSelect.addEventListener("change", () => {
  reset();
  customControls.hidden = !isCustomMode();
  status.textContent = isCustomMode()
    ? "Поставьте старт, важные точки и финиш по порядку."
    : "Первый клик задает начало.";
});
window.addEventListener("resize", () => {
  if (!isMobile()) setPanelCollapsed(false);
  map.invalidateSize();
});
document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible"
    && state.keepScreenOn
    && state.wakeLock === null
  ) {
    requestWakeLock();
  }
});
map.fitBounds(config.bounds, { padding: [30, 30] });
customControls.hidden = !isCustomMode();
updateCustomLabels();
if (isMobile()) setPanelCollapsed(false);
if (!("wakeLock" in navigator)) {
  wakeLockButton.classList.add("unsupported");
  updateWakeLockButton("Подсветка не поддерживается");
}
