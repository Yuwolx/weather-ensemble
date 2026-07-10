// Rendering layer: given already-computed data, build the DOM. No fetching, no
// statistics — those live in api.js / stats.js. Keeping render pure-ish makes the
// UI easy to reason about: same inputs → same markup.

import { PRECIP_BUCKETS } from './config.js';
import { agreement } from './stats.js';
import { pct, mm, ms, deg, hourOf, hourLabel, dayLabel, dateOf } from './format.js';

const SEG_ORDER = ['dry', 'light', 'mod', 'heavy']; // top → bottom in the column
const bucketOf = (key) => PRECIP_BUCKETS.find((b) => b.key === key);

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function renderFavorites(container, favs, activeName, onSelect) {
  container.replaceChildren(
    ...favs.map((f) =>
      el('button', {
        class: 'chip',
        type: 'button',
        'aria-pressed': String(f.name === activeName),
        text: f.name.replace(/^.*시 /, ''), // show 구/시 short form; full in title
        title: `${f.sido} ${f.name}`,
        onclick: () => onSelect(f),
      }),
    ),
  );
}

// Color key for the strip's stacked segments. Phones have no hover tooltip, so
// without this the four colors are unreadable to a first-time user.
export function renderLegend(container) {
  container.replaceChildren(
    ...PRECIP_BUCKETS.map((b) =>
      el('li', {}, [
        el('span', { class: 'swatch', style: `background:var(--p-${b.key})` }),
        b.label,
      ]),
    ),
  );
}

// Day tabs (오늘 / 내일) — the segmented control that makes the canvas operable.
export function renderDayTabs(container, { days, activeDate, todayDate, onSelect }) {
  container.replaceChildren(
    ...days.map((d) =>
      el('button', {
        class: 'daytab',
        type: 'button',
        role: 'tab',
        'aria-selected': String(d === activeDate),
        text: dayLabel(`${d}T00:00`, todayDate),
        onclick: () => onSelect(d),
      }),
    ),
  );
}

// The signature: one column per hour, stacked by precip probability. `nowTime`
// is the ISO of the current hour so we can mark it "지금" wherever it lands.
export function renderStrip(refs, { analyzed, todayDate, nowTime, selectedIndex, onSelect, onHover }) {
  // y-axis (probability scale)
  refs.axis.replaceChildren(
    ...[100, 75, 50, 25].map((v) =>
      el('span', { style: `top:${100 - v}%`, text: `${v}` }),
    ),
  );

  const cols = analyzed.map((a, i) => {
    const classes = ['col'];
    if (a.time === nowTime) classes.push('col--now');

    const stack = el('div', { class: 'col__stack', style: `animation-delay:${i * 22}ms` });
    for (const key of SEG_ORDER) {
      const frac = a.dist.fraction[key];
      if (frac <= 0) continue;
      stack.appendChild(
        el('div', { class: `col__seg col__seg--${key}`, style: `height:${frac * 100}%` }),
      );
    }

    return el('button', {
      class: classes.join(' '),
      type: 'button',
      'aria-pressed': String(i === selectedIndex),
      'aria-label': `${dayLabel(a.time, todayDate)} ${hourLabel(a.time)}, 비 확률 ${pct(a.rain.probability)}`,
      'data-i': String(i),
      onclick: () => onSelect(i),
      onmouseenter: (e) => onHover(i, e.currentTarget),
      onmouseleave: () => onHover(-1),
      onfocus: (e) => onHover(i, e.currentTarget),
      onblur: () => onHover(-1),
    }, stack);
  });
  refs.cols.replaceChildren(...cols);

  // time axis — a tick + hour under every other bar so each bar's time is traceable
  refs.times.replaceChildren(
    ...analyzed.map((a, i) => {
      const h = hourOf(a.time);
      const isNewDay = i === 0 || dateOf(a.time) !== dateOf(analyzed[i - 1].time);
      const labeled = isNewDay || h % 2 === 0;
      const cls = ['tick'];
      if (labeled) cls.push('tick--on');
      if (isNewDay) cls.push('tick--day');
      return el('span', { class: cls.join(' '), text: labeled ? (isNewDay ? `${h}시` : `${h}`) : '' });
    }),
  );
}

