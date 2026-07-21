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

import { summarizeActuals, settlePicks, forecastScore } from '../js/stats.js';

test('forecastScore: daily hit rate of the dominant scenario + mean prob given to reality', () => {
  const hours = [
    snapHour('2026-07-09T10:00', 0.8, 0.2, 0, 0), // dominant dry, actual dry → hit, prob .8
    snapHour('2026-07-09T11:00', 0.3, 0.5, 0.2, 0), // dominant light, actual mod → miss, prob .2
    snapHour('2026-07-09T12:00', 0.1, 0.3, 0.6, 0), // dominant mod, actual mod → hit, prob .6
  ];
  const actuals = new Map([
    ['2026-07-09T10:00', 0],
    ['2026-07-09T11:00', 2.0],
    ['2026-07-09T12:00', 1.5],
  ]);
  const s = forecastScore(hours, actuals, PRECIP_BUCKETS);
  assert.equal(s.n, 3);
  assert.equal(s.hits, 2);
  assert.ok(Math.abs(s.hitRate - 2 / 3) < 1e-9);
  assert.ok(Math.abs(s.meanProb - (0.8 + 0.2 + 0.6) / 3) < 1e-9);
});

test('forecastScore: no overlap returns null', () => {
  assert.equal(forecastScore([snapHour('2026-07-09T10:00', 1, 0, 0, 0)], new Map(), PRECIP_BUCKETS), null);
});

test('summarizeActuals: totals the day and finds the wettest hour', () => {
  const actuals = new Map([
    ['2026-07-09T09:00', 0],
    ['2026-07-09T15:00', 1.2],
    ['2026-07-09T16:00', 0.4],
  ]);
  const s = summarizeActuals(actuals);
  assert.ok(Math.abs(s.totalMm - 1.6) < 1e-9);
  assert.equal(s.peakTime, '2026-07-09T15:00');
  assert.equal(s.peakMm, 1.2);
  assert.equal(s.rained, true);
});

test('summarizeActuals: a dry day reports rained=false', () => {
  const s = summarizeActuals(new Map([['2026-07-09T09:00', 0], ['2026-07-09T10:00', 0.05]]));
  assert.equal(s.rained, false);
  assert.equal(s.peakTime, null);
});

test('settlePicks: scores each hunch against the actual bucket', () => {
  const picks = { '2026-07-09T14:00': 'light', '2026-07-09T18:00': 'dry' };
  const actuals = new Map([
    ['2026-07-09T14:00', 0.5], // light → hit
    ['2026-07-09T18:00', 2.0], // mod → miss
  ]);
  const settled = settlePicks(picks, actuals, PRECIP_BUCKETS);
  assert.equal(settled.length, 2);
  const at14 = settled.find((s) => s.time === '2026-07-09T14:00');
  assert.deepEqual({ picked: at14.picked, actual: at14.actual, hit: at14.hit }, { picked: 'light', actual: 'light', hit: true });
  const at18 = settled.find((s) => s.time === '2026-07-09T18:00');
  assert.equal(at18.hit, false);
  assert.equal(at18.actual, 'mod');
});

test('settlePicks: hours without actual data are skipped, not guessed', () => {
  const settled = settlePicks({ '2026-07-09T23:00': 'dry' }, new Map(), PRECIP_BUCKETS);
  assert.equal(settled.length, 0);
});

test('retroVerdict: a small probability winning is an upset, not a betrayal', () => {
  const v = retroVerdict({ dry: 0.72, light: 0.2, mod: 0.08, heavy: 0 }, 1.5, PRECIP_BUCKETS);
  assert.equal(v.actualKey, 'mod'); // 1.5mm/h = 비
  assert.equal(v.hit, false);
  assert.ok(Math.abs(v.prob - 0.08) < 1e-9);
});

// 확률 성적표 (calibration): "N%라고 말했을 때 실제로 그만큼 왔나"를 확률대별로.
// 시간·지역이 섞인 원장(ledger) 항목을 구간에 담아 말한 확률 vs 실제 비율을 대조한다.
import { calibrationEntries, calibrationReport } from '../js/stats.js';
import { CALIB_BIN_EDGES } from '../js/config.js';

