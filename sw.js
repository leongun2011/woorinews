const CACHE_VER = 'banking-news-v5';
const STATIC_ASSETS = [
  './index.html',
  './style.css',
  './icon-192.png',
  './icon-512.png',
  './manifest.json',
];

// 항상 네트워크에서 불러올 파일 (캐시 안 함 → 항상 최신 유지)
const NETWORK_FIRST = [
  'app.js',
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

  // API / 외부 RSS / 폰트 → 항상 네트워크 (캐시 안 함)
  if (url.includes('/api/rss') ||
      url.includes('google.com') ||
      url.includes('fonts.googleapis') ||
      url.includes('fonts.gstatic')) {
    return;
  }

  // app.js → 항상 네트워크에서 최신 버전 불러오기
  if (NETWORK_FIRST.some(f => url.includes(f))) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // 나머지 정적 자산 → Cache-First
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
