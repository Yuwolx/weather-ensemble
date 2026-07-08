import { loadEnsemble } from '../js/api.js';
import { precipDistribution, rainProbability, windStats, agreement } from '../js/stats.js';
import { PRECIP_BUCKETS, RAIN_THRESHOLD_MM, FAVORITES } from '../js/config.js';

const f = FAVORITES[0];
const data = await loadEnsemble(f.lat, f.lon);
console.log(`지역: ${f.name}  멤버수=${data.memberCount}  모델수=${data.modelCount}  시간수=${data.hours.length}`);
for (const h of data.hours.slice(9, 18)) {
  const d = precipDistribution(h.precipMembers, PRECIP_BUCKETS);
  const r = rainProbability(h.precipMembers, RAIN_THRESHOLD_MM);
  const a = agreement(d);
  const w = windStats(h.windMembers);
  const pct = (x) => (x*100).toFixed(0).padStart(3);
  console.log(`${h.time}  n=${String(d.n).padStart(3)}  비확률=${pct(r.probability)}%  [건${pct(d.fraction.dry)} 약${pct(d.fraction.light)} 보${pct(d.fraction.mod)} 강${pct(d.fraction.heavy)}]  합의=${a.dominantKey}/${pct(a.share)}%  바람 med=${w.median?.toFixed(1)} p90=${w.p90?.toFixed(1)}`);
}
