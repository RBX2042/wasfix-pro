"use client";

import * as React from "react";

// There is no service worker any more (see public/sw.js). This component only
// cleans up after the old one: it unregisters any /sw.js registration and deletes
// the caches it created, so a browser that visited before is not left with cached
// copies of signed-in pages. public/sw.js does the same for browsers that never
// run this code again; this covers the ones that already loaded the page.
export function ServiceWorkerRegister() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    (async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          const script = reg.active?.scriptURL ?? reg.waiting?.scriptURL ?? reg.installing?.scriptURL ?? "";
          if (!cancelled && script.endsWith("/sw.js")) await reg.unregister();
        }
        if ("caches" in window) {
          const names = await caches.keys();
          await Promise.all(names.filter((n) => n.startsWith("wasfix-")).map((n) => caches.delete(n)));
        }
        // Keys of the removed install banner.
        localStorage.removeItem("wasfix-visits");
        localStorage.removeItem("wasfix-install-dismissed");
      } catch {
        // Storage or workers blocked: nothing to clean.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
