// Snapshot store — the device's own memory of "그때 화면이 보여준 경우의 수".
// Open-Meteo can't give us yesterday's forecast as it was issued (past_days is
// the newest run's hindcast), so we keep the first distribution this device saw
// for each region-day in localStorage. Per-device, no backend: consistent with
// the free/static direction, and emotionally right — we settle against what the
// user actually looked at. (돌아보기는 정보로만; 베팅/결산 UI는 부활 금지.)

import { RETRO_KEEP_DAYS } from './config.js';

const PREFIX = 'retro:';
const keyOf = (region, date) => `${PREFIX}${region.lat.toFixed(2)},${region.lon.toFixed(2)}:${date}`;

// First-seen wins: the earliest save is the real forecast; later runs would
// quietly rewrite history.
export function saveDaySnapshots(region, byDay, todayDate) {
  for (const [date, hours] of byDay) {
    const k = keyOf(region, date);
    try {
      if (localStorage.getItem(k)) continue;
      const snap = {
        savedOn: todayDate,
        hours: hours.map((a) => ({ time: a.time, fraction: a.dist.fraction, n: a.dist.n })),
      };
      localStorage.setItem(k, JSON.stringify(snap));
    } catch {
      /* quota/privacy mode — retrospect just stays empty */
    }
  }
  prune(todayDate);
}

// A snapshot only counts if it was saved while that day was still the future
// (or that same day) — otherwise it isn't "그때 예보".
export function getSnapshot(region, date) {
  try {
    const raw = localStorage.getItem(keyOf(region, date));
    if (!raw) return null;
    const snap = JSON.parse(raw);
    return snap.savedOn <= date ? snap : null;
  } catch {
    return null;
  }
}

function prune(todayDate) {
  try {
    const cutoff = new Date(`${todayDate}T00:00`);
    cutoff.setDate(cutoff.getDate() - RETRO_KEEP_DAYS);
    const min = cutoff.toISOString().slice(0, 10);
    const stale = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX) && k.slice(-10) < min) stale.push(k);
    }
    stale.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* best effort */
  }
}
