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
  locationHeading: null,
  cameraTarget: null,
  lastCameraMove: 0,
  routeAlong: null,
  followLocation: false,
  customPoints: [],
  customMarkers: [],
  wakeLock: null,
  keepScreenOn: false,
  voiceEnabled: false,
  voiceSupported: (
    "speechSynthesis" in window
    && typeof SpeechSynthesisUtterance !== "undefined"
  ),
  voiceRouteId: 0,
  spokenApproach: null,
  spokenNow: null,
  spokenArrival: false,
  spokenOffRoute: false
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
const voiceGuidanceButton = document.querySelector("#voice-guidance");
const navigationBanner = document.querySelector("#navigation-banner");
const maneuverIcon = document.querySelector("#maneuver-icon");
const maneuverDistance = document.querySelector("#maneuver-distance");
const maneuverInstruction = document.querySelector("#maneuver-instruction");
const followingManeuver = document.querySelector("#following-maneuver");
const mapElement = document.querySelector("#map");

function isMobile() {
  return window.matchMedia("(max-width: 720px)").matches;
}

function initializeTelegramWebApp() {
  const telegram = window.Telegram?.WebApp;
  if (!telegram) return;
  document.documentElement.classList.add("telegram-web-app");
  telegram.ready();
  telegram.expand();
  telegram.enableClosingConfirmation?.();
  telegram.disableVerticalSwipes?.();
}

