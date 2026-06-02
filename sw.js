const CACHE_NAME = 'invested-v28';
const FILES = [
  './',
  './index.html',
  './style.css?v=28',
  './app.js?v=28',
  './manifest.json'
];
     9|
    10|self.addEventListener('install', e => {
    11|  self.skipWaiting();
    12|  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(FILES)));
    13|});
    14|
    15|self.addEventListener('activate', e => {
    16|  e.waitUntil(
    17|    caches.keys().then(keys =>
    18|      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    19|    ).then(() => self.clients.claim())
    20|  );
    21|});
    22|
    23|self.addEventListener('fetch', e => {
    24|  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
    25|});
    26|