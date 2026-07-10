// Orchestration: owns app state, wires events, drives fetch → analyze → render.
// Business logic lives in stats.js; rendering in ui.js; this file connects them.

import { REGIONS } from './regions.js';
import { FAVORITES, PRECIP_BUCKETS, RAIN_THRESHOLD_MM, MOOD_THRESHOLDS } from './config.js';
import { loadEnsemble, getCurrentPosition, nearestRegion } from './api.js';
import { analyzeHour, dayMood } from './stats.js';
import { dateOf } from './format.js';
import * as ui from './ui.js';

const state = {
  region: null,
  all: [], // all future analyzed hours (today + tomorrow)
  byDay: new Map(), // date → analyzed hours
  days: [], // ['2026-07-08', '2026-07-09']
  activeDay: null,
  hours: [], // byDay.get(activeDay)
  selected: 0, // index within `hours`
  picked: null, // an ephemeral scenario highlight for the selected hour (no storage)
  meta: null,
  todayDate: null,
  nowTime: null,
};

const $ = (id) => document.getElementById(id);
const refs = {
  overlay: $('overlay'), overlayMsg: $('overlayMsg'), spinner: $('spinner'), retry: $('retryBtn'),
  region: $('vRegion'),
  board: $('board'),
  strip: { axis: $('stripAxisY'), cols: $('stripCols'), times: $('stripTimes') },
  dayTabs: $('dayTabs'),
  favs: $('favs'),
  search: $('searchInput'),
  suggest: $('suggest'),
  geo: $('geoBtn'),
  tableToggle: $('tableToggle'),
  tableWrap: $('tableWrap'),
};

// ---- overlay ---------------------------------------------------------------
function showLoading(msg) {
  refs.overlayMsg.textContent = msg || '앙상블 예보를 불러오는 중…';
  refs.spinner.hidden = false;
  refs.retry.hidden = true;
  refs.overlay.hidden = false;
}
function showError(msg, onRetry) {
  refs.overlayMsg.textContent = msg;
  refs.spinner.hidden = true;
  refs.retry.hidden = false;
  refs.retry.onclick = onRetry;
  refs.overlay.hidden = false;
}
const hideOverlay = () => (refs.overlay.hidden = true);

