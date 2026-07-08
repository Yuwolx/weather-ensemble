// Bake the live-rendered app into a self-contained static HTML preview (real data,
// inlined CSS, no JS/fetch) so the design can be viewed anywhere — including as a
// shareable Artifact. Not the real app; a faithful point-in-time picture of it.
import { JSDOM } from 'jsdom';
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');
const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf-8');
const dom = new JSDOM(html, { url: 'http://localhost:8848/', pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.getComputedStyle = dom.window.getComputedStyle;

await import('../js/main.js');
for (let i = 0; i < 60; i++) {
  if (document.querySelectorAll('#stripCols .col').length) break;
  await new Promise((r) => setTimeout(r, 200));
}
// pick an early, decision-relevant hour for the static detail panel
const d = document;
d.getElementById('overlay')?.remove();
d.querySelector('script[type="module"]')?.remove();
// drop the preconnect/font links (CSP-blocked in artifacts; system fallback is fine)
d.querySelectorAll('link').forEach((l) => l.remove());

const body = d.body.innerHTML;
const out = `<title>기상 합의 · 앙상블 날씨</title>
<style>
/* system-font fallback note: Inter/JetBrains Mono load from CDN in the real app;
   this static preview falls back to system sans/mono, which the CSS already lists. */
${css}
.preview-note{max-width:1120px;margin:0 auto;padding:14px 20px 0;color:var(--ink-subtle);font-size:12px}
.preview-note b{color:var(--ink-muted);font-weight:600}
</style>
<div class="preview-note">정적 미리보기 · 실데이터 스냅샷 (수원시 권선구) · 실제 앱은 실시간으로 갱신되고 지역 검색·시각 선택이 동작합니다.</div>
${body}`;

writeFileSync(new URL('../preview.html', import.meta.url), out, 'utf-8');
console.log('wrote preview.html  (', out.length, 'bytes )');
console.log('verdict:', d.querySelector('#vLine').textContent.trim());
