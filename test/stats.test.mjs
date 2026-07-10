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
