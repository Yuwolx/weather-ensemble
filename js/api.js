// Data access: talk to Open-Meteo's ensemble API and reshape its very wide response
// into something the stats layer can consume. Also owns geolocation. No DOM here.

import { MODELS, FORECAST_DAYS, ENSEMBLE_ENDPOINT } from './config.js';

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
  });
  return `${ENSEMBLE_ENDPOINT}?${p.toString()}`;
}

export async function fetchEnsemble(lat, lon) {
  const res = await fetch(buildEnsembleUrl(lat, lon));
  if (!res.ok) {
    throw new Error(`예보 서버 응답 오류 (${res.status})`);
  }
  const json = await res.json();
  if (json.error) throw new Error(json.reason || '예보 데이터를 불러오지 못했습니다.');
  return json;
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

  const models = new Set(precipKeys.map((k) => modelIdOf(k, 'precipitation')));

  const hours = times.map((time, i) => ({
    time, // local ISO string, e.g. "2026-07-08T15:00"
    precipMembers: precipKeys.map((k) => hourly[k][i]),
    windMembers: windKeys.map((k) => hourly[k][i]),
    tempMembers: tempKeys.map((k) => hourly[k][i]),
  }));

  return {
    hours,
    memberCount: precipKeys.length,
    modelCount: models.size,
    elevation: json.elevation,
    utcOffsetSeconds: json.utc_offset_seconds,
  };
}

export async function loadEnsemble(lat, lon) {
  return parseEnsemble(await fetchEnsemble(lat, lon));
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
