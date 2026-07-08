import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleBet } from '../js/bets.js';
import { PRECIP_BUCKETS } from '../js/config.js';

const bet = (betKey, dist) => ({
  region: '수원시 권선구',
  time: '2026-07-08T15:00',
  betKey,
  betProb: dist[betKey],
  dist,
});
const DIST = { dry: 0.42, light: 0.5, mod: 0.08, heavy: 0 };

test('settleBet: pick matches what fell → won', () => {
  const r = settleBet(bet('light', DIST), 0.4, PRECIP_BUCKETS); // 0.4mm = light
  assert.equal(r.actualKey, 'light');
  assert.equal(r.won, true);
  assert.equal(r.underdog, false); // light had 50%, not an underdog
});

test('settleBet: pick misses → lost, and names what actually won', () => {
  const r = settleBet(bet('dry', DIST), 0.4, PRECIP_BUCKETS);
  assert.equal(r.actualKey, 'light');
  assert.equal(r.won, false);
  assert.equal(r.betKey, 'dry');
});

test('settleBet: a low-probability outcome winning is flagged as underdog', () => {
  const r = settleBet(bet('dry', DIST), 2.5, PRECIP_BUCKETS); // 2.5mm = mod (8% prob)
  assert.equal(r.actualKey, 'mod');
  assert.equal(r.actualProb, 0.08);
  assert.equal(r.underdog, true);
  assert.equal(r.won, false);
});

test('settleBet: dry actual (no rain) resolves correctly', () => {
  const r = settleBet(bet('light', DIST), 0, PRECIP_BUCKETS);
  assert.equal(r.actualKey, 'dry');
  assert.equal(r.actualProb, 0.42);
  assert.equal(r.won, false);
});

test('settleBet: betting on the underdog and winning', () => {
  const r = settleBet(bet('mod', DIST), 2.5, PRECIP_BUCKETS);
  assert.equal(r.won, true);
  assert.equal(r.underdog, true); // you called the 8% and it hit
});
