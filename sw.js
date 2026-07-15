/* Krinexa Agri service worker — makes the app load instantly and work offline.
 * Strategy: cache the app shell; serve it cache-first for static assets, and
 * network-first for page navigation (so updates arrive when online, and the
 * cached app still opens with no signal). API calls (/api/) always go to the
 * network and are NEVER cached — real data must stay live. */
const CACHE = 'krinexa-v2';
const SHELL = [
  './',
  './index.html',
  './chart.umd.min.js',
  './logo.svg',
  './icon.svg',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);

  // Never touch the API — always live, never cached.
  if (url.pathname.startsWith('/api/')) return;
  if (req.method !== 'GET') return;

  // Page loads: try network first, fall back to the cached app shell offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets: serve from cache first, update cache in the background.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => hit))
  );
});
