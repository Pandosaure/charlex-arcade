const CACHE_NAME = 'charlex-arcade-v19';
const urlsToCache = [
  './',
  './index.html',
  './games/brothers-defense.html',
  './games/archer-arena.html',
  './games/bd2/',
  './games/bd2/bd2-config.js',
  './games/bd2/bd2-game.js',
  './games/bd2/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    // Network-first: always try fresh version, fall back to cache if offline
    fetch(event.request)
      .then(fetchResponse => {
        if (fetchResponse && fetchResponse.status === 200) {
          const responseClone = fetchResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return fetchResponse;
      })
      .catch(() => caches.match(event.request).then(r => r || caches.match('./index.html')))
  );
});
