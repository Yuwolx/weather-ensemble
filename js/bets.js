// The betting loop: the user picks which scenario they think will win for a given
// hour; once that hour is in the past we compare their pick to what actually fell.
// Pure settlement logic here (unit-tested); localStorage persistence at the bottom.

import { classifyPrecip } from './stats.js';

// Settle a placed bet against the observed precip (mm) for its hour.
// Returns what actually happened, whether the pick won, and — the whole point —
// whether an underdog (a low-probability scenario) is the one that came true.
export function settleBet(bet, actualMm, buckets) {
  const actualKey = classifyPrecip(actualMm, buckets);
  const actualProb = bet.dist ? bet.dist[actualKey] ?? 0 : null;
  return {
    actualKey,
    actualProb,
    actualMm,
    betKey: bet.betKey,
    betProb: bet.betProb,
    won: bet.betKey === actualKey,
    // an outcome the models mostly doubted (< 20%) actually happening
    underdog: actualProb != null && actualProb < 0.2,
  };
}

// ---- persistence (browser localStorage) -----------------------------------
const KEY = (region, time) => `wx-bet:${region}:${time}`;

export function placeBet(bet) {
  try {
    localStorage.setItem(KEY(bet.region, bet.time), JSON.stringify(bet));
  } catch {
    /* storage unavailable — betting simply won't persist */
  }
}

export function getBet(region, time) {
  try {
    const raw = localStorage.getItem(KEY(region, time));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearBet(region, time) {
  try {
    localStorage.removeItem(KEY(region, time));
  } catch {
    /* ignore */
  }
}

// All stored bets (across regions) — used on load to find ones ready to settle.
export function allBets() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('wx-bet:')) {
        const raw = localStorage.getItem(k);
        if (raw) out.push(JSON.parse(raw));
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}
