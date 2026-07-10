import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayLabel, addDays } from '../js/format.js';

test('dayLabel maps to 어제/오늘/내일 and falls back to M/D', () => {
  assert.equal(dayLabel('2026-07-08T09:00', '2026-07-08'), '오늘');
  assert.equal(dayLabel('2026-07-09T09:00', '2026-07-08'), '내일');
  assert.equal(dayLabel('2026-07-07T09:00', '2026-07-08'), '어제');
  assert.equal(dayLabel('2026-07-10T09:00', '2026-07-08'), '7/10');
});

test('addDays shifts a plain date across month boundaries', () => {
  assert.equal(addDays('2026-07-01', -1), '2026-06-30');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
