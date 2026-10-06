// JalSetu service worker — makes the resident app installable and usable on flaky connections.
// Strategy: app shell & hashed assets cache-first; navigations network-first with cached shell fallback;
// resident GET APIs network-first with the last good response as offline fallback. Nothing else is cached.
const VERSION = 'jalsetu-v1';
const SHELL = ['/', '/resident', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon.svg'];
const OFFLINE_API = ['/api/resident/home', '/api/resident/schedule', '/api/resident/costs', '/api/resident/notices'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    if (!OFFLINE_API.includes(url.pathname)) return; // never cache admin/committee data
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || Response.json({ error: 'Offline' }, { status: 503 }))),
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/resident').then((r) => r || caches.match('/'))));
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
