// Snapshot store — the device's own memory of "그때 화면이 보여준 경우의 수".
// Open-Meteo can't give us yesterday's forecast as it was issued (past_days is
// the newest run's hindcast), so we keep the first distribution this device saw
// for each region-day in localStorage. Per-device, no backend: consistent with
// the free/static direction, and emotionally right — we settle against what the
// user actually looked at. (돌아보기는 정보로만; 베팅/결산 UI는 부활 금지.)

import { RETRO_KEEP_DAYS } from './config.js';
import { addDays } from './format.js';

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
    // addDays keeps this in local date parts — toISOString here would shift the
    // cutoff by the UTC offset (KST 00:00 → previous day 15:00Z, off by one)
    const min = addDays(todayDate, -RETRO_KEEP_DAYS);
    const stale = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if ((k?.startsWith(PREFIX) || k?.startsWith(PICK_PREFIX)) && k.slice(-10) < min) stale.push(k);
    }
    stale.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* best effort */
  }
}

// ---- 예감 (the user's own scenario picks) -----------------------------------
// Picking a scenario is a quiet declaration of a hunch. We keep it so tomorrow
// can answer "내 예감은 맞았나" — information, never stakes.
const PICK_PREFIX = 'pick:';
const pickKeyOf = (region, date) => `${PICK_PREFIX}${region.lat.toFixed(2)},${region.lon.toFixed(2)}:${date}`;

export function savePick(region, time, key) {
  const k = pickKeyOf(region, time.slice(0, 10));
  try {
    const picks = JSON.parse(localStorage.getItem(k) || '{}');
    if (key) picks[time] = key;
    else delete picks[time];
    localStorage.setItem(k, JSON.stringify(picks));
  } catch {
    /* quota/privacy — hunches just aren't recorded */
  }
}

export function getPicks(region, date) {
  try {
    return JSON.parse(localStorage.getItem(pickKeyOf(region, date)) || '{}');
  } catch {
    return {};
  }
}

// ---- 통산 기록 — one running ledger of settled hunches (capped) --------------
const RECORD_KEY = 'hunch-record';

export function appendRecord(regionKey, entries) {
  try {
    const rec = JSON.parse(localStorage.getItem(RECORD_KEY) || '[]');
    const seen = new Set(rec.map((r) => `${r.rk}|${r.time}`));
    for (const e of entries) {
      if (!seen.has(`${regionKey}|${e.time}`)) rec.push({ rk: regionKey, ...e });
    }
    localStorage.setItem(RECORD_KEY, JSON.stringify(rec.slice(-200)));
    return rec;
  } catch {
    return entries.map((e) => ({ rk: regionKey, ...e }));
  }
}

export function getRecord() {
  try {
    return JSON.parse(localStorage.getItem(RECORD_KEY) || '[]');
  } catch {
    return [];
  }
}

export const regionKeyOf = (region) => `${region.lat.toFixed(2)},${region.lon.toFixed(2)}`;

// ---- 확률 성적표 원장 — settled "said p% / did it rain" hours ----------------
// One flat ledger across regions (a probability is a probability wherever it was
// stated). Deduped by region+hour so re-visits and snapshot/archive overlap never
// double-count. Capped: ~2000 hours ≈ 80+ days of single-region records.
const CALIB_KEY = 'calib:v1';

// Has this device settled a retrospect before? Used to keep the first-run
// invitation from flashing at returning users while actuals load. The calib
// ledger (not retro:/pick: keys) is the tell — snapshots are saved for today
// BEFORE the retro refresh, so they exist even on a true first visit.
export function hasSettledHistory() {
  try {
    return JSON.parse(localStorage.getItem(CALIB_KEY) || '[]').length > 0;
  } catch {
    return false;
  }
}

export function appendCalibration(regionKey, entries) {
  try {
    const rec = JSON.parse(localStorage.getItem(CALIB_KEY) || '[]');
    const seen = new Set(rec.map((r) => `${r.rk}|${r.time}`));
    for (const e of entries) {
      // p rounded to 3 decimals: float-tail JSON ("0.30000000000000004") wastes
      // a third of the ledger's byte budget for no informational gain
      if (!seen.has(`${regionKey}|${e.time}`)) {
        rec.push({ rk: regionKey, time: e.time, p: Math.round(e.p * 1000) / 1000, wet: e.wet });
      }
    }
    const capped = rec.slice(-2000);
    localStorage.setItem(CALIB_KEY, JSON.stringify(capped));
    return capped;
  } catch {
    return entries.map((e) => ({ rk: regionKey, ...e }));
  }
}
