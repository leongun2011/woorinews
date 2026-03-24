// ★ 버전 바꾸면 캐시 자동 갱신
const CACHE_VER = 'banking-news-v2';
const STATIC_ASSETS = [
  './index.html',
  './app.js',
  './style.css',
  './icon-192.png',
  './icon-512.png',
  './manifest.json',
];

// ── 설치: 정적 자산 미리 캐싱 ─────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VER).then(c => c.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── 활성화: 구 캐시 삭제 ──────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VER).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── 요청 처리 ─────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // 외부 API / RSS 요청 → 항상 네트워크 (캐시 안 함)
  if (url.includes('allorigins') ||
      url.includes('corsproxy') ||
      url.includes('thingproxy') ||
      url.includes('google.com') ||
      url.includes('fonts.googleapis') ||
      url.includes('fonts.gstatic')) {
    return;
  }

  // 정적 자산 → Cache-First (캐시 있으면 즉시, 없으면 네트워크 후 저장)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp && resp.status === 200 && resp.type !== 'opaque') {
          const clone = resp.clone();
          caches.open(CACHE_VER).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match('./index.html')); // 오프라인 폴백
    })
  );
});
