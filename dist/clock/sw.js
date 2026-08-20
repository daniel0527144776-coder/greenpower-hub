// The worker clock's own service worker, scoped to /clock/.
//
// Separate from the hub's root sw.js on purpose. This page is used at the bench with a bad
// signal and must open offline; it also has no business controlling the hub at the root, and
// the hub has no business caching this.
const CACHE = 'gp-clock-v1';
const ASSETS = ['./', './index.html', './manifest.webmanifest', '../icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(
    ASSETS.map((u) => c.add(u).catch((err) => console.warn('clock sw: skipped', u, err)))
  )));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k.startsWith('gp-clock-') && k !== CACHE).map((k) => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Same-origin only, and never the Supabase API: a punch must either reach the network or
  // stay in the page's own queue. A cached 200 for an insert would look like it was sent.
  let url;
  try { url = new URL(e.request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  e.respondWith(caches.match(e.request).then((cached) => {
    const net = fetch(e.request).then((resp) => {
      if (resp && resp.status === 200 && resp.type === 'basic') {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return resp;
    }).catch(() => cached);
    return cached || net;
  }));
});