function protectMapGestures() {
  let touchStart = null;

  mapElement.addEventListener("touchstart", event => {
    if (event.touches.length !== 1) {
      touchStart = null;
      return;
    }
    const touch = event.touches[0];
    touchStart = { x: touch.clientX, y: touch.clientY };
  }, { capture: true, passive: true });

  mapElement.addEventListener("touchmove", event => {
    if (!touchStart || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const horizontal = Math.abs(touch.clientX - touchStart.x);
    const vertical = Math.abs(touch.clientY - touchStart.y);
    if (horizontal > vertical && horizontal > 4 && event.cancelable) {
      event.preventDefault();
    }
  }, { capture: true, passive: false });

  const clearTouch = () => {
    touchStart = null;
  };
  mapElement.addEventListener("touchend", clearTouch, { passive: true });
  mapElement.addEventListener("touchcancel", clearTouch, { passive: true });
}

function setPanelCollapsed(collapsed) {
  panel.classList.toggle("collapsed", collapsed);
  panelToggle.setAttribute("aria-expanded", String(!collapsed));
  panelToggleLabel.textContent = collapsed ? "Открыть панель" : "Скрыть панель";
  for (const child of panel.children) {
    if (child === panelToggle) continue;
    child.inert = collapsed;
    child.setAttribute("aria-hidden", String(collapsed));
  }
  quickLocateButton.classList.toggle("panel-open", !collapsed);
  window.setTimeout(() => map.invalidateSize(), 230);
}

function updateVoiceButton(message = null) {
  voiceGuidanceButton.classList.toggle("active", state.voiceEnabled);
  voiceGuidanceButton.classList.toggle("unsupported", !state.voiceSupported);
  voiceGuidanceButton.setAttribute("aria-pressed", String(state.voiceEnabled));
  voiceGuidanceButton.textContent = message || (
    state.voiceEnabled
      ? "Голосовые подсказки: вкл."
      : "Голосовые подсказки: выкл."
  );
}

function preferredVoice() {
  const voices = window.speechSynthesis?.getVoices() || [];
  return voices.find(voice => /^ru([-_]|$)/i.test(voice.lang))
    || voices.find(voice => /^uk([-_]|$)/i.test(voice.lang))
    || voices[0]
    || null;
}

function speak(text, interrupt = false) {
  if (!state.voiceEnabled || !state.voiceSupported || !text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = preferredVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = "ru-RU";
  }
  utterance.rate = .96;
  if (interrupt) window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function resetVoiceProgress() {
  state.voiceRouteId += 1;
  state.spokenApproach = null;
  state.spokenNow = null;
  state.spokenArrival = false;
  state.spokenOffRoute = false;
}

function updateVoiceGuidance(current, next, distance) {
  if (!state.voiceEnabled || !current) return;
  const key =
    `${state.voiceRouteId}:${Math.round(current.along)}:${current.instruction}`;

  if (current.instruction === "Вы прибыли") {
    if (!state.spokenArrival && distance <= 20) {
      state.spokenArrival = true;
      speak("Вы прибыли в пункт назначения.", true);
    }
    return;
  }
  if (distance <= 30 && state.spokenNow !== key) {
    state.spokenNow = key;
    speak(current.instruction, true);
    return;
  }
  if (distance <= 120 && state.spokenApproach !== key) {
    state.spokenApproach = key;
    const meters = Math.max(20, Math.round(distance / 10) * 10);
    const following = next
      ? ` Затем ${next.instruction.toLowerCase()}.`
      : "";
    speak(
      `Через ${meters} метров ${current.instruction.toLowerCase()}.${following}`
    );
  }
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

function locationIcon(headingValue) {
  const heading = Number.isFinite(headingValue) ? headingValue : 0;
  const directionClass = Number.isFinite(headingValue) ? " has-heading" : "";
  return L.divIcon({
    className: "user-location-marker",
    html: `
      <div class="location-puck${directionClass}">
        <span class="location-direction" style="transform:rotate(${heading}deg)"></span>
        <span class="location-dot"></span>
      </div>
    `,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    tooltipAnchor: [0, -24]
  });
}

function updateLocationIconHeading() {
  const puck = state.locationMarker?.getElement()?.querySelector(
    ".location-puck"
  );
  const direction = puck?.querySelector(".location-direction");
  if (!puck || !direction) return;
  const hasHeading = Number.isFinite(state.locationHeading);
  puck.classList.toggle("has-heading", hasHeading);
  direction.style.transform =
    `rotate(${hasHeading ? state.locationHeading : 0}deg)`;
}

function updateLocationHeading(position, previousLatLng, fix) {
  const sensorHeading = Number(position.coords.heading);
  const speed = Number(position.coords.speed);
  if (
    Number.isFinite(sensorHeading)
    && sensorHeading >= 0
    && (!Number.isFinite(speed) || speed >= .8)
  ) {
    state.locationHeading = sensorHeading;
    return;
  }
  if (
    !fix.ignored
    && previousLatLng
    && map.distance(previousLatLng, fix.latlng) >= 4
  ) {
    state.locationHeading = bearing(previousLatLng, fix.latlng);
  }
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
  updateVoiceGuidance(current, next, distance);
}

function hideNavigation() {
  state.maneuvers = [];
  state.routeAlong = null;
  navigationBanner.hidden = true;
  navigationBanner.classList.remove("off-route");
  resetVoiceProgress();
}

function followRouteAhead(displayLatLng) {
  if (!state.followLocation) return;
  const along = state.routeAlong || 0;
  const lookAhead = routePointAt(along + (isMobile() ? 120 : 90));
  const center = lookAhead
    ? L.latLng(
      displayLatLng.lat + (lookAhead.lat - displayLatLng.lat) * .42,
      displayLatLng.lng + (lookAhead.lng - displayLatLng.lng) * .42
    )
    : displayLatLng;
  const now = Date.now();
  const moved = state.cameraTarget
    ? map.distance(state.cameraTarget, center)
    : Infinity;
  if (moved < 7 && now - state.lastCameraMove < 1400) return;

  state.cameraTarget = center;
  state.lastCameraMove = now;
  const targetZoom = isMobile() ? 18 : 17;
  if (map.getZoom() < targetZoom) {
    map.setView(center, targetZoom, { animate: true });
  } else {
    map.panTo(center, {
      animate: true,
      duration: .55,
      easeLinearity: .35,
      noMoveStart: true
    });
  }
}

function updateRouteAhead(position) {
  if (!position || state.routeLatLngs.length < 2) return;
  const endDistance = Math.min(
    state.routeDistances[state.routeDistances.length - 1],
    position.along + 350
  );
  const points = [position.latlng];
  for (
    let index = position.segmentIndex + 1;
    index < state.routeLatLngs.length
      && state.routeDistances[index] < endDistance;
    index += 1
  ) {
    points.push(state.routeLatLngs[index]);
  }
  const end = routePointAt(endDistance);
  if (end) points.push(end);

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
  state.routeAhead.bringToFront();
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
  if (position.offRoute > 80) {
    if (!state.spokenOffRoute) {
      state.spokenOffRoute = true;
      speak("Вы отклонились от маршрута. Вернитесь к линии маршрута.", true);
    }
    status.textContent = "Вы отклонились от маршрута больше чем на 80 м.";
    navigationBanner.classList.add("off-route");
    maneuverDistance.textContent = "Маршрут потерян";
    maneuverInstruction.textContent = "Вернитесь к линии маршрута";
    followingManeuver.textContent =
      `Отклонение ${formatDistance(position.offRoute)}`;
  } else {
    if (position.offRoute < 50) state.spokenOffRoute = false;
    navigationBanner.classList.remove("off-route");
  }
}

function updateLocation(position, centerMap = false) {
  const fix = filteredPosition(position);
  const previousLatLng = state.filteredLocation;
  updateLocationHeading(position, previousLatLng, fix);
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

  if (!state.locationMarker) {
    state.locationMarker = L.marker(displayLatLng, {
      icon: locationIcon(state.locationHeading),
      keyboard: false,
      zIndexOffset: 1000
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
    updateLocationIconHeading();
    state.accuracyCircle.setLatLng(fix.latlng).setRadius(fix.accuracy);
  }

  locationSummary.hidden = false;
  const snapLabel = routeMatch && routeMatch.offRoute <= snapDistance
    ? " · привязано к маршруту"
    : "";
  const filterLabel = fix.ignored ? " · GPS без подтверждённого движения" : "";
  locationState.textContent =
    `Точность геолокации: ±${accuracy} м${snapLabel}${filterLabel}`;
  updateProgress(fix.latlng);
  if (centerMap) {
    map.setView(displayLatLng, Math.max(map.getZoom(), isMobile() ? 18 : 17), {
      animate: true
    });
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
    if (state.routeAhead) state.routeAhead.remove();
    state.route = null;
    state.routeAhead = null;
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
    if (state.routeAhead) state.routeAhead.remove();
    state.route = null;
    state.routeAhead = null;
    state.routeAlong = 0;

    const routeColor = ["experimental", "custom_experimental"].includes(
      data.properties.profile
    )
      ? "#8b4db8"
      : "#d65b35";
    state.route = L.geoJSON(data, {
      style: { color: routeColor, weight: 7, opacity: .9 }
    }).addTo(map);
    resetVoiceProgress();
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
  if (state.routeAhead) state.routeAhead.remove();
  state.start = null;
  state.goal = null;
  state.markers = [];
  state.route = null;
  state.routeAhead = null;
  state.routeLatLngs = [];
  state.routeDistances = [];
  state.cameraTarget = null;
  state.lastCameraMove = 0;
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
locateButton.addEventListener("click", () => {
  if (!requireGeolocation()) return;
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
trackButton.addEventListener("click", () => {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
    state.followLocation = false;
    state.cameraTarget = null;
    state.lastCameraMove = 0;
    map.getContainer().classList.remove("navigation-following");
    trackButton.classList.remove("active");
    trackButton.textContent = "Отслеживать";
    status.textContent = "Отслеживание остановлено.";
    disableWakeLock();
    return;
  }
  if (!requireGeolocation()) return;
  state.followLocation = true;
  state.cameraTarget = null;
  state.lastCameraMove = 0;
  map.getContainer().classList.add("navigation-following");
  if (isMobile()) setPanelCollapsed(true);
  trackButton.classList.add("active");
  trackButton.textContent = "Остановить отслеживание";
  status.textContent = "Отслеживание местоположения включено.";
  requestWakeLock();
  if (state.currentLocation) followRouteAhead(state.currentLocation);
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
voiceGuidanceButton.addEventListener("click", () => {
  if (!state.voiceSupported) {
    updateVoiceButton("Голос не поддерживается");
    status.textContent = "Этот браузер не поддерживает голосовые подсказки.";
    return;
  }
  state.voiceEnabled = !state.voiceEnabled;
  window.speechSynthesis.cancel();
  resetVoiceProgress();
  updateVoiceButton();
  if (state.voiceEnabled) {
    speak("Голосовые подсказки включены.", true);
    status.textContent = "Голосовые подсказки включены.";
  } else {
    status.textContent = "Голосовые подсказки выключены.";
  }
});
undoPointButton.addEventListener("click", () => {
  const marker = state.customMarkers.pop();
  if (marker) marker.remove();
  state.customPoints.pop();
  if (state.route) {
    state.route.remove();
    if (state.routeAhead) state.routeAhead.remove();
    state.route = null;
    state.routeAhead = null;
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
initializeTelegramWebApp();
protectMapGestures();
customControls.hidden = !isCustomMode();
updateCustomLabels();
if (isMobile()) setPanelCollapsed(true);
if (!("wakeLock" in navigator)) {
  wakeLockButton.classList.add("unsupported");
  updateWakeLockButton("Подсветка не поддерживается");
}
if (state.voiceSupported) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", preferredVoice);
} else {
  voiceGuidanceButton.disabled = true;
}
updateVoiceButton();
