// Sentry client-side configuration — only active if NEXT_PUBLIC_SENTRY_DSN is set.
// Lazy-loaded to avoid bloating initial bundle.
//
// To activate:
// 1. npm install --save @sentry/nextjs
// 2. Set NEXT_PUBLIC_SENTRY_DSN in Vercel env
// 3. Set SENTRY_AUTH_TOKEN for source-map upload during build

if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_SENTRY_DSN) {
  import(/* webpackIgnore: true */ "@sentry/nextjs" as string)
    .then((Sentry) => {
      Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 1.0,
        environment: process.env.NODE_ENV,
        ignoreErrors: [
          "ResizeObserver loop limit exceeded",
          "ChunkLoadError",
          "Non-Error promise rejection captured",
        ],
        beforeSend(event) {
          // Strip PII from request data
          if (event.request?.cookies) delete event.request.cookies;
          if (event.user?.email) {
            event.user.email = event.user.email.replace(/(.{2}).+(@.+)/, "$1***$2");
          }
          return event;
        },
      });
    })
    .catch(() => {
      // @sentry/nextjs not installed — no-op
    });
}

export {};
