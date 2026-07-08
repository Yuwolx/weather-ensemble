// Rendering layer: given already-computed data, build the DOM. No fetching, no
// statistics — those live in api.js / stats.js. Keeping render pure-ish makes the
// UI easy to reason about: same inputs → same markup.

import { PRECIP_BUCKETS } from './config.js';
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

// The live "right now" readout in the rail: current rain %, current temp/wind,
// the plain-language read, and a small trust line. Verdict tone drives the accent.
export function renderHero(refs, { region, updated, nowPctNum, tone, meta, line, trust }) {
  document.documentElement.style.setProperty('--tone', TONE_VAR[tone]);
  refs.region.textContent = region;
  refs.updated.textContent = updated;
  refs.now.textContent = nowPctNum;
  refs.meta.textContent = meta;
  refs.line.textContent = line;
  refs.trust.textContent = trust;
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

  // time axis — label every 3 hours, mark the day boundary
  refs.times.replaceChildren(
    ...analyzed.map((a, i) => {
      const h = hourOf(a.time);
      const isNewDay = i === 0 || dateOf(a.time) !== dateOf(analyzed[i - 1].time);
      let txt = '';
      if (isNewDay) txt = dayLabel(a.time, todayDate);
      else if (h % 3 === 0) txt = `${h}`;
      return el('span', { class: isNewDay ? 'tick--day' : '', text: txt });
    }),
  );
}

// Temperature band synced to the precip strip: one vertical bar per hour spanning
// p10–p90 with a median tick, scaled to the day's range. Bar length = model spread.
export function renderTempRow(refs, { hours, selectedIndex }) {
  const p10s = hours.map((h) => h.temp.p10).filter((v) => v != null);
  const p90s = hours.map((h) => h.temp.p90).filter((v) => v != null);
  if (!p10s.length) {
    refs.axis.replaceChildren();
    refs.row.replaceChildren();
    return;
  }
  const pad = 1.5;
  const lo = Math.min(...p10s) - pad;
  const hi = Math.max(...p90s) + pad;
  const span = hi - lo || 1;
  const map = (v) => ((v - lo) / span) * 100;

  refs.axis.replaceChildren(
    el('span', { style: 'top:6%', text: `${Math.round(hi)}°` }),
    el('span', { style: 'top:94%', text: `${Math.round(lo)}°` }),
  );

  refs.row.replaceChildren(
    ...hours.map((a, i) => {
      const t = a.temp;
      const col = el('div', { class: `temp-col${i === selectedIndex ? ' is-sel' : ''}`, 'data-i': String(i) });
      if (t.p10 != null && t.p90 != null) {
        col.appendChild(
          el('div', {
            class: 'temp-col__bar',
            style: `bottom:${map(t.p10)}%;height:${Math.max(map(t.p90) - map(t.p10), 2)}%`,
          }),
        );
        if (t.median != null) {
          col.appendChild(el('div', { class: 'temp-col__med', style: `bottom:${map(t.median)}%` }));
        }
      }
      return col;
    }),
  );
}

function readout(label, value, sub) {
  return el('div', { class: 'ro' }, [
    el('div', { class: 'ro__label', text: label }),
    el('div', { class: 'ro__val num', text: value }),
    sub ? el('div', { class: 'ro__sub', text: sub }) : null,
  ]);
}

export function renderDetail(container, { analyzedHour, memberCount, modelCount, todayDate }) {
  const a = analyzedHour;
  const scenarios = PRECIP_BUCKETS.map((b) => {
    const frac = a.dist.fraction[b.key];
    return el('div', { class: 'scen' }, [
      el('div', { class: 'scen__label', text: b.label }),
      el('div', { class: 'scen__track' }, [
        el('div', {
          class: 'scen__fill',
          style: `width:${frac * 100}%;background:var(--p-${b.key})`,
        }),
      ]),
      el('div', { class: 'scen__pct', text: pct(frac) }),
    ]);
  });

  const wet = a.rain.wet ?? Math.round(a.rain.probability * a.dist.n);
  const w = a.wind;
  const t = a.temp;
  const amt = a.amount;
  const amountSub =
    amt.p50 > 0 ? `많으면 ${mm(amt.p90)}` : amt.p90 > 0 ? `많으면 ${mm(amt.p90)}` : '멤버 대부분 0mm';

  container.replaceChildren(
    el('div', { class: 'detail__grid' }, [
      el('div', {}, [
        el('div', { class: 'detail__when' }, [
          el('h3', { text: `${dayLabel(a.time, todayDate)} ${hourLabel(a.time)}` }),
          el('span', { class: 'detail__count', text: `${a.dist.n}개 예보 중 ${wet}개가 비` }),
        ]),
        el('div', { class: 'detail__prob num', text: pct(a.rain.probability) }),
        el('div', { class: 'detail__problabel', text: '이 시각 비 올 확률 (멤버 합의)' }),
        ...scenarios,
      ]),
      el('div', { class: 'detail__side' }, [
        readout('기온', deg(t.median), t.p10 != null ? `범위 ${deg(t.p10)}–${deg(t.p90)}` : null),
        readout(
          '예상 강수량',
          amt.p50 > 0 ? mm(amt.p50) : '0mm',
          amountSub,
        ),
        readout('바람', `${ms(w.median)} m/s`, w.p10 != null ? `${ms(w.p10)}–${ms(w.p90)} · 최대 ${ms(w.max)}` : null),
        el('p', {
          class: 'detail__note',
          text: `${memberCount}개 멤버 · ${modelCount}개 기관 앙상블`,
        }),
      ]),
    ]),
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