// The hero board: the selected hour's competing scenarios, each a big row you can
// tap to highlight. The leading scenario is emphasized but alternatives are never
// hidden — this is the protagonist, in place of a single collapsed probability.
export function renderBoard(container, { analyzedHour, todayDate, picked, onPick }) {
  const a = analyzedHour;
  const leadKey = agreement(a.dist).dominantKey;

  const rows = PRECIP_BUCKETS.map((b) => {
    const frac = a.dist.fraction[b.key];
    const isPicked = picked === b.key;
    const cls = ['scenario'];
    if (b.key === leadKey) cls.push('is-lead');
    if (isPicked) cls.push('is-picked');
    return el('button', {
      class: cls.join(' '),
      type: 'button',
      'aria-pressed': String(isPicked),
      onclick: () => onPick(b.key),
    }, [
      el('span', { class: 'scenario__label', text: b.label }),
      el('span', { class: 'scenario__track' }, [
        // 0% stays an honestly empty track; tiny-but-real fractions keep a sliver
        el('span', { class: 'scenario__fill', style: `width:${frac > 0 ? Math.max(frac * 100, 1.5) : 0}%;background:var(--p-${b.key})` }),
      ]),
      el('span', { class: 'scenario__pct num', text: pct(frac) }),
    ]);
  });

  const t = a.temp;
  const amt = a.amount;
  const w = a.wind;
  const tempTxt = t.p10 != null ? `${deg(t.median)} (${deg(t.p10)}–${deg(t.p90)})` : deg(t.median);
  const rainTxt = amt.p50 > 0 ? mm(amt.p50) : amt.p90 > 0 ? `0mm (많으면 ${mm(amt.p90)})` : '0mm';

  container.replaceChildren(
    el('div', { class: 'board__head' }, [
      el('h2', { class: 'board__when', text: `${dayLabel(a.time, todayDate)} ${hourLabel(a.time)}` }),
      el('span', { class: 'board__sub', text: `${a.dist.n}개 예보` }),
    ]),
    el('div', { class: 'board__scenarios' }, rows),
    el('p', {
      class: 'board__cond',
      text: `기온 ${tempTxt}  ·  강수 ${rainTxt}  ·  바람 ${ms(w.median)} m/s`,
    }),
  );
}

