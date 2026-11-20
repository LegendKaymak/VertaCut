// VertaCut service worker: uygulama kabuğunu önbelleğe alır, çevrimdışı açılır.
const VERSION = 'vertacut-v1.8.1';
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest',
  './js/app.js', './js/util.js', './js/db.js', './js/audio.js', './js/ai.js',
  './js/captions.js', './js/render.js', './js/exporter.js', './js/sfx.js', './js/hooks.js', './fonts/AlloVariable.woff2',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
  './icons/favicon-16.png', './icons/favicon-32.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'vertacut-fonts').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Yazı tipleri: önce önbellek, arka planda yenile
  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    e.respondWith(caches.open('vertacut-fonts').then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin) return; // API istekleri doğrudan ağa gider
  if (req.headers.get('range')) return;        // video blob/aralık istekleri
  // Uygulama dosyaları: ağ öncelikli (güncellemeler hemen gelsin), çevrimdışıysa önbellek
  e.respondWith(
    fetch(req).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return r;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
