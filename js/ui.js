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

const TONE_VAR = { dry: 'var(--tone-dry)', maybe: 'var(--tone-maybe)', wet: 'var(--tone-wet)' };

// The rail readout: the plain-language line + current conditions. No single
// headline number — the scenario board carries the probabilities. Tone drives accent.
export function renderHero(refs, { region, updated, tone, meta, line }) {
  document.documentElement.style.setProperty('--tone', TONE_VAR[tone]);
  refs.region.textContent = region;
  refs.updated.textContent = updated;
  refs.meta.textContent = meta;
  refs.line.textContent = line;
}

// One-line digest for the active day — the gist without reading the strip.
export function renderDigest(node, text) {
  node.textContent = text;
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

    const stack = el('div', { class: 'col__stack', style: `animation-delay:${i * 16}ms` });
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

// Temperature as a continuous band (p10–p90 area) with a median line, aligned to
// the precip strip's hour centers. A filled band reads fuller than sparse bars and
// makes the day's warm/cool arc legible in far less height.
export function renderTempArea(refs, { hours }) {
  const p10s = hours.map((h) => h.temp.p10).filter((v) => v != null);
  const p90s = hours.map((h) => h.temp.p90).filter((v) => v != null);
  if (!p10s.length) {
    refs.axis.replaceChildren();
    refs.row.innerHTML = '';
    return;
  }
  const pad = 1;
  const lo = Math.min(...p10s) - pad;
  const hi = Math.max(...p90s) + pad;
  const span = hi - lo || 1;
  const n = hours.length;
  const x = (i) => (((i + 0.5) / n) * 100).toFixed(2);
  const y = (v) => ((1 - (v - lo) / span) * 100).toFixed(2);

  const top = hours.map((a, i) => `${x(i)},${y(a.temp.p90)}`);
  const bottom = hours.map((a, i) => `${x(i)},${y(a.temp.p10)}`).reverse();
  const med = hours.map((a, i) => `${x(i)},${y(a.temp.median)}`).join(' ');

  refs.axis.replaceChildren(
    el('span', { style: 'top:8%', text: `${Math.round(hi)}°` }),
    el('span', { style: 'top:92%', text: `${Math.round(lo)}°` }),
  );
  refs.row.innerHTML =
    `<svg class="tempsvg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">` +
    `<polygon class="tempsvg__band" points="${[...top, ...bottom].join(' ')}"/>` +
    `<polyline class="tempsvg__line" points="${med}" fill="none" vector-effect="non-scaling-stroke"/>` +
    `</svg>`;
}

function readout(label, value, sub) {
  return el('div', { class: 'ro' }, [
    el('div', { class: 'ro__label', text: label }),
    el('div', { class: 'ro__val num', text: value }),
    sub ? el('div', { class: 'ro__sub', text: sub }) : null,
  ]);
}

// The hero board: the selected hour's competing scenarios, each a big tappable row
// (place your bet). Leading scenario emphasized; alternatives never hidden. This is
// the protagonist — no single collapsed probability.
export function renderBoard(container, { analyzedHour, todayDate, bet, onBet }) {
  const a = analyzedHour;
  const leadKey = agreement(a.dist).dominantKey;

  const rows = PRECIP_BUCKETS.map((b) => {
    const frac = a.dist.fraction[b.key];
    const picked = bet && bet.betKey === b.key;
    const cls = ['scenario'];
    if (b.key === leadKey) cls.push('is-lead');
    if (picked) cls.push('is-picked');
    return el('button', {
      class: cls.join(' '),
      type: 'button',
      'aria-pressed': String(!!picked),
      onclick: () => onBet(b.key, frac),
    }, [
      el('span', { class: 'scenario__label', text: b.label }),
      el('span', { class: 'scenario__track' }, [
        el('span', { class: 'scenario__fill', style: `width:${Math.max(frac * 100, 1.5)}%;background:var(--p-${b.key})` }),
      ]),
      el('span', { class: 'scenario__pct num', text: pct(frac) }),
      el('span', { class: 'scenario__pick', text: picked ? '내 선택' : '' }),
    ]);
  });

  const t = a.temp;
  const amt = a.amount;
  const w = a.wind;
  const wmax = Math.max(12, w.p90 ?? 0);
  const bandL = ((w.p10 ?? 0) / wmax) * 100;
  const bandW = (((w.p90 ?? 0) - (w.p10 ?? 0)) / wmax) * 100;
  const medL = ((w.median ?? 0) / wmax) * 100;

  const hint = bet
    ? el('p', { class: 'board__hint board__hint--set' },
        `선택함: ${labelOf(bet.betKey)} · 이 시각이 지나면 결과를 알려드립니다. (다시 누르면 취소)`)
    : el('p', { class: 'board__hint' }, '시나리오 하나를 눌러 두면, 지난 뒤 실제로 뭐가 왔는지 알려드립니다.');

  container.replaceChildren(
    el('div', { class: 'board__head' }, [
      el('h2', { class: 'board__when', text: `${dayLabel(a.time, todayDate)} ${hourLabel(a.time)}` }),
      el('span', { class: 'board__sub', text: `${a.dist.n}개 예보가 이렇게 갈립니다` }),
    ]),
    el('div', { class: 'board__scenarios' }, rows),
    hint,
    el('div', { class: 'board__cond' }, [
      readout('기온', deg(t.median), t.p10 != null ? `${deg(t.p10)}–${deg(t.p90)}` : null),
      readout('예상 강수량', amt.p50 > 0 ? mm(amt.p50) : '0mm', amt.p90 > 0 ? `많으면 ${mm(amt.p90)}` : '대부분 0mm'),
      el('div', { class: 'windblock' }, [
        el('div', { class: 'ro__label', text: '바람' }),
        el('div', {}, [
          el('span', { class: 'wind__val num', text: ms(w.median) }),
          el('span', { class: 'wind__unit', text: 'm/s' }),
        ]),
        el('div', { class: 'wind__range' }, [
          el('div', { class: 'wind__band', style: `left:${bandL}%;width:${Math.max(bandW, 1)}%` }),
          el('div', { class: 'wind__median', style: `left:calc(${medL}% - 1px)` }),
        ]),
      ]),
    ]),
  );
}

// Resolved past bets — the payoff. Shows what you picked, what actually fell, and
// celebrates when an underdog (a scenario the models doubted) came true.
export function renderSettled(container, settled, todayDate) {
  if (!settled.length) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }
  container.hidden = false;
  container.replaceChildren(
    el('p', { class: 'eyebrow', text: '지난 예측 결과' }),
    ...settled.map((s) => {
      const cls = ['settled__row'];
      if (s.won) cls.push('is-won');
      if (s.underdog) cls.push('is-underdog');
      let verdict;
      if (s.won && s.underdog) verdict = `적중 — 게다가 ${pct(s.betProb)}짜리를 맞혔습니다`;
      else if (s.won) verdict = '적중';
      else if (s.underdog) verdict = `${pct(s.actualProb)} ${labelOf(s.actualKey)}가 이겼습니다`;
      else verdict = `빗나감 — 실제는 ${labelOf(s.actualKey)}`;
      return el('div', { class: cls.join(' ') }, [
        el('span', { class: 'settled__when num', text: `${dayLabel(s.time, todayDate)} ${hourLabel(s.time)}` }),
        el('span', { class: 'settled__pick', text: `내 선택 ${labelOf(s.betKey)}` }),
        el('span', { class: 'settled__actual', text: `실제 ${labelOf(s.actualKey)} (${mm(s.actualMm)})` }),
        el('span', { class: 'settled__verdict', text: verdict }),
      ]);
    }),
  );
}

