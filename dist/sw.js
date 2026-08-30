const CACHE = 'gp-hub-v247';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-512.png',
  // The sticker editor and the libraries it cannot work without. Printing a label is the
  // one thing done standing at the bench, where the phone's signal is worst, so these are
  // precached rather than left to be picked up on first use.
  './stickers.html',
  './qrcode.min.js',
  './tspl.js',
  './vendor/heebo.css',
  './vendor/fonts/heebo-hebrew.woff2',
  './vendor/fonts/heebo-latin.woff2',
  './vendor/tailwind-cdn.js',
  './vendor/html2canvas-1.4.1.min.js',
  './vendor/interact.min.js',
  './vendor/jspdf-2.5.1.umd.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    // One at a time, not addAll: addAll is atomic, so a single 404 would throw away the
    // whole precache — and the .catch() below it would swallow the fact that it had.
    caches.open(CACHE).then(c => Promise.all(
      ASSETS.map(u => c.add(u).catch(err => console.warn('sw: precache skipped', u, err)))
    ))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Same-origin only. This handler used to answer EVERY GET, including a top-level
  // navigation to another site — and a cross-origin request pulled through fetch() here
  // comes back opaque, which a browser will not render as a document. The navigation then
  // dies with no error and no page: pressing the Google buttons appeared to do nothing.
  // Returning early hands those requests straight to the network, untouched.
  let sameOrigin = false;
  try { sameOrigin = new URL(e.request.url).origin === self.location.origin; } catch (err) { sameOrigin = false; }
  if (!sameOrigin) return;

  // THE DOCUMENT IS NETWORK-FIRST. Everything else stays cache-first.
  //
  // Cache-first on the document meant a deploy never reached the phone on the first open:
  // the old page was served from cache while the new one was fetched in the background, so
  // the fix always landed one launch late. On 2026-08-21 that cost a whole round of
  // "close it and open it again" per attempt, and made a fixed bug look unfixed.
  //
  // The bench is why it is a RACE and not a plain network-first: the signal there is bad,
  // and a document request that hangs for thirty seconds is worse than a day-old page. Four
  // seconds, then whatever is in the cache. Offline still opens instantly, because the fetch
  // rejects at once rather than timing out.
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      const cached = caches.match(e.request).then(r => r || caches.match('./index.html'));
      try {
        const fresh = await Promise.race([
          fetch(e.request),
          new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4000)),
        ]);
        if (fresh && fresh.status === 200 && fresh.type === 'basic') {
          const clone = fresh.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return fresh;
      } catch (err) {
        const fallback = await cached;
        if (fallback) return fallback;
        throw err;
      }
    })());
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(networkResp => {
        if (networkResp && networkResp.status === 200 && networkResp.type === 'basic') {
          const respClone = networkResp.clone();
          caches.open(CACHE).then(c => c.put(e.request, respClone));
        }
        return networkResp;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
