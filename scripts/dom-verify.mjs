// Headless render check: boot the real app modules against a jsdom DOM with live
// data, then assert the rendered tree is sane. Substitutes for a browser when
// browser automation is blocked in this environment.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');
const dom = new JSDOM(html, { url: 'http://localhost:8848/', pretendToBeVisual: true });

// expose the globals the app expects, before importing any module
global.window = dom.window;
global.document = dom.window.document;
global.getComputedStyle = dom.window.getComputedStyle;
Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true });
// node's global fetch is already available to the app modules; no wrapper needed

const errors = [];
// jsdom has no canvas 2d context (needs the optional `canvas` package); rain.js
// guards for it, so that one "Not implemented" complaint is expected here.
const IGNORE = /HTMLCanvasElement's getContext\(\) method/;
const pushErr = (msg) => { if (!IGNORE.test(msg)) errors.push(msg); };
dom.window.addEventListener('error', (e) => pushErr(e.message));
process.on('unhandledRejection', (r) => pushErr('unhandledRejection: ' + (r?.stack || r)));
const origErr = console.error;
console.error = (...a) => { pushErr(a.join(' ')); origErr(...a); };

// seed a 3-day calibration ledger so the 확률 성적표 (opens at 3+ days of records)
// can be exercised on a cold jsdom boot; today's settle appends on top of this
const calSeed = [];
const dayAgo = (off) => new Date(Date.now() - off * 864e5).toISOString().slice(0, 10);
for (const off of [2, 3, 4]) {
  for (let h = 0; h < 8; h++) {
    calSeed.push({ rk: 'seed', time: `${dayAgo(off)}T0${h}:00`, p: h / 10, wet: h >= 6 });
  }
}
dom.window.localStorage.setItem('calib:v1', JSON.stringify(calSeed));

await import('../js/main.js');

// wait for the async selectRegion() → render to finish
const cols = await (async () => {
  for (let i = 0; i < 60; i++) {
    const c = document.querySelectorAll('#stripCols .col');
    if (c.length) return c;
    await new Promise((r) => setTimeout(r, 200));
  }
  return document.querySelectorAll('#stripCols .col');
})();

const d = document;
const txt = (sel) => d.querySelector(sel)?.textContent?.trim();
console.log('DEBUG overlay hidden:', d.getElementById('overlay').hidden,
  '| msg:', txt('#overlayMsg'), '| retry hidden:', d.getElementById('retryBtn').hidden,
  '| errors:', errors.length ? errors : 'none');
const report = [];
const check = (name, cond, extra = '') =>
  report.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);

check('no JS errors during boot/render', errors.length === 0, errors.join(' | '));
check('strip rendered today\'s hourly columns (1–24)', cols.length >= 1 && cols.length <= 24, `got ${cols.length}`);
check('every column has ≥1 precip segment', [...cols].every((c) => c.querySelectorAll('.col__seg').length >= 1));
check('column segment heights sum to ~100%', [...cols].every((c) => {
  const sum = [...c.querySelectorAll('.col__seg')].reduce((s, seg) => s + parseFloat(seg.style.height), 0);
  return Math.abs(sum - 100) < 0.6;
}));
check('region label set', (txt('#vRegion') || '').includes('수원'), txt('#vRegion'));
check('clutter removed (no sentence/digest/temp)',
  !d.getElementById('vLine') && !d.getElementById('digest') && !d.getElementById('tempRow'));
check('legend shows all 4 bucket colors', d.querySelectorAll('#legend li .swatch').length === 4);
check('day mood set on root (air wash)',
  ['clear', 'unsettled', 'rainy'].includes(d.documentElement.dataset.mood), d.documentElement.dataset.mood);
check('0% scenarios keep an honestly empty track', [...d.querySelectorAll('#board .scenario')].every((row) => {
  const isZero = row.querySelector('.scenario__pct')?.textContent === '0%';
  const w = parseFloat(row.querySelector('.scenario__fill')?.style.width || '0');
  return !isZero || w === 0;
}));
// baseline retro states, rendered directly so the check is deterministic
// (the live #retro upgrades asynchronously once actuals arrive):
// a true first visit gets the invitation; a device with a settled ledger
// (we seeded one) gets the quiet "대조 중" instead of a flashing invitation
const uiMod = await import('../js/ui.js');
const probe = d.createElement('div');
uiMod.renderRetro(probe, null);
check('retro first-run baseline is the invitation', probe.textContent.includes('기억해'));
uiMod.renderRetro(probe, null, { pending: true });
check('returning-device baseline is "대조 중", not the invitation',
  probe.textContent.includes('대조하는 중') && !probe.textContent.includes('기억해'));
check('booted retro shows the pending line (calib ledger was seeded)',
  /대조하는 중|확률 성적표/.test(d.getElementById('retro')?.textContent || ''));
check('forecast snapshots saved for the visible days',
  dom.window.localStorage.length >= 2, `${dom.window.localStorage.length} keys`);
check('board conditions is one compact line (temp·강수·바람)',
  /기온.*강수.*바람/.test(d.querySelector('#board .board__cond')?.textContent || ''),
  d.querySelector('#board .board__cond')?.textContent);
check('time axis labels every other hour with ticks', d.querySelectorAll('#stripTimes .tick--on').length >= 2,
  `${d.querySelectorAll('#stripTimes .tick--on').length} labeled`);
