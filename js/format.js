// Presentation helpers: number/time formatting and the plain-language verdict.
// The verdict has real branching logic (it's the sentence the whole app exists to
// say), so it lives here as a pure function and is unit-tested.

export const pct = (frac) => `${Math.round(frac * 100)}%`;

export const mm = (v) => (v == null ? '–' : `${v.toFixed(1)}mm`);
export const ms = (v) => (v == null ? '–' : `${v.toFixed(1)}`);

// Hour-of-day (0–23) from a local ISO string like "2026-07-08T15:00".
export const hourOf = (iso) => Number(iso.slice(11, 13));
export const dateOf = (iso) => iso.slice(0, 10);

export const hourLabel = (iso) => `${hourOf(iso)}시`;

// "오늘"/"내일"/"모레" relative to a reference ISO date (the first hour shown).
export function dayLabel(iso, todayDate) {
  const d = dateOf(iso);
  if (d === todayDate) return '오늘';
  // Add one day using local date parts (toISOString would shift by the UTC offset).
  const next = new Date(`${todayDate}T00:00`);
  next.setDate(next.getDate() + 1);
  const p = (n) => String(n).padStart(2, '0');
  const nextStr = `${next.getFullYear()}-${p(next.getMonth() + 1)}-${p(next.getDate())}`;
  if (d === nextStr) return '내일';
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}

export function timeOfDay(h) {
  if (h <= 5) return '새벽';
  if (h <= 11) return '오전';
  if (h <= 17) return '오후';
  if (h <= 21) return '저녁';
  return '밤';
}

// The headline read over a window of analyzed hours (typically the next 24h).
// Returns { line, tone } where tone ∈ 'dry' | 'maybe' | 'wet' drives accent color.
export function verdict(analyzed) {
  if (!analyzed.length) return { line: '데이터가 없습니다.', tone: 'dry' };

  let peak = analyzed[0];
  for (const a of analyzed) if (a.rain.probability > peak.rain.probability) peak = a;
  const maxProb = peak.rain.probability;
  const rainyCount = analyzed.filter((a) => a.rain.probability >= 0.5).length;

  // Confidence clause from how tightly the models agree at the peak hour.
  const share = peak.agree.share;
  let conf;
  if (share >= 0.7) conf = '모델들 의견이 대체로 일치합니다.';
  else if (share >= 0.45) conf = '모델 의견이 다소 갈립니다.';
  else conf = '모델 의견이 크게 엇갈립니다.';

  if (maxProb < 0.15) {
    return { line: '앞으로 24시간, 비 올 확률은 희박합니다.', tone: 'dry' };
  }
  if (maxProb < 0.5) {
    return {
      line: `가장 높을 때도 비 확률 ${pct(maxProb)}. 우산은 애매합니다. ${conf}`,
      tone: 'maybe',
    };
  }
  const when = timeOfDay(hourOf(peak.time));
  return {
    line: `${when} 비 확률이 ${pct(maxProb)}로 가장 높고, 24시간 중 ${rainyCount}시간 비가 가능합니다. ${conf}`,
    tone: 'wet',
  };
}
