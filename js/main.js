// Orchestration: owns app state, wires events, drives fetch → analyze → render.
// Business logic lives in stats.js; rendering in ui.js; this file connects them.

import { REGIONS } from './regions.js';
import { FAVORITES, PRECIP_BUCKETS, RAIN_THRESHOLD_MM, MOOD_THRESHOLDS, CALIB_BIN_EDGES, ACTUALS_PAST_DAYS } from './config.js';
import { loadEnsemble, loadActuals, loadKma, getCurrentPosition, nearestRegion } from './api.js';
import { analyzeHour, dayMood, agreement, classifyPrecip, precipDistribution, perModelDistributions, modelDayScores, pickRetroHour, retroVerdict, summarizeActuals, settlePicks, forecastScore, calibrationEntries, calibrationReport, brierScore } from './stats.js';
import { createRain } from './rain.js';
import { saveDaySnapshots, getSnapshot, savePick, getPicks, appendRecord, getRecord, regionKeyOf, appendCalibration, hasSettledHistory } from './snapshots.js';
import { dateOf, addDays } from './format.js';
import * as ui from './ui.js';

const state = {
  region: null,
  all: [], // all future analyzed hours (today + tomorrow)
  byDay: new Map(), // date → analyzed hours
  days: [], // ['2026-07-08', '2026-07-09']
  activeDay: null,
  hours: [], // byDay.get(activeDay)
  selected: 0, // index within `hours`
  picked: null, // the selected hour's declared hunch (persisted via savePick)
  meta: null,
  todayDate: null,
  nowTime: null,
  yesterdayDists: [],
  kma: null, // Map time→mm from the 기상청 KIM model (marker on the board)
  retro: null, // 돌아보기 dashboard state: comparable days + day/hour selection
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
  retro: $('retro'),
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

    // yesterday's archived member forecasts ride in the same payload — kept as
    // per-hour distributions so 돌아보기 can show "어제의 예보" on any device
    const yDate = addDays(date, -1);
    state.yesterdayDists = data.hours
      .filter((h) => dateOf(h.time) === yDate)
      .map((h) => {
        const d = precipDistribution(h.precipMembers, PRECIP_BUCKETS);
        return { time: h.time, fraction: d.fraction, n: d.n, models: perModelDistributions(h.precipByModel, PRECIP_BUCKETS) };
      });

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
    // remember today's odds for tomorrow's 돌아보기, then settle yesterday's
    saveDaySnapshots(region, byDay, date);
    refreshRetro();

    // 기상청 모델 marker loads after first paint; absence is fine
    state.kma = null;
    loadKma(region.lat, region.lon)
      .then((map) => {
        if (state.region !== region) return;
        state.kma = map;
        renderBoard();
      })
      .catch(() => {});
  } catch (err) {
    showError(err.message || '예보를 불러오지 못했습니다.', () => selectRegion(region));
  }
}

function setActiveDay(date, rerender = true) {
  state.activeDay = date;
  state.hours = state.byDay.get(date);
  state.selected = peakIndex(state.hours);
  state.picked = restoredPick();
  // the active day's mood tints the whole screen's air (sky wash in CSS)
  document.documentElement.dataset.mood = dayMood(state.hours, MOOD_THRESHOLDS);
  if (rerender) renderCanvas();
}

// A hunch made earlier for the selected hour survives reloads and hour-hopping.
function restoredPick() {
  const a = state.hours[state.selected];
  return a ? getPicks(state.region, dateOf(a.time))[a.time] || null : null;
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
  syncRainArt();
}

// Media-art rain: if the selected hour's leading scenario is rain, it rains on
// screen — light rain falls thin and sparse, heavy rain dense and fast. Driven
// by the hour the user is looking at, so tapping across the strip plays weather.
const rainFx = createRain($('rain'));
function syncRainArt() {
  const a = state.hours[state.selected];
  const lead = a ? agreement(a.dist).dominantKey : null;
  const raining = lead === 'light' || lead === 'mod' || lead === 'heavy';
  if (raining) document.documentElement.dataset.rain = lead;
  else delete document.documentElement.dataset.rain;
  rainFx.set(raining ? lead : null);
}

function renderBoard() {
  const a = state.hours[state.selected];
  const kmaMm = state.kma?.get(a?.time);
  ui.renderBoard(refs.board, {
    analyzedHour: a,
    todayDate: state.todayDate,
    picked: state.picked,
    kmaKey: kmaMm != null ? classifyPrecip(kmaMm, PRECIP_BUCKETS) : null,
    onPick: pickScenario,
  });
}

