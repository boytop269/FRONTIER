// Frontier Service Worker
// Caches the app shell (index.html) for instant repeat loads.
// The question pack is fetched fresh each calendar day and cached until midnight.

const SHELL_CACHE = 'frontier-shell-v1';
const PACK_CACHE  = 'frontier-pack-v1';
const SHELL_FILES = ['/'];   // index.html — adjust if hosted in a subfolder

// ── Install: cache the app shell immediately ──────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: remove old caches ───────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== PACK_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: serve from cache where possible ────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Navigation requests (index.html) — cache-first, fall back to network
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('/')
        .then(cached => cached || fetch(event.request))
        .catch(() => caches.match('/'))
    );
    return;
  }

  // 2. Apps Script API calls — network-first, no caching
  //    (these are POST requests to the web app URL — never cache them)
  if (event.request.method === 'POST') {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ ok: false, error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // 3. Static assets (fonts, CSS from CDN etc.) — cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Only cache successful responses for same-origin or CDN assets
        if (
          response.ok &&
          (url.origin === self.location.origin ||
           url.hostname.includes('googleapis.com') ||
           url.hostname.includes('gstatic.com'))
        ) {
          const clone = response.clone();
          caches.open(SHELL_CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached); // return stale cache on network failure
    })
  );
});

// ── Background sync: re-cache index.html nightly ─────────────────────────
self.addEventListener('periodicsync', event => {
  if (event.tag === 'update-shell') {
    event.waitUntil(
      fetch('/').then(response => {
        if (response.ok) {
          return caches.open(SHELL_CACHE)
            .then(cache => cache.put('/', response));
        }
      }).catch(() => {}) // silent — stale cache still works
    );
  }
});
