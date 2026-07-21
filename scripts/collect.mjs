// Daily data collector — run by GitHub Actions (see .github/workflows/collect.yml),
// also runnable locally: `node scripts/collect.mjs`.
//
// Appends two CSV ledgers under data/, one file pair per month:
//   forecasts-YYYY-MM.csv  run_date,region,time,model,n,dry,light,mod,heavy
//     — today's + tomorrow's per-hour scenario fractions, one row per agency
//       plus the combined 'ensemble' row. This is "그날 아침 예보가 봤던 경우의 수"
//       frozen at collection time, per agency.
//   actuals-YYYY-MM.csv    run_date,region,time,mm
//     — yesterday's hourly precipitation (reanalysis-grade), for settling.
//
// Why a repo, why CSV: the app is a static PWA with no backend; the repo IS the
// database. CSV keeps it greppable/Excel-able, and once committed it's served by
// GitHub Pages, so the app itself can consume the archive later. Reuses the
// app's own pure modules so the numbers match what users saw.

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { FAVORITES, PRECIP_BUCKETS } from '../js/config.js';
import { buildEnsembleUrl, parseEnsemble } from '../js/api.js';
import { precipDistribution, perModelDistributions } from '../js/stats.js';

const DATA_DIR = new URL('../data/', import.meta.url);
mkdirSync(DATA_DIR, { recursive: true });

// Region-local "today" comes from the API's utc_offset; collection runs on a
// UTC cron, so never trust the runner's local clock for date arithmetic.
const dateOf = (iso) => iso.slice(0, 10);
const f3 = (v) => String(Math.round(v * 1000) / 1000);

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const json = await res.json();
  if (json.error) throw new Error(json.reason || `API error ${url}`);
  return json;
}

// Append rows unless this run_date+region pair is already recorded (idempotent:
// a re-run or a second daily trigger must not duplicate the ledger).
function appendOnce(file, header, marker, rows) {
  const path = new URL(file, DATA_DIR);
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  if (existing.includes(marker)) {
    console.log(`skip ${file} — ${marker} already recorded`);
    return false;
  }
  if (!existing) writeFileSync(path, header + '\n');
  appendFileSync(path, rows.map((r) => r.join(',')) .join('\n') + '\n');
  console.log(`${file} += ${rows.length} rows (${marker})`);
  return true;
}

const FR_HEADER = 'run_date,region,time,model,n,dry,light,mod,heavy';
const AC_HEADER = 'run_date,region,time,mm';

for (const region of FAVORITES) {
  const slug = region.name.replace(/\s+/g, '');

  // --- forecasts: the distributions the ensemble sees right now ---
  const ens = parseEnsemble(await fetchJson(buildEnsembleUrl(region.lat, region.lon)));
  const utcMs = Date.now() + ens.utcOffsetSeconds * 1000;
  const runDate = new Date(utcMs).toISOString().slice(0, 10); // region-local today
  const futureHours = ens.hours.filter((h) => dateOf(h.time) >= runDate);
  const frRows = [];
  for (const h of futureHours) {
    const all = precipDistribution(h.precipMembers, PRECIP_BUCKETS);
    const perModel = { ensemble: { fraction: all.fraction, n: all.n }, ...perModelDistributions(h.precipByModel, PRECIP_BUCKETS) };
    for (const [model, d] of Object.entries(perModel)) {
      frRows.push([runDate, slug, h.time, model, d.n, f3(d.fraction.dry), f3(d.fraction.light), f3(d.fraction.mod), f3(d.fraction.heavy)]);
    }
  }
  appendOnce(`forecasts-${runDate.slice(0, 7)}.csv`, FR_HEADER, `${runDate},${slug}`, frRows);

  // --- actuals: what yesterday actually did ---
  const p = new URLSearchParams({
    latitude: region.lat.toFixed(4),
    longitude: region.lon.toFixed(4),
    hourly: 'precipitation',
    past_days: '1',
    forecast_days: '1',
    timezone: 'auto',
  });
  const ac = await fetchJson(`https://api.open-meteo.com/v1/forecast?${p}`);
  const times = ac.hourly?.time || [];
  const mm = ac.hourly?.precipitation || [];
  const acRows = times
    .map((t, i) => [runDate, slug, t, mm[i] ?? ''])
    .filter((r) => dateOf(r[2]) < runDate);
  appendOnce(`actuals-${runDate.slice(0, 7)}.csv`, AC_HEADER, `${runDate},${slug}`, acRows);
}

console.log('collect done');
