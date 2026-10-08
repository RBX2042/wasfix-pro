"use client";

import * as React from "react";

// Kept as a pass-through so the root layout needs no change. PostHog is loaded by
// ConsentedAnalytics (via analytics-loaders.ts), after consent, together with the
// other providers. This component used to do `import("posthog-js")` behind a
// webpackIgnore comment; the package is not installed and a browser cannot resolve
// a bare module specifier, so that import failed on every consented page view and
// PostHog never loaded.
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