const labelOf = (key) => bucketOf(key)?.label ?? key;

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

// Accessibility / transparency: the same data as a plain table.
export function renderTable(container, { analyzed, todayDate }) {
  const head = el('tr', {}, [
    el('th', { text: '시각' }),
    el('th', { text: '비 확률' }),
    ...PRECIP_BUCKETS.map((b) => el('th', { text: b.label })),
    el('th', { text: '바람 med' }),
    el('th', { text: 'n' }),
  ]);
  const rows = analyzed.map((a) =>
    el('tr', {}, [
      el('td', { text: `${dayLabel(a.time, todayDate)} ${hourLabel(a.time)}` }),
      el('td', {}, [el('span', { class: 'num', text: pct(a.rain.probability) })]),
      ...PRECIP_BUCKETS.map((b) =>
        el('td', {}, [el('span', { class: 'num', text: pct(a.dist.fraction[b.key]) })]),
      ),
      el('td', {}, [el('span', { class: 'num', text: ms(a.wind.median) })]),
      el('td', {}, [el('span', { class: 'num', text: String(a.dist.n) })]),
    ]),
  );
  const table = el('table', { class: 'data' }, [
    el('thead', {}, head),
    el('tbody', {}, rows),
  ]);
  container.replaceChildren(table);
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