// region-local current hour key (correct regardless of the viewer's timezone)
function regionNowKey(utcOffsetSeconds) {
  const d = new Date(Date.now() + utcOffsetSeconds * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  return { date, key: `${date}T${p(d.getUTCHours())}` };
}

const peakIndex = (hours) =>
  hours.reduce((best, a, i) => (a.rain.probability > hours[best].rain.probability ? i : best), 0);

// ---- load a region ---------------------------------------------------------
async function selectRegion(region) {
  state.region = region;
  syncFavPressed();
  showLoading(`${region.name} 앙상블 불러오는 중…`);
  try {
    const data = await loadEnsemble(region.lat, region.lon);
    const { date, key } = regionNowKey(data.utcOffsetSeconds);
    const all = data.hours
      .filter((h) => h.time.slice(0, 13) >= key)
      .map((h) => analyzeHour(h, PRECIP_BUCKETS, RAIN_THRESHOLD_MM));
    if (!all.length) throw new Error('표시할 예보 시간이 없습니다.');

    const byDay = new Map();
    for (const a of all) {
      const d = dateOf(a.time);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(a);
    }

    state.all = all;
    state.byDay = byDay;
    state.days = [...byDay.keys()];
    state.todayDate = date;
    state.nowTime = all[0].time;
    state.meta = { memberCount: data.memberCount, modelCount: data.modelCount };
    setActiveDay(state.days[0], false);

    renderRegion();
    renderCanvas();
    hideOverlay();
  } catch (err) {
    showError(err.message || '예보를 불러오지 못했습니다.', () => selectRegion(region));
  }
}

function setActiveDay(date, rerender = true) {
  state.activeDay = date;
  state.hours = state.byDay.get(date);
  state.selected = peakIndex(state.hours);
  state.picked = null;
  // the active day's mood tints the whole screen's air (sky wash in CSS)
  document.documentElement.dataset.mood = dayMood(state.hours, MOOD_THRESHOLDS);
  if (rerender) renderCanvas();
}

// ---- render ----------------------------------------------------------------
function renderRegion() {
  refs.region.textContent = `${state.region.sido ? state.region.sido + ' ' : ''}${state.region.name}`;
}

function renderCanvas() {
  ui.renderDayTabs(refs.dayTabs, {
    days: state.days,
    activeDate: state.activeDay,
    todayDate: state.todayDate,
    onSelect: (d) => setActiveDay(d),
  });
  ui.renderStrip(refs.strip, {
    analyzed: state.hours,
    todayDate: state.todayDate,
    nowTime: state.nowTime,
    selectedIndex: state.selected,
    onSelect: selectHour,
    onHover: (i, anchor) => {
      if (i < 0) ui.hideTooltip();
      else ui.showTooltip(state.hours[i], anchor, state.todayDate);
    },
  });
  renderBoard();
  if (refs.tableToggle.getAttribute('aria-expanded') === 'true') {
    ui.renderTable(refs.tableWrap, { analyzed: state.hours, todayDate: state.todayDate });
  }
}

function renderBoard() {
  ui.renderBoard(refs.board, {
    analyzedHour: state.hours[state.selected],
    todayDate: state.todayDate,
    picked: state.picked,
    onPick: pickScenario,
  });
}

// Tap a scenario to highlight it (toggle). Ephemeral — just a focus, no storage.
function pickScenario(key) {
  state.picked = state.picked === key ? null : key;
  renderBoard();
}

function selectHour(i) {
  state.selected = i;
  state.picked = null; // a new hour clears the highlight
  refs.strip.cols.querySelectorAll('.col').forEach((c) => {
    c.setAttribute('aria-pressed', String(Number(c.dataset.i) === i));
  });
  renderBoard();
}

// ---- favorites -------------------------------------------------------------
function syncFavPressed() {
  refs.favs.querySelectorAll('.chip').forEach((c) => {
    c.setAttribute('aria-pressed', String(c.title.endsWith(state.region?.name)));
  });
}

// ---- search ----------------------------------------------------------------
const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
function searchRegions(q) {
  const nq = norm(q);
  if (!nq) return [];
  const pool = [...FAVORITES, ...REGIONS];
  const seen = new Set();
  const out = [];
  for (const r of pool) {
    const key = `${r.sido}/${r.name}`;
    if (seen.has(key)) continue;
    if (norm(r.name).includes(nq) || norm(`${r.sido}${r.name}`).includes(nq)) {
      seen.add(key);
      out.push(r);
    }
    if (out.length >= 8) break;
  }
  return out;
}

let activeSuggest = -1;
function openSuggest(matches) {
  activeSuggest = -1;
  refs.search.setAttribute('aria-expanded', 'true');
  ui.renderSuggestions(refs.suggest, matches, pickRegion);
}
function closeSuggest() {
  refs.suggest.hidden = true;
  refs.search.setAttribute('aria-expanded', 'false');
  activeSuggest = -1;
}
function pickRegion(r) {
  refs.search.value = '';
  closeSuggest();
  selectRegion(r);
}

refs.search.addEventListener('input', (e) => {
  const m = searchRegions(e.target.value);
  if (m.length || e.target.value) openSuggest(m);
  else closeSuggest();
});
refs.search.addEventListener('keydown', (e) => {
  const items = [...refs.suggest.querySelectorAll('.suggest__item')];
  if (e.key === 'ArrowDown' && items.length) {
    e.preventDefault();
    activeSuggest = Math.min(activeSuggest + 1, items.length - 1);
  } else if (e.key === 'ArrowUp' && items.length) {
    e.preventDefault();
    activeSuggest = Math.max(activeSuggest - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const matches = searchRegions(refs.search.value);
    if (matches[Math.max(activeSuggest, 0)]) pickRegion(matches[Math.max(activeSuggest, 0)]);
    return;
  } else if (e.key === 'Escape') {
    closeSuggest();
    return;
  } else {
    return;
  }
  items.forEach((it, i) => it.setAttribute('aria-selected', String(i === activeSuggest)));
});
refs.search.addEventListener('blur', () => setTimeout(closeSuggest, 120));

// ---- geolocation -----------------------------------------------------------
refs.geo.addEventListener('click', async () => {
  showLoading('현재 위치를 확인하는 중…');
  try {
    const { lat, lon } = await getCurrentPosition();
    const near = nearestRegion(lat, lon, REGIONS);
    await selectRegion({ sido: near.sido, name: `${near.name} 근처`, lat, lon });
  } catch (err) {
    showError(err.message, hideOverlay);
  }
});

// ---- strip keyboard navigation --------------------------------------------
refs.strip.cols.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const delta = e.key === 'ArrowRight' ? 1 : -1;
  const next = Math.max(0, Math.min(state.hours.length - 1, state.selected + delta));
  selectHour(next);
  refs.strip.cols.querySelector(`.col[data-i="${next}"]`)?.focus();
});

// ---- table toggle ----------------------------------------------------------
refs.tableToggle.addEventListener('click', () => {
  const next = refs.tableToggle.getAttribute('aria-expanded') !== 'true';
  refs.tableToggle.setAttribute('aria-expanded', String(next));
  refs.tableToggle.textContent = next ? '표 접기' : '숫자를 표로 보기';
  refs.tableWrap.hidden = !next;
  if (next) ui.renderTable(refs.tableWrap, { analyzed: state.hours, todayDate: state.todayDate });
});

// ---- boot ------------------------------------------------------------------
ui.renderFavorites(refs.favs, FAVORITES, null, selectRegion);
ui.renderLegend($('legend'));
selectRegion(FAVORITES[0]); // 수원시 권선구
