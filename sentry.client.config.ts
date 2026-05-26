// Sentry client-side configuration — only active if NEXT_PUBLIC_SENTRY_DSN is set.
// Lazy-loaded to avoid bloating initial bundle.
//
// To activate:
// 1. npm install --save @sentry/nextjs
// 2. Set NEXT_PUBLIC_SENTRY_DSN in Vercel env
// 3. Set SENTRY_AUTH_TOKEN for source-map upload during build

type SentryEvent = {
  request?: { cookies?: unknown };
  user?: { email?: string };
};
type SentryModule = { init: (opts: Record<string, unknown>) => void };

if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_SENTRY_DSN) {
  // @ts-expect-error optional dependency — @sentry/nextjs may not be installed
  import(/* webpackIgnore: true */ "@sentry/nextjs")
    .then((Sentry: SentryModule) => {
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
        beforeSend(event: SentryEvent) {
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
