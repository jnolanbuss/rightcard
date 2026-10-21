// Offline support: cache the app shell. No push, no background sync, no location.
// Bump CACHE when files change so phones pick up the update.
const CACHE = 'rightcard-v3';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'core.js', 'manifest.json', 'places/index.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'icons/icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network-first for same-origin GETs (so updates arrive), falling back to cache offline.
// Places tiles (places/t_*.json) are cached the first time they're used, so places you've been near work offline.
// Page loads (including links like ?store=Publix) are cached once, as the app shell './',
// and served from it offline regardless of the query string.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const isPage = req.mode === 'navigate';
  const key = isPage ? new URL('./', self.registration.scope).href : url.origin + url.pathname;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
      return res;
    }).catch(() => caches.match(key, { ignoreSearch: true })
      .then((r) => r || caches.match(req, { ignoreSearch: true }))
      .then((r) => r || (isPage ? caches.match('index.html') : undefined))
      .then((r) => r || Response.error()))
  );
});