test('calibrationEntries: each checkable hour becomes {p = 비 올 확률, wet}', () => {
  const hours = [
    snapHour('2026-07-09T10:00', 0.8, 0.2, 0, 0), // said 20%
    snapHour('2026-07-09T11:00', 0.3, 0.5, 0.2, 0), // said 70%
  ];
  const actuals = new Map([
    ['2026-07-09T10:00', 0], // stayed dry
    ['2026-07-09T11:00', 2.0], // rained
  ]);
  const e = calibrationEntries(hours, actuals, RAIN_THRESHOLD_MM);
  assert.equal(e.length, 2);
  assert.ok(Math.abs(e[0].p - 0.2) < 1e-9);
  assert.equal(e[0].wet, false);
  assert.ok(Math.abs(e[1].p - 0.7) < 1e-9);
  assert.equal(e[1].wet, true);
});

test('calibrationEntries: hours without actuals or fractions are skipped, not guessed', () => {
  const hours = [
    snapHour('2026-07-09T10:00', 0.8, 0.2, 0, 0), // no actual
    { time: '2026-07-09T11:00', fraction: null, n: 0 }, // no forecast
  ];
  const actuals = new Map([['2026-07-09T11:00', 1.0], ['2026-07-09T12:00', null]]);
  assert.equal(calibrationEntries(hours, actuals, RAIN_THRESHOLD_MM).length, 0);
});

test('calibrationEntries: an hour with zero voting members is skipped — its dry=0 would fake "100% 비"', () => {
  const noVotes = { time: '2026-07-09T10:00', fraction: { dry: 0, light: 0, mod: 0, heavy: 0 }, n: 0 };
  const actuals = new Map([['2026-07-09T10:00', 0]]);
  assert.equal(calibrationEntries([noVotes], actuals, RAIN_THRESHOLD_MM).length, 0);
});

test('calibrationEntries: the 0.1mm boundary counts as rain (same line as everywhere)', () => {
  const e = calibrationEntries(
    [snapHour('2026-07-09T10:00', 0.5, 0.5, 0, 0)],
    new Map([['2026-07-09T10:00', 0.1]]),
    RAIN_THRESHOLD_MM,
  );
  assert.equal(e[0].wet, true);
});

test('calibrationReport: bins said-probability, counts wet hours and distinct days', () => {
  const entries = [
    { time: '2026-07-07T10:00', p: 0.3, wet: false },
    { time: '2026-07-07T11:00', p: 0.35, wet: true },
    { time: '2026-07-08T10:00', p: 0.25, wet: false },
    { time: '2026-07-08T11:00', p: 0.9, wet: true },
    { time: '2026-07-09T10:00', p: 0.05, wet: false },
  ];
  const r = calibrationReport(entries, CALIB_BIN_EDGES);
  assert.equal(r.n, 5);
  assert.equal(r.days, 3);
  const b2040 = r.bins.find((b) => b.lo === 0.2 && b.hi === 0.4);
  assert.equal(b2040.n, 3);
  assert.equal(b2040.wet, 1);
  assert.equal(b2040.days, 2);
  assert.ok(Math.abs(b2040.avgP - 0.3) < 1e-9);
  assert.ok(Math.abs(b2040.wetRate - 1 / 3) < 1e-9);
});

test('calibrationReport: p=1.0 lands in the top bin, empty bins report n=0 with null rates', () => {
  const r = calibrationReport([{ time: '2026-07-09T10:00', p: 1, wet: true }], CALIB_BIN_EDGES);
  const top = r.bins[r.bins.length - 1];
  assert.equal(top.n, 1);
  assert.equal(top.wetRate, 1);
  assert.equal(r.bins[0].n, 0);
  assert.equal(r.bins[0].wetRate, null);
  assert.equal(r.bins[0].avgP, null);
});

test('calibrationReport: no entries is an empty report, not a crash', () => {
  const r = calibrationReport([], CALIB_BIN_EDGES);
  assert.equal(r.n, 0);
  assert.equal(r.days, 0);
});

