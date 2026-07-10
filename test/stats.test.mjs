import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPrecip,
  precipDistribution,
  rainProbability,
  windStats,
  spread,
  precipAmount,
  agreement,
  dayMood,
} from '../js/stats.js';
import { PRECIP_BUCKETS, RAIN_THRESHOLD_MM, MOOD_THRESHOLDS } from '../js/config.js';

// dayMood: the day's overall "air" — drives the sky wash, so misclassifying a
// rainy day as clear would color the whole screen wrong.
const hoursWithProbs = (probs) => probs.map((p) => ({ rain: { probability: p } }));

test('dayMood: mostly-wet day reads rainy', () => {
  assert.equal(dayMood(hoursWithProbs([0.7, 0.8, 0.6, 0.9]), MOOD_THRESHOLDS), 'rainy');
});

test('dayMood: dry day reads clear', () => {
  assert.equal(dayMood(hoursWithProbs([0, 0.05, 0.1, 0.02]), MOOD_THRESHOLDS), 'clear');
});

test('dayMood: a wet evening on a dry day reads unsettled, not clear', () => {
  // 8 dry hours + 4 rainy evening hours → mean 0.27
  assert.equal(
    dayMood(hoursWithProbs([0, 0, 0, 0, 0.05, 0.05, 0.1, 0.1, 0.7, 0.8, 0.7, 0.75]), MOOD_THRESHOLDS),
    'unsettled',
  );
});

test('dayMood: thresholds are inclusive at the boundary', () => {
  assert.equal(dayMood(hoursWithProbs([0.5, 0.5]), MOOD_THRESHOLDS), 'rainy');
  assert.equal(dayMood(hoursWithProbs([0.2, 0.2]), MOOD_THRESHOLDS), 'unsettled');
});

test('dayMood: no hours falls back to unsettled (neutral air)', () => {
  assert.equal(dayMood([], MOOD_THRESHOLDS), 'unsettled');
});

// Retrospect (돌아보기): pure comparison of a stored forecast snapshot against
// what actually happened. This is the app's reason to exist — "작은 확률이
// 이겼구나" must be computed honestly.
import { pickRetroHour, retroVerdict } from '../js/stats.js';

const snapHour = (time, dry, light, mod, heavy) => ({
  time,
  fraction: { dry, light, mod, heavy },
  n: 100,
});

test('pickRetroHour: picks the hour with the most actual rain', () => {
  const snaps = [snapHour('2026-07-09T13:00', 0.8, 0.2, 0, 0), snapHour('2026-07-09T14:00', 0.5, 0.4, 0.1, 0)];
  const actuals = new Map([
    ['2026-07-09T13:00', 0.4],
    ['2026-07-09T14:00', 2.2],
  ]);
  const r = pickRetroHour(snaps, actuals);
  assert.equal(r.time, '2026-07-09T14:00');
  assert.equal(r.mm, 2.2);
});

test('pickRetroHour: dry day falls back to the hour forecast riskiest', () => {
  const snaps = [snapHour('2026-07-09T09:00', 0.9, 0.1, 0, 0), snapHour('2026-07-09T15:00', 0.55, 0.35, 0.1, 0)];
  const actuals = new Map([
    ['2026-07-09T09:00', 0],
    ['2026-07-09T15:00', 0.05],
  ]);
  const r = pickRetroHour(snaps, actuals);
  assert.equal(r.time, '2026-07-09T15:00'); // highest forecast rain chance
  assert.equal(r.mm, 0.05);
});

test('pickRetroHour: no overlapping hours returns null', () => {
  const snaps = [snapHour('2026-07-09T09:00', 1, 0, 0, 0)];
  assert.equal(pickRetroHour(snaps, new Map([['2026-07-09T10:00', 0]])), null);
});

test('retroVerdict: dominant scenario winning is a hit with its probability', () => {
  const v = retroVerdict({ dry: 0.7, light: 0.2, mod: 0.1, heavy: 0 }, 0, PRECIP_BUCKETS);
  assert.equal(v.actualKey, 'dry');
  assert.equal(v.hit, true);
  assert.ok(Math.abs(v.prob - 0.7) < 1e-9);
});

test('retroVerdict: a small probability winning is an upset, not a betrayal', () => {
  const v = retroVerdict({ dry: 0.72, light: 0.2, mod: 0.08, heavy: 0 }, 1.5, PRECIP_BUCKETS);
  assert.equal(v.actualKey, 'mod'); // 1.5mm/h = 비
  assert.equal(v.hit, false);
  assert.ok(Math.abs(v.prob - 0.08) < 1e-9);
});

