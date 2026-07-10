// Ambient rain on a fixed canvas — the media-art layer. Every drop has its own
// length, speed and weight, so it reads as weather, not wallpaper. Kept apart
// from the data layers: this file may touch the canvas and rAF, nothing else.

const DROP_COLOR = (a) => `rgba(88, 120, 162, ${a})`;

// per-intensity feel: density is drops per 100k px², speed in px/s
const PRESETS = {
  light: { density: 8, speed: [420, 640], len: [9, 18], width: 1, alpha: [0.18, 0.4], slant: 0.05 },
  mod: { density: 18, speed: [560, 820], len: [12, 24], width: 1.1, alpha: [0.24, 0.5], slant: 0.07 },
  heavy: { density: 34, speed: [720, 1040], len: [16, 32], width: 1.3, alpha: [0.3, 0.6], slant: 0.09 },
};

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

export function createRain(canvas) {
  const ctx = canvas?.getContext?.('2d');
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!ctx || reduced) return { set() {}, destroy() {} }; // jsdom / reduced-motion: silently inert

  let drops = [];
  let preset = null;
  let raf = 0;
  let last = 0;
  let w = 0;
  let h = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  const newDrop = (fromTop) => ({
    x: rand(-40, w + 40),
    y: fromTop ? rand(-h * 0.2, -10) : rand(0, h),
    len: rand(...preset.len),
    speed: rand(...preset.speed),
    alpha: rand(...preset.alpha),
  });

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((t - last) / 1000, 0.05); // clamp tab-switch jumps
    last = t;
    ctx.clearRect(0, 0, w, h);
    if (!preset) return;
    const target = Math.round(((w * h) / 100000) * preset.density);
    while (drops.length < target) drops.push(newDrop(false));
    if (drops.length > target) drops.length = target;
    ctx.lineWidth = preset.width;
    ctx.lineCap = 'round';
    for (const d of drops) {
      d.y += d.speed * dt;
      d.x -= d.speed * preset.slant * dt;
      if (d.y - d.len > h) Object.assign(d, newDrop(true));
      // drops thin out toward the ground so text stays quiet
      const fade = Math.max(0, 1 - (d.y / h) * 0.85);
      if (fade <= 0.02) continue;
      ctx.strokeStyle = DROP_COLOR((d.alpha * fade).toFixed(3));
      ctx.beginPath();
      ctx.moveTo(d.x, d.y - d.len);
      ctx.lineTo(d.x - d.len * preset.slant * 2, d.y);
      ctx.stroke();
    }
  }

  function start() {
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    ctx.clearRect(0, 0, w, h);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (preset) start();
  });

  return {
    set(intensity) {
      preset = PRESETS[intensity] || null;
      if (!preset) {
        drops = [];
        stop();
      } else {
        start();
      }
    },
    destroy() {
      stop();
      window.removeEventListener('resize', resize);
    },
  };
}