// 브라이어 점수: 종합 확률 점수 하나 — mean((말한 확률 − 실제)²).
// 0 = 완벽, 늘 반반(50%)으로 찍으면 0.25가 나오는 게 기준선.
import { brierScore } from '../js/stats.js';

test('brierScore: perfect calls score 0, coin-flip guessing scores 0.25', () => {
  const perfect = [
    { p: 1, wet: true },
    { p: 0, wet: false },
  ];
  assert.equal(brierScore(perfect).score, 0);
  const coin = [
    { p: 0.5, wet: true },
    { p: 0.5, wet: false },
  ];
  assert.ok(Math.abs(brierScore(coin).score - 0.25) < 1e-9);
});

test('brierScore: confident-and-wrong is punished harder than humble-and-wrong', () => {
  const humble = brierScore([{ p: 0.3, wet: true }]).score; // (0.3-1)² = 0.49
  const cocky = brierScore([{ p: 0.05, wet: true }]).score; // (0.05-1)² ≈ 0.9
  assert.ok(cocky > humble);
  assert.ok(Math.abs(humble - 0.49) < 1e-9);
});

test('brierScore: empty or invalid entries return null, not NaN', () => {
  assert.equal(brierScore([]), null);
  assert.equal(brierScore([{ p: null, wet: true }]), null);
});

// 기관별 적중 — 같은 날을 기관(모델)별로 따로 채점해 순위를 매긴다.
// 각 기관의 우세 시나리오가 실제와 맞은 시간 비율(hitRate)이 1차,
// 실제에 준 평균 확률(meanProb)이 동률 판정 기준.
import { modelDayScores, perModelDistributions } from '../js/stats.js';

const mHour = (time, models) => ({ time, models });
const frac4 = (dry, light, mod, heavy) => ({ fraction: { dry, light, mod, heavy }, n: 10 });

test('modelDayScores: scores each agency separately and ranks by hit rate', () => {
  const hours = [
    mHour('2026-07-20T10:00', { a: frac4(0.9, 0.1, 0, 0), b: frac4(0.2, 0.8, 0, 0) }), // actual dry
    mHour('2026-07-20T11:00', { a: frac4(0.8, 0.2, 0, 0), b: frac4(0.3, 0.6, 0.1, 0) }), // actual light
  ];
  const actuals = new Map([
    ['2026-07-20T10:00', 0],
    ['2026-07-20T11:00', 0.5],
  ]);
  const s = modelDayScores(hours, actuals, PRECIP_BUCKETS);
  assert.equal(s.length, 2);
  assert.equal(s[0].n, 2);
  // a: dry hit(0.9→dry 맞음), light miss → hits 1, meanProb (0.9+0.2)/2=0.55
  // b: dry miss, light hit → hits 1, meanProb (0.2+0.6)/2=0.4 → a가 위여야 함
  const a = s.find((x) => x.model === 'a');
  const b = s.find((x) => x.model === 'b');
  assert.equal(a.hits, 1);
  assert.equal(b.hits, 1);
  assert.ok(Math.abs(a.meanProb - 0.55) < 1e-9);
  assert.equal(s[0].model, 'a'); // 동률 적중이면 실제에 더 후한 확률을 준 쪽이 위
});

test('modelDayScores: hours without actuals or model data are skipped, empty input → []', () => {
  const hours = [
    mHour('2026-07-20T10:00', { a: frac4(1, 0, 0, 0) }), // no actual
    { time: '2026-07-20T11:00' }, // no models
  ];
  assert.deepEqual(modelDayScores(hours, new Map([['2026-07-20T11:00', 0]]), PRECIP_BUCKETS), []);
});

test('perModelDistributions: buckets each agency\'s own members; empty agencies dropped', () => {
  const d = perModelDistributions({ ec: [0, 0.5, 2.0], gfs: [0, 0], empty: [null, NaN] }, PRECIP_BUCKETS);
  assert.ok(Math.abs(d.ec.fraction.dry - 1 / 3) < 1e-9);
  assert.equal(d.ec.n, 3);
  assert.equal(d.gfs.fraction.dry, 1);
  assert.equal(d.empty, undefined);
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
