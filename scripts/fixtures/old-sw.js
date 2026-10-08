// WasFix Pro service worker — offline support for foutcodes + core pages.
//
// Strategy:
//   - Pre-cache critical shell: /, /diagnose, /foutcodes, /onderdelen, /gidsen, fonts
//   - Network-first for HTML pages (so updates ship)
//   - Cache-first for static assets (fonts, images, _next/static)
//   - On offline fetch failure: serve cached fallback if available, otherwise /offline.html

const CACHE_VERSION = "wasfix-v3";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const PAGES_CACHE = `${CACHE_VERSION}-pages`;
const ASSETS_CACHE = `${CACHE_VERSION}-assets`;

const SHELL_URLS = [
  "/",
  "/diagnose",
  "/foutcodes",
  "/onderdelen",
  "/gidsen",
  "/offline.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => !n.startsWith(CACHE_VERSION))
          .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Skip Next.js HMR + API routes (always network)
  if (url.pathname.startsWith("/_next/webpack") ||
      url.pathname.startsWith("/api/") ||
      url.hostname !== self.location.hostname) {
    return;
  }

  // Static assets: cache-first
  if (url.pathname.startsWith("/_next/static") ||
      url.pathname.match(/\.(?:png|jpg|jpeg|svg|gif|webp|avif|woff2?|ttf|css|js|ico)$/i)) {
    event.respondWith(cacheFirst(req, ASSETS_CACHE));
    return;
  }

  // HTML pages: network-first with cache fallback
  if (req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirst(req, PAGES_CACHE));
    return;
  }

  // Default: network-only
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return new Response("Offline — asset unavailable", { status: 503 });
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    const offline = await caches.match("/offline.html");
    return offline ?? new Response("Offline — geen netwerk", { status: 503 });
  }
}
