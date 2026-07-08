// Orchestration: owns app state, wires events, drives fetch → analyze → render.
// Business logic lives in stats.js; rendering in ui.js; this file connects them.

import { REGIONS } from './regions.js';
import { FAVORITES, PRECIP_BUCKETS, RAIN_THRESHOLD_MM } from './config.js';
import { loadEnsemble, getCurrentPosition, nearestRegion } from './api.js';
import { analyzeHour } from './stats.js';
import { verdict, pct, dateOf } from './format.js';
import * as ui from './ui.js';

const WINDOW_HOURS = 24; // the strip + verdict horizon: "지금부터 24시간"

const state = {
  region: null, // { name, sido?, lat, lon }
  analyzed: [], // future hours only
  meta: null, // { memberCount, modelCount }
  todayDate: null,
  selected: 0,
};

const $ = (id) => document.getElementById(id);
const refs = {
  overlay: $('overlay'),
  overlayMsg: $('overlayMsg'),
  spinner: $('spinner'),
  retry: $('retryBtn'),
  verdict: {
    section: $('verdict'),
    region: $('vRegion'),
    updated: $('vUpdated'),
    line: $('vLine'),
    stats: $('vStats'),
  },
  strip: { axis: $('stripAxisY'), cols: $('stripCols'), times: $('stripTimes') },
  detail: $('detail'),
  legend: $('legend'),
  favs: $('favs'),
  search: $('searchInput'),
  suggest: $('suggest'),
  geo: $('geoBtn'),
  tableToggle: $('tableToggle'),
  tableWrap: $('tableWrap'),
};

// ---- overlay helpers -------------------------------------------------------
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
function hideOverlay() {
  refs.overlay.hidden = true;
}

// ---- region-local "now" ----------------------------------------------------
// The API returns local wall-clock times for the region; compute the region's
// current hour the same way so "지금" and the 24h window are correct regardless of
// the viewer's own timezone.
function regionNowKey(utcOffsetSeconds) {
  const d = new Date(Date.now() + utcOffsetSeconds * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  const key = `${date}T${p(d.getUTCHours())}`;
  return { date, key };
}

// ---- load + render a region ------------------------------------------------
async function selectRegion(region) {
  state.region = region;
  syncFavPressed();
  showLoading(`${region.name} 앙상블 불러오는 중…`);
  try {
    const data = await loadEnsemble(region.lat, region.lon);
    const { date, key } = regionNowKey(data.utcOffsetSeconds);
    const future = data.hours
      .filter((h) => h.time.slice(0, 13) >= key)
      .slice(0, WINDOW_HOURS)
      .map((h) => analyzeHour(h, PRECIP_BUCKETS, RAIN_THRESHOLD_MM));

    if (!future.length) throw new Error('표시할 예보 시간이 없습니다.');

    state.analyzed = future;
    state.meta = { memberCount: data.memberCount, modelCount: data.modelCount };
    state.todayDate = date;
    // default selection = the peak-rain hour (the most decision-relevant one)
    state.selected = future.reduce(
      (best, a, i) => (a.rain.probability > future[best].rain.probability ? i : best),
      0,
    );
    renderAll();
    hideOverlay();
  } catch (err) {
    showError(err.message || '예보를 불러오지 못했습니다.', () => selectRegion(region));
  }
}

function renderAll() {
  const { analyzed, todayDate, meta } = state;
  let peak = analyzed[0];
  for (const a of analyzed) if (a.rain.probability > peak.rain.probability) peak = a;
  const rainyCount = analyzed.filter((a) => a.rain.probability >= 0.5).length;

  ui.renderVerdict(refs.verdict, {
    region: `${state.region.sido ? state.region.sido + ' ' : ''}${state.region.name}`,
    updated: `갱신 ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`,
    verdict: verdict(analyzed),
    stats: [
      { val: pct(peak.rain.probability), label: '최대 비 확률 (다음 24시간)', accent: true },
      { val: `${rainyCount}시간`, label: '비 가능 시간 (확률 ≥ 50%)' },
      { val: String(meta.memberCount), label: `예보 멤버 · ${meta.modelCount}개 기관` },
    ],
  });

  ui.renderStrip(refs.strip, {
    analyzed,
    todayDate,
    selectedIndex: state.selected,
    onSelect: selectHour,
    onHover: (i, anchor) => {
      if (i < 0) ui.hideTooltip();
      else ui.showTooltip(analyzed[i], anchor, todayDate);
    },
  });

  renderDetail();

  if (refs.tableToggle.getAttribute('aria-expanded') === 'true') {
    ui.renderTable(refs.tableWrap, { analyzed, todayDate });
  }
}

function renderDetail() {
  ui.renderDetail(refs.detail, {
    analyzedHour: state.analyzed[state.selected],
    memberCount: state.meta.memberCount,
    modelCount: state.meta.modelCount,
    todayDate: state.todayDate,
  });
}

function selectHour(i) {
  state.selected = i;
  // update pressed state on columns without a full re-render
  refs.strip.cols.querySelectorAll('.col').forEach((c) => {
    c.setAttribute('aria-pressed', String(Number(c.dataset.i) === i));
  });
  renderDetail();
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
    showError(err.message, () => hideOverlay());
  }
});

// ---- strip keyboard navigation --------------------------------------------
refs.strip.cols.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const delta = e.key === 'ArrowRight' ? 1 : -1;
  const next = Math.max(0, Math.min(state.analyzed.length - 1, state.selected + delta));
  selectHour(next);
  const btn = refs.strip.cols.querySelector(`.col[data-i="${next}"]`);
  if (btn) btn.focus();
});

// ---- table toggle ----------------------------------------------------------
refs.tableToggle.addEventListener('click', () => {
  const open = refs.tableToggle.getAttribute('aria-expanded') === 'true';
  const next = !open;
  refs.tableToggle.setAttribute('aria-expanded', String(next));
  refs.tableToggle.textContent = next ? '표 접기' : '표로 보기';
  refs.tableWrap.hidden = !next;
  if (next) ui.renderTable(refs.tableWrap, { analyzed: state.analyzed, todayDate: state.todayDate });
});

// ---- boot ------------------------------------------------------------------
ui.renderLegend(refs.legend);
ui.renderFavorites(refs.favs, FAVORITES, null, selectRegion);
selectRegion(FAVORITES[0]); // 수원시 권선구