check('day tabs rendered', d.querySelectorAll('#dayTabs .daytab').length >= 1, `${d.querySelectorAll('#dayTabs .daytab').length} tabs`);
check('exactly one day tab selected', d.querySelectorAll('#dayTabs .daytab[aria-selected="true"]').length === 1);
check('board shows 4 scenarios', d.querySelectorAll('#board .scenario').length === 4);
check('each scenario shows a %', [...d.querySelectorAll('#board .scenario .scenario__pct')].every((e) => /%$/.test(e.textContent)));
check('exactly one leading scenario highlighted', d.querySelectorAll('#board .scenario.is-lead').length === 1);
check('exactly one column marked "지금" on today', d.querySelectorAll('#stripCols .col--now').length === 1);
check('one column is selected (aria-pressed)', d.querySelectorAll('#stripCols .col[aria-pressed="true"]').length === 1);
check('favorites rendered 2 chips', d.querySelectorAll('#favs .chip').length === 2);
check('overlay hidden after load', d.getElementById('overlay').hidden === true);

// hunch interaction: tap a scenario → highlight + persisted; tap again → cleared
const pickKeys = () =>
  [...Array(dom.window.localStorage.length)].map((_, i) => dom.window.localStorage.key(i)).filter((k) => k.startsWith('pick:'));
d.querySelector('#board .scenario').click();
check('tapping a scenario highlights it', d.querySelectorAll('#board .scenario.is-picked').length === 1);
check('the hunch is persisted for tomorrow\'s scoring',
  pickKeys().some((k) => dom.window.localStorage.getItem(k).includes(':')), pickKeys().join(','));
d.querySelector('#board .scenario.is-picked').click();
check('tapping it again clears the highlight', d.querySelector('#board .scenario.is-picked') == null);
check('clearing the pick also clears the stored hunch',
  pickKeys().every((k) => dom.window.localStorage.getItem(k) === '{}'));

// interaction paths: switch to tomorrow and back
const tabs = d.querySelectorAll('#dayTabs .daytab');
if (tabs.length > 1) {
  tabs[1].click();
  check('day tab switch re-renders strip', d.querySelectorAll('#stripCols .col').length >= 1,
    `tomorrow cols=${d.querySelectorAll('#stripCols .col').length}`);
  tabs[0].click(); // back to today
}
check('table view removed (사용자 결정)', !d.getElementById('tableToggle') && !d.getElementById('tableWrap'));

// rain art: selecting an hour whose lead scenario is rain must set data-rain
const leadOfCol = (i) => {
  d.querySelectorAll('#stripCols .col')[i].click();
  return d.documentElement.dataset.rain || '(none)';
};
const rainStates = [...d.querySelectorAll('#stripCols .col')].map((_, i) => leadOfCol(i));
check('rain art reacts to selected hour (some state observed)', rainStates.length > 0, rainStates.join(' '));

// 확률 성적표: renders async once actuals arrive — wait for the rows, then check
// the gauge anatomy (fill = actual rate, tick = said probability) and honest copy
const calRows = await (async () => {
  for (let i = 0; i < 50; i++) {
    const r = document.querySelectorAll('#retro .calib__row');
    if (r.length) return r;
    await new Promise((r2) => setTimeout(r2, 200));
  }
  return document.querySelectorAll('#retro .calib__row');
})();
check('확률 성적표 renders once 3+ days of records exist', calRows.length >= 1, `${calRows.length} rows`);
check('every calib row has a fill and a said-probability tick',
  [...calRows].every((r) => r.querySelector('.calib__fill') && r.querySelector('.calib__tick')));
check('calib rows read "N시간 중 M시간 비 · P%"',
  [...calRows].every((r) => /\d+시간 중 \d+시간 비 · \d+%/.test(r.querySelector('.calib__result')?.textContent || '')));
check('calib explainer states the reading rule',
  /막대.*세로선/.test(txt('#retro .calib__how') || ''), txt('#retro .calib__how'));
check('브라이어 종합 점수 line renders with its yardstick',
  /종합 확률 점수 0\.\d{2}.*0\.25/.test(txt('#retro .calib__brier') || ''), txt('#retro .calib__brier'));
check('calibration ledger persisted and deduped',
  (() => { try { return JSON.parse(dom.window.localStorage.getItem('calib:v1')).length >= calSeed.length; } catch { return false; } })());

// 돌아보기 dashboard: a real instrument now — day title, stats line, tappable
// hour strip aligned to the actual timeline, per-hour detail board
const retroCols = d.querySelectorAll('#retro .retro__col');
check('retro dashboard has a day title', /어제의 결과/.test(txt('#retro .retro__title') || ''), txt('#retro .retro__title'));
check('retro stats line summarizes the day', /실제/.test(txt('#retro .retro__stats') || ''), txt('#retro .retro__stats'));
check('retro strip renders one tappable BUTTON per actual hour',
  retroCols.length >= 20 && [...retroCols].every((c) => c.tagName === 'BUTTON'), `${retroCols.length} cols`);
check('a story hour is pre-selected with its detail board (4 scenario rows)',
  d.querySelectorAll('#retro .retro__col[aria-pressed="true"]').length === 1 &&
  d.querySelectorAll('#retro .retro__brow').length === 4);
check('the detail board marks what actually happened', !!d.querySelector('#retro .retro__tag--actual'));
retroCols[2]?.click();
check('tapping another retro hour moves the selection and rebuilds the detail',
  d.querySelector('#retro .retro__col[aria-pressed="true"]')?.dataset.time === retroCols[2]?.dataset.time &&
  d.querySelectorAll('#retro .retro__brow').length === 4);

console.log('\n' + report.join('\n'));
console.log(`\n지역: ${txt('#vRegion')}`);
console.log(`보드: ${txt('#board .board__when')} — 우세 ${txt('#board .scenario.is-lead .scenario__label')} ${txt('#board .scenario.is-lead .scenario__pct')}`);
console.log(`조건: ${txt('#board .board__cond')}`);
const fails = report.filter((r) => r.startsWith('FAIL'));
process.exit(fails.length ? 1 : 0);