// 돌아보기 — the app's other half, a dashboard not a footnote: every past day
// this device can compare (snapshot or archived forecast vs actuals) becomes a
// browsable page — day tabs, a tappable hour strip, and a per-hour detail board
// in the same grammar as today's forecast. Renders a baseline immediately,
// upgrades when actuals arrive.
async function refreshRetro() {
  const region = state.region;
  state.retro = null;
  // instant baseline: a true first visit gets the invitation; a device that has
  // settled before gets a quiet "대조 중" so the invitation doesn't flash
  ui.renderRetro(refs.retro, null, { pending: hasSettledHistory() });
  try {
    const actuals = await loadActuals(region.lat, region.lon);
    if (state.region !== region) return; // user moved on mid-fetch

    // comparable past days, newest first — yesterday may fall back to the
    // archived forecast riding in the main payload (콜드스타트); older days
    // need a snapshot this device saved back when they were still the future
    const days = [];
    for (let back = 1; back <= ACTUALS_PAST_DAYS; back++) {
      const date = addDays(state.todayDate, -back);
      const snap = getSnapshot(region, date);
      const predicted = snap
        ? { hours: snap.hours, source: 'snapshot' }
        : back === 1 && state.yesterdayDists.length
          ? { hours: state.yesterdayDists, source: 'api' }
          : null;
      if (!predicted?.hours?.length) continue;
      const dayActuals = new Map([...actuals].filter(([t]) => dateOf(t) === date));
      if (!dayActuals.size) continue;
      // per-agency hours for 기관별 적중: prefer whatever the predicted hours
      // carry; an old model-less snapshot of yesterday can still fall back to
      // the archived forecast, which always has the per-agency breakdown
      const modelHours = predicted.hours.some((h) => h.models)
        ? predicted.hours
        : back === 1 && state.yesterdayDists.some((h) => h.models)
          ? state.yesterdayDists
          : null;
      days.push({ date, predicted, modelHours, actuals: dayActuals, picks: getPicks(region, date) });
    }
    if (!days.length) return;

    // settle everything into the device ledgers (dedup makes re-visits no-ops)
    const calEntries = [];
    let record = null;
    for (const d of days) {
      calEntries.push(...calibrationEntries(d.predicted.hours, d.actuals, RAIN_THRESHOLD_MM));
      const settled = settlePicks(d.picks, d.actuals, PRECIP_BUCKETS);
      if (settled.length) record = appendRecord(regionKeyOf(region), settled);
    }
    const ledger = appendCalibration(regionKeyOf(region), calEntries);

    state.retro = {
      region,
      days,
      calib: { ...calibrationReport(ledger, CALIB_BIN_EDGES), brier: brierScore(ledger) },
      record: record || getRecord(),
      selDate: days[0].date,
      selHour: null, // null → the day's story hour, chosen at render
    };
    renderRetroSection();
  } catch {
    /* actuals unavailable — the baseline stays */
  }
}

function renderRetroSection() {
  const r = state.retro;
  if (!r || state.region !== r.region) return;
  const day = r.days.find((d) => d.date === r.selDate) || r.days[0];
  const story = pickRetroHour(day.predicted.hours, day.actuals);
  const selHour = r.selHour && day.actuals.has(r.selHour) ? r.selHour : (story?.time ?? null);
  const predByTime = new Map(day.predicted.hours.map((h) => [h.time, h]));

  const actualCells = [...day.actuals]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([time, mm]) => ({ time, mm, key: classifyPrecip(mm ?? 0, PRECIP_BUCKETS) }));

  let sel = null;
  if (selHour) {
    const mm = day.actuals.get(selHour);
    const pred = predByTime.get(selHour);
    sel = {
      time: selHour,
      mm,
      fraction: pred?.fraction || null,
      actualKey: classifyPrecip(mm ?? 0, PRECIP_BUCKETS),
      picked: day.picks[selHour] || null,
    };
  }

  ui.renderRetro(refs.retro, {
    todayDate: state.todayDate,
    date: day.date,
    days: r.days.map((d) => d.date),
    predicted: day.predicted,
    actual: summarizeActuals(day.actuals),
    score: forecastScore(day.predicted.hours, day.actuals, PRECIP_BUCKETS),
    forecast: story
      ? { time: story.time, mm: story.mm, verdict: retroVerdict(story.snap.fraction, story.mm, PRECIP_BUCKETS) }
      : null,
    actualCells,
    pickCells: Object.keys(day.picks).length
      ? actualCells.map(({ time }) => ({ time, picked: day.picks[time] || null }))
      : null,
    sel,
    modelScores: day.modelHours ? modelDayScores(day.modelHours, day.actuals, PRECIP_BUCKETS) : [],
    settled: settlePicks(day.picks, day.actuals, PRECIP_BUCKETS),
    record: r.record,
    calib: r.calib,
    onSelectDay: (date) => {
      r.selDate = date;
      r.selHour = null;
      renderRetroSection();
    },
    onSelectHour: (time) => {
      r.selHour = time;
      renderRetroSection();
    },
  });
}

// Tap a scenario = declare a hunch (toggle). Persisted per hour so tomorrow's
// 돌아보기 can score it — 사용자 요청으로 '저장 없음' 원칙을 개정(2026-07-10).
function pickScenario(key) {
  state.picked = state.picked === key ? null : key;
  const a = state.hours[state.selected];
  if (a) savePick(state.region, a.time, state.picked);
  renderBoard();
}

function selectHour(i) {
  state.selected = i;
  state.picked = restoredPick(); // each hour remembers its own hunch
  refs.strip.cols.querySelectorAll('.col').forEach((c) => {
    c.setAttribute('aria-pressed', String(Number(c.dataset.i) === i));
  });
  renderBoard();
  syncRainArt();
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

// retro strip keyboard navigation — same arrows as the main strip; the section
// re-renders on select, so focus is restored onto the newly built button
refs.retro.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const btn = e.target.closest?.('.retro__col');
  if (!btn || !state.retro) return;
  e.preventDefault();
  const cols = [...refs.retro.querySelectorAll('.retro__col')];
  const next = cols[cols.indexOf(btn) + (e.key === 'ArrowRight' ? 1 : -1)];
  if (!next) return;
  state.retro.selHour = next.dataset.time;
  renderRetroSection();
  refs.retro.querySelector(`.retro__col[data-time="${next.dataset.time}"]`)?.focus();
});

// ---- boot ------------------------------------------------------------------
ui.renderFavorites(refs.favs, FAVORITES, null, selectRegion);
ui.renderLegend($('legend'));
selectRegion(FAVORITES[0]); // 수원시 권선구