let tooltipEl = null;
export function showTooltip(analyzedHour, anchor, todayDate) {
  if (!tooltipEl) {
    tooltipEl = el('div', { class: 'tooltip' });
    document.body.appendChild(tooltipEl);
  }
  const a = analyzedHour;
  tooltipEl.replaceChildren(
    el('div', { class: 'tooltip__t', text: `${dayLabel(a.time, todayDate)} ${hourLabel(a.time)}` }),
    ...PRECIP_BUCKETS.filter((b) => a.dist.fraction[b.key] > 0).map((b) =>
      el('div', { class: 'tooltip__row' }, [
        el('span', {}, bucketOf(b.key).label),
        el('span', { class: 'num', text: pct(a.dist.fraction[b.key]) }),
      ]),
    ),
  );
  tooltipEl.style.display = 'block';
  const r = anchor.getBoundingClientRect();
  const tw = tooltipEl.offsetWidth;
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  const top = r.top - tooltipEl.offsetHeight - 10;
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top < 8 ? r.bottom + 10 : top}px`;
}
export function hideTooltip() {
  if (tooltipEl) tooltipEl.style.display = 'none';
}

// 돌아보기 — three quiet ledger lines: what actually fell yesterday (always),
// what the odds said then (if this device saw them), and how the user's own
// hunches scored. Information only: an upset reads "작은 확률이 이겼다",
// never "예보가 틀렸다".
export function renderRetro(container, data) {
  const head = el('p', { class: 'eyebrow', text: '돌아보기' });
  if (!data) {
    container.replaceChildren(
      head,
      el('p', {
        class: 'retro__empty',
        text: '오늘 본 경우의 수를 이 기기가 기억해 뒀다가, 내일 실제 날씨와 대조해 보여드립니다. 시나리오를 골라 두면 당신의 예감도 함께 채점됩니다.',
      }),
    );
    return;
  }
  const { todayDate, actual, forecast, settled, record } = data;
  const parts = [head];

  // (1) 어제 실제
  parts.push(
    el('p', { class: 'retro__line' }, [
      el('strong', { text: '어제 실제' }),
      actual.rained
        ? ` — ${hourLabel(actual.peakTime)}에 가장 세게(${actual.peakMm.toFixed(1)}mm), 하루 ${actual.totalMm.toFixed(1)}mm.`
        : ' — 비는 오지 않았습니다.',
    ]),
  );

  // (2) 그때의 경우의 수 (스냅샷이 있을 때)
  if (forecast) {
    const { time, fraction, verdict } = forecast;
    const segs = PRECIP_BUCKETS.filter((b) => fraction[b.key] > 0).map((b) =>
      el('span', { class: 'retro__seg', style: `width:${fraction[b.key] * 100}%;background:var(--p-${b.key})` }),
    );
    let acc = 0;
    let center = 0;
    for (const b of PRECIP_BUCKETS) {
      const w = fraction[b.key];
      if (b.key === verdict.actualKey) {
        center = (acc + w / 2) * 100;
        break;
      }
      acc += w;
    }
    const actualLabel = bucketOf(verdict.actualKey).label;
    const probTxt = pct(verdict.prob);
    const phrase = verdict.hit
      ? `그때의 우세가 그대로 맞았습니다 (${probTxt}).`
      : verdict.prob < 0.005
        ? '그때 화면엔 아예 없던 경우였습니다 — 그런 날도 있습니다.'
        : verdict.prob <= 0.25
          ? `그때 화면에선 ${probTxt}뿐이었죠 — 작은 확률이 이겼습니다.`
          : `${probTxt}였던 '${actualLabel}'이 우세를 제쳤습니다.`;
    parts.push(
      el('p', { class: 'retro__line' }, [
        el('strong', { text: `${dayLabel(time, todayDate)} ${hourLabel(time)}` }),
        ` '${actualLabel}' — ${phrase}`,
      ]),
      el('div', { class: 'retro__bar' }, [
        el('span', { class: 'retro__segs' }, segs),
        el('span', { class: 'retro__mark', style: `left:${center}%` }),
      ]),
    );
  } else {
    parts.push(
      el('p', { class: 'retro__empty', text: '오늘 본 경우의 수는 기억해 뒀다가 내일 대조해 드립니다.' }),
    );
  }

  // (3) 당신의 예감 — settled hunches + running hit rate
  if (settled.length || record.length) {
    const lines = settled.slice(0, 3).map((s) =>
      el('p', { class: 'retro__hunch' }, [
        `${hourLabel(s.time)} 예감 '${bucketOf(s.picked).label}' → 실제 '${bucketOf(s.actual).label}' `,
        el('strong', { class: s.hit ? 'is-hit' : 'is-miss', text: s.hit ? '적중' : '빗나감' }),
      ]),
    );
    const hits = record.filter((r) => r.hit).length;
    parts.push(
      el('div', { class: 'retro__hunches' }, [
        el('p', { class: 'retro__line' }, [el('strong', { text: '당신의 예감' })]),
        ...lines,
        record.length
          ? el('p', { class: 'retro__tally', text: `통산 ${hits}/${record.length} 적중 (${Math.round((hits / record.length) * 100)}%)` })
          : null,
      ]),
    );
  }

  parts.push(el('p', { class: 'retro__sub', text: '실측은 재분석 기반 근사값 · 기록은 이 기기에만 저장됩니다' }));
  container.replaceChildren(...parts);
}

// Search suggestions dropdown.
export function renderSuggestions(listEl, matches, onPick) {
  if (!matches.length) {
    listEl.replaceChildren(el('li', { class: 'suggest__empty', text: '검색 결과가 없습니다.' }));
    listEl.hidden = false;
    return;
  }
  listEl.replaceChildren(
    ...matches.map((m, i) =>
      el('li', {
        class: 'suggest__item',
        role: 'option',
        id: `sg-${i}`,
        'aria-selected': 'false',
        onmousedown: (e) => {
          e.preventDefault();
          onPick(m);
        },
      }, [
        el('span', { text: m.name }),
        el('span', { class: 'suggest__sido', text: m.sido }),
      ]),
    ),
  );
  listEl.hidden = false;
}
