import { FAVORITES, MODELS } from '../js/config.js';
const f = FAVORITES[0];
const p = new URLSearchParams({
  latitude: f.lat.toFixed(4), longitude: f.lon.toFixed(4),
  hourly: 'precipitation,wind_speed_10m,temperature_2m',
  models: MODELS.join(','), wind_speed_unit: 'ms', timezone: 'auto', forecast_days: '2',
});
const j = await (await fetch(`https://ensemble-api.open-meteo.com/v1/ensemble?${p}`)).json();
const keys = Object.keys(j.hourly);
const tk = keys.filter(k => k.startsWith('temperature_2m'));
const pk = keys.filter(k => k.startsWith('precipitation'));
console.log('temp member keys:', tk.length, '| precip keys:', pk.length);
// quantile helper
const q=(a,x)=>{a=a.filter(v=>typeof v==='number'&&isFinite(v)).sort((m,n)=>m-n);if(!a.length)return null;const i=x*(a.length-1),lo=Math.floor(i),hi=Math.ceil(i);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(i-lo);};
for (const i of [9,12,15,18]) {
  const t = tk.map(k=>j.hourly[k][i]);
  const pr = pk.map(k=>j.hourly[k][i]);
  console.log(`${j.hourly.time[i]}  기온 p10=${q(t,.1)?.toFixed(1)} med=${q(t,.5)?.toFixed(1)} p90=${q(t,.9)?.toFixed(1)}  강수량 med=${q(pr,.5)?.toFixed(2)} p90=${q(pr,.9)?.toFixed(2)}mm`);
}
