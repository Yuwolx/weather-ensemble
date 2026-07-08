// Service worker — makes the app installable ("홈 화면에 추가") and usable offline.
// Strategy: network-first for our own files (so updates always show, no staleness),
// falling back to cache when offline. Weather API calls are never cached — they
// must be live. Bump CACHE on each deploy that changes the app shell.
const CACHE = 'wx-ensemble-v2';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/main.js',
  './js/ui.js',
  './js/api.js',
  './js/stats.js',
  './js/format.js',
  './js/config.js',
  './js/regions.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // API & fonts → straight to network
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
