/* Fleet Ops service worker — makes the app installable and keeps the app shell
   available on a weak connection. Data (/api/*) is never cached: it always
   comes live from the server so staff don't see stale records. */
const CACHE = "fleet-ops-v139";
const SHELL = ["/", "/app-storage.js", "/i18n.js", "/wa-parse.js", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/vendor/chart.umd.js", "/vendor/xlsx.full.min.js", "/vendor/pdf.min.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  // Network first, fall back to cache when offline.
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("/")))
  );
});
