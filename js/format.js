// Presentation helpers: number/time/date formatting. Pure functions only.

export const pct = (frac) => `${Math.round(frac * 100)}%`;

export const mm = (v) => (v == null ? '–' : `${v.toFixed(1)}mm`);
export const ms = (v) => (v == null ? '–' : `${v.toFixed(1)}`);
export const deg = (v) => (v == null ? '–' : `${Math.round(v)}°`);

// Hour-of-day (0–23) from a local ISO string like "2026-07-08T15:00".
export const hourOf = (iso) => Number(iso.slice(11, 13));
export const dateOf = (iso) => iso.slice(0, 10);

export const hourLabel = (iso) => `${hourOf(iso)}시`;

// Shift a plain YYYY-MM-DD by whole days using local date parts
// (toISOString would shift by the UTC offset).
export function addDays(dateStr, delta) {
  const d = new Date(`${dateStr}T00:00`);
  d.setDate(d.getDate() + delta);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// "어제"/"오늘"/"내일" relative to a reference ISO date (the first hour shown).
export function dayLabel(iso, todayDate) {
  const d = dateOf(iso);
  if (d === todayDate) return '오늘';
  if (d === addDays(todayDate, 1)) return '내일';
  if (d === addDays(todayDate, -1)) return '어제';
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}

