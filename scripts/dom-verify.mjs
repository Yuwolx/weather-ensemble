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
dom.window.addEventListener('error', (e) => errors.push(e.message));
process.on('unhandledRejection', (r) => errors.push('unhandledRejection: ' + (r?.stack || r)));
const origErr = console.error;
console.error = (...a) => { errors.push(a.join(' ')); origErr(...a); };

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
check('no single-% hero number (removed)', !d.getElementById('vNow'));
check('hero meta shows temp + wind', /기온.*바람/.test(txt('#vNowMeta') || ''), txt('#vNowMeta'));
check('hero read line is populated', (txt('#vLine') || '').length > 5, txt('#vLine'));
check('member-count line removed from rail', !d.getElementById('vTrust'));
check('daily digest populated', (txt('#digest') || '').length > 5, txt('#digest'));
check('region label set', (txt('#vRegion') || '').includes('수원'), txt('#vRegion'));
check('temp band is an svg area + median line',
  !!d.querySelector('#tempRow svg.tempsvg polygon.tempsvg__band') && !!d.querySelector('#tempRow svg.tempsvg polyline.tempsvg__line'));
check('temp axis shows a high/low label', d.querySelectorAll('#tempAxis span').length === 2);
check('board has temp + rain readouts', d.querySelectorAll('#board .ro').length >= 2,
  `${d.querySelectorAll('#board .ro').length} readouts`);
check('board wind graph present', !!d.querySelector('#board .wind__range .wind__median'));
check('board wind shows m/s', /m\/s/.test(d.querySelector('#board .windblock')?.textContent || ''));
check('time axis labels every other hour with ticks', d.querySelectorAll('#stripTimes .tick--on').length >= 2,
  `${d.querySelectorAll('#stripTimes .tick--on').length} labeled`);
check('day tabs rendered', d.querySelectorAll('#dayTabs .daytab').length >= 1, `${d.querySelectorAll('#dayTabs .daytab').length} tabs`);
check('exactly one day tab selected', d.querySelectorAll('#dayTabs .daytab[aria-selected="true"]').length === 1);
check('board shows 4 bettable scenarios', d.querySelectorAll('#board .scenario').length === 4);
check('each scenario shows a %', [...d.querySelectorAll('#board .scenario .scenario__pct')].every((e) => /%$/.test(e.textContent)));
check('exactly one leading scenario highlighted', d.querySelectorAll('#board .scenario.is-lead').length === 1);
check('settled section hidden with no matured bets', d.getElementById('settled').hidden === true);
check('exactly one column marked "지금" on today', d.querySelectorAll('#stripCols .col--now').length === 1);
check('one column is selected (aria-pressed)', d.querySelectorAll('#stripCols .col[aria-pressed="true"]').length === 1);
check('legend has 4 entries', d.querySelectorAll('#legend li').length === 4);
check('favorites rendered 2 chips', d.querySelectorAll('#favs .chip').length === 2);
check('overlay hidden after load', d.getElementById('overlay').hidden === true);

// betting interaction: tap a scenario → it becomes "내 선택" and persists
const firstScenario = d.querySelector('#board .scenario');
firstScenario.click();
check('tapping a scenario marks it picked', d.querySelector('#board .scenario.is-picked') != null);
check('bet persisted to localStorage', [...Array(dom.window.localStorage.length)].some((_, i) =>
  dom.window.localStorage.key(i).startsWith('wx-bet:')));
check('picked scenario shows 내 선택 label', /내 선택/.test(d.querySelector('#board .scenario.is-picked')?.textContent || ''));
// tap again → clears
d.querySelector('#board .scenario.is-picked').click();
check('tapping the pick again clears it', d.querySelector('#board .scenario.is-picked') == null);

// interaction paths: switch to tomorrow, then open the table
const tabs = d.querySelectorAll('#dayTabs .daytab');
if (tabs.length > 1) {
  tabs[1].click();
  check('day tab switch re-renders strip', d.querySelectorAll('#stripCols .col').length >= 1,
    `tomorrow cols=${d.querySelectorAll('#stripCols .col').length}`);
  tabs[0].click(); // back to today
}
d.getElementById('tableToggle').click();
check('table renders rows on toggle', d.querySelectorAll('#tableWrap table.data tbody tr').length >= 1,
  `rows=${d.querySelectorAll('#tableWrap table.data tbody tr').length}`);

console.log('\n' + report.join('\n'));
console.log(`\n지역: ${txt('#vRegion')}`);
console.log(`판정: ${txt('#vLine')}`);
console.log(`상세(${txt('#detail h3')}): 비확률 ${txt('#detail .detail__prob')} · 바람 ${txt('#detail .wind__val')}m/s`);
const fails = report.filter((r) => r.startsWith('FAIL'));
process.exit(fails.length ? 1 : 0);
