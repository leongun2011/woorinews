const CACHE_VER = 'banking-news-v3';
const STATIC_ASSETS = [
  './index.html',
  './app.js',
  './style.css',
  './icon-192.png',
  './icon-512.png',
  './manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VER).then(c => c.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VER).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Netlify Functions / 외부 RSS → 항상 네트워크 (캐시 안 함)
  if (url.includes('/api/rss') ||
      url.includes('google.com') ||
      url.includes('fonts.googleapis') ||
      url.includes('fonts.gstatic')) {
    return;
  }

  // 정적 자산 → Cache-First
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp && resp.status === 200 && resp.type !== 'opaque') {
          caches.open(CACHE_VER).then(c => c.put(e.request, resp.clone()));
        }
        return resp;
      }).catch(() => caches.match('./index.html'));
    })
  );
});