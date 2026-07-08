// Pure ensemble statistics — no DOM, no fetch, no globals. Everything here is a
// deterministic function of its inputs so it can be unit-tested and reasoned about
// in isolation. This is the heart of the app: it turns a bag of member forecasts
// into a probability distribution.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clean = (arr) => arr.filter(isNum);

// Which precipitation bucket a single mm/h value falls into. Buckets are half-open
// [min, max), so a value exactly on a boundary belongs to the higher-intensity bucket.
export function classifyPrecip(mm, buckets) {
  for (const b of buckets) {
    if (mm >= b.min && mm < b.max) return b.key;
  }
  return buckets[buckets.length - 1].key; // Infinity guard
}

// The core reduction: count how many ensemble members land in each precip bucket,
// and express that as fractions. Invalid members (null/NaN — Open-Meteo leaves gaps)
// are dropped, and n reflects only the members that actually voted.
export function precipDistribution(members, buckets) {
  const vals = clean(members);
  const counts = {};
  const fraction = {};
  for (const b of buckets) {
    counts[b.key] = 0;
    fraction[b.key] = 0;
  }
  for (const v of vals) counts[classifyPrecip(v, buckets)] += 1;
  const n = vals.length;
  if (n > 0) for (const b of buckets) fraction[b.key] = counts[b.key] / n;
  return { n, counts, fraction, buckets };
}

// Headline number: share of members forecasting at least `threshold` mm of rain.
export function rainProbability(members, threshold) {
  const vals = clean(members);
  const n = vals.length;
  const wet = vals.filter((v) => v >= threshold).length;
  return { n, probability: n > 0 ? wet / n : 0, wet };
}

// Linear-interpolated quantile over an unsorted numeric array. q in [0,1].
export function quantile(members, q) {
  const vals = clean(members).slice().sort((a, b) => a - b);
  if (vals.length === 0) return null;
  if (vals.length === 1) return vals[0];
  const idx = q * (vals.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return vals[lo];
  return vals[lo] + (vals[hi] - vals[lo]) * (idx - lo);
}

// A continuous quantity (wind, temperature) reported as a spread: the median plus
// a p10–p90 band tells you both the likely value and how much the models disagree.
export function spread(members) {
  const vals = clean(members);
  return {
    n: vals.length,
    median: quantile(vals, 0.5),
    p10: quantile(vals, 0.1),
    p90: quantile(vals, 0.9),
    min: vals.length ? Math.min(...vals) : null,
    max: vals.length ? Math.max(...vals) : null,
  };
}
export const windStats = spread; // kept for readability at call sites

// How much rain, not just whether: the typical (p50) and heavy-case (p90) hourly
// amount across all members. p50 near 0 with a high p90 = "probably light, could pour".
export function precipAmount(members) {
  return { p50: quantile(members, 0.5), p90: quantile(members, 0.9) };
}

// Compose the per-hour picture: distribution + headline rain prob + wind + consensus.
// Pure; used by the UI to turn one raw hour into everything it needs to render.
export function analyzeHour(hour, buckets, rainThreshold) {
  const dist = precipDistribution(hour.precipMembers, buckets);
  return {
    time: hour.time,
    dist,
    rain: rainProbability(hour.precipMembers, rainThreshold),
    amount: precipAmount(hour.precipMembers),
    wind: spread(hour.windMembers),
    temp: spread(hour.tempMembers || []),
    agree: agreement(dist),
  };
}

// How much the models agree, derived from an existing precip distribution: the
// dominant scenario and the share of members backing it. share≈1 → strong consensus;
// share near 1/#buckets → the models are all over the place (which is itself the
// signal this app exists to surface).
export function agreement(distribution) {
  let dominantKey = null;
  let share = 0;
  for (const [key, frac] of Object.entries(distribution.fraction)) {
    if (frac > share) {
      share = frac;
      dominantKey = key;
    }
  }
  return { dominantKey, share };
}
