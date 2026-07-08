import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, dayLabel, timeOfDay, hourOf } from '../js/format.js';

// Build a minimal analyzed-hour with a given rain probability + agreement share.
const H = (iso, prob, share = 0.8, dom = 'light') => ({
  time: iso,
  rain: { probability: prob, n: 100 },
  agree: { dominantKey: dom, share },
});

test('verdict: dry when the peak probability is negligible', () => {
  const v = verdict([H('2026-07-08T09:00', 0.02), H('2026-07-08T10:00', 0.1)]);
  assert.equal(v.tone, 'dry');
  assert.match(v.line, /희박/);
});

test('verdict: maybe when peak is meaningful but under half', () => {
  const v = verdict([H('2026-07-08T14:00', 0.35)]);
  assert.equal(v.tone, 'maybe');
  assert.match(v.line, /35%/);
  assert.match(v.line, /애매/);
});

test('verdict: wet names the time of day, the peak %, and rainy-hour count', () => {
  const v = verdict([
    H('2026-07-08T09:00', 0.3),
    H('2026-07-08T15:00', 0.8), // peak, afternoon
    H('2026-07-08T16:00', 0.6),
  ]);
  assert.equal(v.tone, 'wet');
  assert.match(v.line, /오후/);
  assert.match(v.line, /80%/);
  assert.match(v.line, /2시간/); // two hours >= 0.5
});

test('verdict: confidence clause reflects agreement share', () => {
  const agree = verdict([H('2026-07-08T15:00', 0.8, 0.9)]);
  assert.match(agree.line, /일치/);
  const split = verdict([H('2026-07-08T15:00', 0.8, 0.3)]);
  assert.match(split.line, /엇갈/);
});

test('verdict: empty window is handled', () => {
  assert.equal(verdict([]).tone, 'dry');
});

test('dayLabel maps to 오늘/내일 and falls back to M/D', () => {
  assert.equal(dayLabel('2026-07-08T09:00', '2026-07-08'), '오늘');
  assert.equal(dayLabel('2026-07-09T09:00', '2026-07-08'), '내일');
  assert.equal(dayLabel('2026-07-10T09:00', '2026-07-08'), '7/10');
});

test('timeOfDay buckets the clock into Korean day-parts', () => {
  assert.equal(timeOfDay(3), '새벽');
  assert.equal(timeOfDay(9), '오전');
  assert.equal(timeOfDay(hourOf('2026-07-08T15:00')), '오후');
  assert.equal(timeOfDay(20), '저녁');
  assert.equal(timeOfDay(23), '밤');
});
