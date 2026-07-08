// Real-browser screenshot + layout probe, driving the installed Chrome via
// puppeteer-core. Usage: node scripts/shoot.mjs [width] [height]
// Writes .shot.png and prints any element wider than the viewport (overflow hunt).
import puppeteer from 'puppeteer-core';

const W = Number(process.argv[2] || 430);
const H = Number(process.argv[3] || 932);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
await page.goto('http://localhost:8848/', { waitUntil: 'networkidle0', timeout: 20000 });
await new Promise((r) => setTimeout(r, 800));

const info = await page.evaluate(() => {
  const vw = window.innerWidth;
  const offenders = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.width > vw + 1) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: el.className && el.className.toString().slice(0, 40),
        right: Math.round(r.right),
        width: Math.round(r.width),
      });
    }
  }
  return {
    vw,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: offenders.slice(0, 14),
  };
});

console.log(`viewport=${info.vw}  documentScrollWidth=${info.scrollWidth}`);
console.log('overflowing elements:');
for (const o of info.offenders) console.log(`  <${o.tag}.${o.cls}>  right=${o.right} width=${o.width}`);

await page.screenshot({ path: '.shot.png' });
await browser.close();
console.log('wrote .shot.png');
