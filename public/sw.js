// WasFix Pro: this service worker is a kill switch, on purpose.
//
// The previous worker cached every HTML page it saw, including /dashboard, /admin,
// /checkout and /bestelling/<id> (name and address) when somebody was signed in,
// and could serve them back to the next person on the same browser. It also
// registered before the visitor made any cookie choice. Offline use is worth
// little for a webshop, and the browser's own HTTP cache already handles the
// fingerprinted static files, so the worker was removed rather than fixed.
//
// Browsers that already have the old worker re-fetch /sw.js, find this file and
// install it. It deletes every cache and unregisters itself. It has no fetch
// handler, so until it is gone every request goes straight to the network, and it
// never reloads open pages (that could interrupt a checkout).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      await self.registration.unregister();
    })(),
  );
});
