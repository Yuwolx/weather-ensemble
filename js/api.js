// Data access: talk to Open-Meteo's ensemble API and reshape its very wide response
// into something the stats layer can consume. Also owns geolocation. No DOM here.

import { MODELS, FORECAST_DAYS, ENSEMBLE_ENDPOINT, KMA_MODEL, FORECAST_ENDPOINT, ACTUALS_PAST_DAYS } from './config.js';

// Build the request. One call returns every member of every model as its own
// hourly series, e.g. hourly["precipitation_member07_ecmwf_ifs025"].
export function buildEnsembleUrl(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: 'precipitation,wind_speed_10m,temperature_2m',
    models: MODELS.join(','),
    wind_speed_unit: 'ms',
    timezone: 'auto',
    forecast_days: String(FORECAST_DAYS),
    // Yesterday rides along in the same call. Open-Meteo archives the actual
    // short-lead member forecasts for past days (verified empirically: real
    // spread, not assimilated truth), so 돌아보기 gets "어제의 예보 분포"
    // even on a first visit with no local snapshot.
    past_days: '1',
  });
  return `${ENSEMBLE_ENDPOINT}?${p.toString()}`;
}

export async function fetchEnsemble(lat, lon) {
  // Never hang forever: abort after 12s so a stalled network fails to a retry.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(buildEnsembleUrl(lat, lon), { signal: ctrl.signal });
    if (!res.ok) throw new Error(`예보 서버 응답 오류 (${res.status})`);
    const json = await res.json();
    if (json.error) throw new Error(json.reason || '예보 데이터를 불러오지 못했습니다.');
    return json;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('예보 서버 응답이 너무 느립니다. 다시 시도해 주세요.');
    if (e instanceof TypeError) throw new Error('예보 서버에 접속하지 못했습니다. 네트워크를 확인해 주세요.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Strip "precipitation_" / "precipitation_memberNN_" down to the model id, so we can
// count how many distinct agencies actually contributed.
function modelIdOf(key, prefix) {
  return key.slice(prefix.length).replace(/^_/, '').replace(/^member\d+_/, '');
}

// Reshape the wide response into one row per hour, each carrying the full bag of
// member values for that hour. This is the bridge from "API shape" to "stats input".
export function parseEnsemble(json) {
  const hourly = json.hourly || {};
  const times = hourly.time || [];
  const keys = Object.keys(hourly);
  const precipKeys = keys.filter((k) => k.startsWith('precipitation'));
  const windKeys = keys.filter((k) => k.startsWith('wind_speed_10m'));
  const tempKeys = keys.filter((k) => k.startsWith('temperature_2m'));

  // precip keys grouped by agency, so each model can be scored on its own
  // (기관별 적중) — the member key carries the model id it belongs to
  const modelKeys = new Map();
  for (const k of precipKeys) {
    const m = modelIdOf(k, 'precipitation');
    if (!modelKeys.has(m)) modelKeys.set(m, []);
    modelKeys.get(m).push(k);
  }

  const hours = times.map((time, i) => ({
    time, // local ISO string, e.g. "2026-07-08T15:00"
    precipMembers: precipKeys.map((k) => hourly[k][i]),
    precipByModel: Object.fromEntries([...modelKeys].map(([m, ks]) => [m, ks.map((k) => hourly[k][i])])),
    windMembers: windKeys.map((k) => hourly[k][i]),
    tempMembers: tempKeys.map((k) => hourly[k][i]),
  }));

  return {
    hours,
    memberCount: precipKeys.length,
    modelCount: modelKeys.size,
    elevation: json.elevation,
    utcOffsetSeconds: json.utc_offset_seconds,
  };
}

export async function loadEnsemble(lat, lon) {
  return parseEnsemble(await fetchEnsemble(lat, lon));
}

// 기상청 KIM 수치모델의 시간별 강수 — the Korean baseline for the scenario
// board. Deterministic single run → Map of local-ISO-hour → mm. Callers treat
// failure as "marker simply absent".
export async function loadKma(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: 'precipitation',
    models: KMA_MODEL,
    forecast_days: String(FORECAST_DAYS),
    timezone: 'auto',
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${FORECAST_ENDPOINT}?${p}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`kma ${res.status}`);
    const json = await res.json();
    const times = json.hourly?.time || [];
    const mm = json.hourly?.precipitation || [];
    return new Map(times.map((t, i) => [t, mm[i]]));
  } finally {
    clearTimeout(timer);
  }
}

// What actually fell in the recent past: hourly precipitation from the forecast
// API's assimilation window (past_days). This is reanalysis-grade "실측 근사" —
// good enough to settle "어느 시나리오가 이겼나", available without delay.
// Several days deep so snapshots from skipped days still get settled into the
// 확률 성적표 ledger. Returns a Map of local-ISO-hour → mm.
export async function loadActuals(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: 'precipitation',
    past_days: String(ACTUALS_PAST_DAYS),
    forecast_days: '1',
    timezone: 'auto',
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${FORECAST_ENDPOINT}?${p}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`actuals ${res.status}`);
    const json = await res.json();
    const times = json.hourly?.time || [];
    const mm = json.hourly?.precipitation || [];
    return new Map(times.map((t, i) => [t, mm[i]]));
  } finally {
    clearTimeout(timer);
  }
}

// Browser geolocation, promisified. Rejects with a friendly message the UI can show.
export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('이 브라우저는 위치 기능을 지원하지 않습니다.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => reject(new Error('위치 접근이 거부되었습니다. 검색으로 지역을 골라주세요.')),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
    );
  });
}

// Nearest bundled 시군구 to a coordinate, so a raw GPS fix gets a human label.
// Simple equirectangular distance — plenty accurate at this scale.
export function nearestRegion(lat, lon, regions) {
  let best = null;
  let bestD = Infinity;
  const kx = Math.cos((lat * Math.PI) / 180);
  for (const r of regions) {
    const dx = (r.lon - lon) * kx;
    const dy = r.lat - lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}