test('classifyPrecip puts values in the right bucket (half-open [min,max))', () => {
  assert.equal(classifyPrecip(0, PRECIP_BUCKETS), 'dry');
  assert.equal(classifyPrecip(0.09, PRECIP_BUCKETS), 'dry');
  assert.equal(classifyPrecip(0.1, PRECIP_BUCKETS), 'light'); // boundary belongs to upper bucket
  assert.equal(classifyPrecip(0.9, PRECIP_BUCKETS), 'light');
  assert.equal(classifyPrecip(1.0, PRECIP_BUCKETS), 'mod');
  assert.equal(classifyPrecip(3.9, PRECIP_BUCKETS), 'mod');
  assert.equal(classifyPrecip(4.0, PRECIP_BUCKETS), 'heavy');
  assert.equal(classifyPrecip(50, PRECIP_BUCKETS), 'heavy');
});

test('precipDistribution returns fractions that sum to 1 and match counts', () => {
  // 10 members: 6 dry, 2 light, 1 mod, 1 heavy
  const members = [0, 0, 0, 0, 0, 0.05, 0.2, 0.5, 2.0, 10.0];
  const d = precipDistribution(members, PRECIP_BUCKETS);
  assert.equal(d.n, 10);
  assert.equal(d.counts.dry, 6);
  assert.equal(d.counts.light, 2);
  assert.equal(d.counts.mod, 1);
  assert.equal(d.counts.heavy, 1);
  assert.equal(d.fraction.dry, 0.6);
  assert.equal(d.fraction.light, 0.2);
  const sum = Object.values(d.fraction).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('precipDistribution ignores null/undefined/NaN members', () => {
  const members = [0, null, 0.5, undefined, NaN, 5];
  const d = precipDistribution(members, PRECIP_BUCKETS);
  assert.equal(d.n, 3); // only 0, 0.5, 5 are valid
  assert.equal(d.counts.dry, 1);
  assert.equal(d.counts.light, 1);
  assert.equal(d.counts.heavy, 1);
});

test('precipDistribution with no valid data reports n=0 and zero fractions', () => {
  const d = precipDistribution([null, NaN], PRECIP_BUCKETS);
  assert.equal(d.n, 0);
  for (const b of PRECIP_BUCKETS) assert.equal(d.fraction[b.key], 0);
});

test('rainProbability is the share of members at or above the threshold', () => {
  const members = [0, 0, 0.05, 0.1, 0.5, 5]; // >=0.1 -> 3 of 6
  const r = rainProbability(members, RAIN_THRESHOLD_MM);
  assert.equal(r.n, 6);
  assert.equal(r.probability, 0.5);
});

test('rainProbability skips nulls and reports n=0 cleanly when empty', () => {
  const r = rainProbability([null, undefined], RAIN_THRESHOLD_MM);
  assert.equal(r.n, 0);
  assert.equal(r.probability, 0);
});

test('windStats reports median and a p10-p90 spread', () => {
  const members = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const w = windStats(members);
  assert.equal(w.n, 10);
  assert.ok(Math.abs(w.median - 5.5) < 1e-9);
  assert.ok(w.p10 >= 1 && w.p10 <= w.median);
  assert.ok(w.p90 <= 10 && w.p90 >= w.median);
  assert.equal(w.max, 10);
});

test('spread reports median, p10-p90 band, and min/max', () => {
  const s = spread([10, 12, 14, 16, 18, 20, 22, 24, 26, 28]);
  assert.equal(s.n, 10);
  assert.ok(Math.abs(s.median - 19) < 1e-9);
  assert.equal(s.min, 10);
  assert.equal(s.max, 28);
  assert.ok(s.p10 < s.median && s.p90 > s.median);
});

test('spread on empty input is null-valued, not a crash', () => {
  const s = spread([null, NaN]);
  assert.equal(s.n, 0);
  assert.equal(s.median, null);
  assert.equal(s.min, null);
});

test('precipAmount gives typical (p50) and heavy-case (p90) mm', () => {
  // dry majority (7 of 10) with a few wet members: p50 dry, p90 shows the heavy case
  const a = precipAmount([0, 0, 0, 0, 0, 0, 0, 2, 5, 12]);
  assert.equal(a.p50, 0); // median member is dry
  assert.ok(a.p90 > a.p50);
});

test('agreement returns the dominant scenario and its share', () => {
  // heavy consensus: 9 dry, 1 light -> dominant dry, share 0.9
  const strong = precipDistribution([0,0,0,0,0,0,0,0,0,0.2], PRECIP_BUCKETS);
  const a1 = agreement(strong);
  assert.equal(a1.dominantKey, 'dry');
  assert.ok(Math.abs(a1.share - 0.9) < 1e-9);

  // total split: 5 dry, 5 heavy -> low agreement (share 0.5)
  const split = precipDistribution([0,0,0,0,0,5,5,5,5,5], PRECIP_BUCKETS);
  const a2 = agreement(split);
  assert.ok(a2.share <= 0.5 + 1e-9);
});
