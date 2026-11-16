// ANCHOR Monsoon service worker: precaches the app so it works offline. Version __VERSION__
const CACHE = 'monsoon-__VERSION__';
const PRECACHE = self.__PRECACHE__;
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(Array.isArray(PRECACHE) ? PRECACHE : ['./'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('monsoon-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // fonts and other sites go straight to the network
  if (url.pathname.includes('/models/')) return; // the AI model is cached by the app itself
  if (url.pathname.includes('/ort/')) { // AI runtime: keep it across app updates
    e.respondWith(caches.open('anchor-monsoon-ai').then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }))));
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match('./')))
  );
});
