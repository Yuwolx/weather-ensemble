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
check('hero "지금" probability is numeric', /^\d+$/.test(txt('#vNow') || ''), txt('#vNow'));
check('hero read line is populated', (txt('#vLine') || '').length > 5, txt('#vLine'));
check('hero shows 3 stats', d.querySelectorAll('#vStats .stat').length === 3);
check('region label set', (txt('#vRegion') || '').includes('수원'), txt('#vRegion'));
check('day tabs rendered', d.querySelectorAll('#dayTabs .daytab').length >= 1, `${d.querySelectorAll('#dayTabs .daytab').length} tabs`);
check('exactly one day tab selected', d.querySelectorAll('#dayTabs .daytab[aria-selected="true"]').length === 1);
check('detail shows 4 scenario bars', d.querySelectorAll('#detail .scen').length === 4);
check('detail probability is a %', /%$/.test(txt('#detail .detail__prob') || ''), txt('#detail .detail__prob'));
check('exactly one column marked "지금" on today', d.querySelectorAll('#stripCols .col--now').length === 1);
check('one column is selected (aria-pressed)', d.querySelectorAll('#stripCols .col[aria-pressed="true"]').length === 1);
check('legend has 4 entries', d.querySelectorAll('#legend li').length === 4);
check('favorites rendered 2 chips', d.querySelectorAll('#favs .chip').length === 2);
check('overlay hidden after load', d.getElementById('overlay').hidden === true);
check('wind median rendered', /\d/.test(txt('#detail .wind__val') || ''), txt('#detail .wind__val'));

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
