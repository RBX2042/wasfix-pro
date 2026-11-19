import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";
import { cspFromEnv, cspHeaderName } from "./src/lib/csp";
import { alternateHost, checkAppUrl, siteUrl } from "./src/lib/site-url";
import { HTML_LIMITED_BOT_UA_RE } from "next/dist/shared/lib/router/utils/html-bots";
import { isNonProductionDeployment, privateHeaderSources, variantHeaderRules } from "./src/lib/seo";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  openAnalyzer: false,
});

const IS_PROD = process.env.NODE_ENV === "production";

// NEXT_PUBLIC_APP_URL: the one public address of this deployment (sitemap,
// robots.txt, canonical URLs, CORS, Stripe return URLs, e-mail buttons). It used
// to default to http://localhost:3000 and nothing complained, so a deployment
// without it sent paying customers to localhost.
//   - Production build on Vercel: refuse to build. A build that cannot work is
//     better than a live shop that quietly sends customers elsewhere.
//   - Anywhere else (a self-hosted server, a local `next build`): print the
//     problem loudly. Checkout already answers 503 in this state
//     (src/lib/cart-gate.ts), sitemap/robots.txt publish nothing rather than a
//     wrong address, and `npm run preflight` reports it as a blocker. Failing
//     every local production build would break the test setups that run
//     `next build` + `next start` without a public domain.
const APP_URL_CHECK = checkAppUrl(process.env.NEXT_PUBLIC_APP_URL);
const APP_URL = siteUrl();
if (IS_PROD && !APP_URL_CHECK.url) {
  const message = [
    "NEXT_PUBLIC_APP_URL is niet bruikbaar voor productie:",
    ...APP_URL_CHECK.errors.map((e) => `  - ${e}`),
    "Zet in de hostingomgeving bijvoorbeeld NEXT_PUBLIC_APP_URL=https://wasfix.nl en bouw opnieuw (de waarde wordt tijdens de build ingebakken).",
  ].join("\n");
  if (process.env.VERCEL_ENV === "production") throw new Error(message);
  // Only for `next build`. `next lint` also loads this file with NODE_ENV=production and no
  // way to tell it apart by phase (it passes the build phase too), so a developer with the
  // .env.example value (http://localhost:3000) saw this on every lint run. The running server
  // reports the same state at boot (src/lib/monitoring.ts startupProblems) and checkout answers 503.
  if (process.argv.includes("build")) console.error(`\n[wasfix] WAARSCHUWING\n${message}\n`);
}

// Canonical host: the www variant of the apex (or the other way round) is
// redirected to the host named in NEXT_PUBLIC_APP_URL, so a page is never
// indexable under two hosts. *.vercel.app is deliberately NOT redirected: preview
// deployments live there. Redirect that alias in the hosting dashboard if wanted.
const OTHER_HOST = alternateHost(APP_URL_CHECK.url);

// Content Security Policy: src/lib/csp.ts (it derives the Clerk host from the publishable key).
const CSP = cspFromEnv();

// Real auth is on when both Clerk keys exist and the server will actually use
// them. Demo mode only exists outside production (src/lib/demo-mode.ts), so
// DEMO_MODE=true must not switch the sign-in UI off in a production build: it
// used to, which rendered the "Demo modus" card on /inloggen while the
// middleware wanted a real Clerk session, so nobody could sign in.
// Exposed as a public build-time flag so client components (header, auth
// pages) can render Clerk UI without importing server-only env.
const CLERK_ENABLED =
  (IS_PROD || process.env.DEMO_MODE !== "true") &&
  Boolean(process.env.CLERK_SECRET_KEY) &&
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

// The migrations this build was made for, baked in so /api/v1/health can tell
// whether the database has them all (a serverless bundle has no prisma/ folder to
// read at run time). Not a variable anyone sets: it is derived from the repository.
function expectedMigrations(): string {
  try {
    const dir = path.join(process.cwd(), "prisma", "migrations");
    const names = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    return names.length > 0 ? JSON.stringify(names) : "";
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  // Defaults to .next. Lets several dev servers or builds run side by side from
  // one checkout (parallel test runs, a build while a dev server is up) without
  // overwriting each other's output — they share one directory otherwise.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  env: {
    NEXT_PUBLIC_CLERK_ENABLED: CLERK_ENABLED ? "true" : "false",
    WASFIX_EXPECTED_MIGRATIONS: expectedMigrations(),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "cdn.jsdelivr.net" },
      { protocol: "https", hostname: "img.clerk.com" },
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "placehold.co" },
    ],
    formats: ["image/avif", "image/webp"],
    deviceSizes: [360, 640, 750, 828, 1080, 1200, 1440, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60 * 60 * 24 * 7, // 1 week
    unoptimized: process.env.NODE_ENV === "development",
  },
  poweredByHeader: false,
  // SEO (D23): the clients that get a dynamic page's title, description, canonical and robots tag inside <head>
  // instead of streamed into <body> after it. Next's own list (link-preview bots, Bingbot, Applebot, Google's
  // inspection tool) PLUS Googlebot, which Next leaves out on the assumption that it renders the page and finds the
  // tags again. Measured here: a Chromium with a Googlebot user agent leaves the title, canonical and og:* in <body>
  // on /contact, /onderdelen, /diagnose, /gidsen, and Google documents the canonical and the robots tag for <head>.
  // The price is a crawler's response waiting for generateMetadata() to resolve; ordinary visitors still get the
  // streamed form. Kept as "default list + Googlebot" so a Next upgrade that extends its list is not lost.
  htmlLimitedBots: new RegExp(`${HTML_LIMITED_BOT_UA_RE.source}|Googlebot`, "i"),
  compress: true,
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    optimizePackageImports: ["lucide-react", "@radix-ui/react-dialog", "@radix-ui/react-tabs"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=(), interest-cohort=(), payment=(self)",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // CSP — report-only in dev to avoid breaking HMR
          { key: cspHeaderName(IS_PROD), value: CSP },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          // No usable APP_URL (production misconfiguration): send no CORS header at all
          // instead of one naming localhost. Same-origin requests do not need it.
          ...(APP_URL ? [{ key: "Access-Control-Allow-Origin", value: APP_URL }] : []),
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PUT,DELETE,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
          // Disable indexing of API routes
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
      {
        // Long-cache static assets
        source: "/_next/static/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      // SEO (src/lib/seo.ts): the private and transactional paths carry noindex as a header as well. robots.txt
      // disallows them; this header and the page's own robots tag are the backstop for a crawler that fetches
      // anyway, and a header also covers a redirect to the sign-in page.
      ...privateHeaderSources().map((source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
      // Crawlable pages that must not be indexed, as a header too (src/lib/seo.ts variantHeaderRules): the filter
      // variants of the list pages, the return form with a token, the QR landing pages. Before the preview rule,
      // which must win.
      ...variantHeaderRules().map(({ source, has, robots }) => ({
        source,
        ...(has ? { has } : {}),
        headers: [{ key: "X-Robots-Tag", value: robots }],
      })),
      // A Vercel preview or development deployment is never indexed (robots.txt says the same).
      ...(isNonProductionDeployment()
        ? [{ source: "/(.*)", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }]
        : []),
    ];
  },
  async redirects() {
    return [
      ...(OTHER_HOST && APP_URL
        ? [{ source: "/:path*", has: [{ type: "host" as const, value: OTHER_HOST.replace(/\./g, "\\.") }], destination: `${APP_URL}/:path*`, permanent: true }]
        : []),
      // Trailing-slash normalisation handled by Next, but force https in case
      { source: "/index", destination: "/", permanent: true },
      { source: "/voor-monteurs", destination: "/monteur", permanent: true },
      { source: "/login", destination: "/inloggen", permanent: true },
      { source: "/register", destination: "/registreren", permanent: true },
      // SEO: a brand's repair page has ONE address, /<slug>-wasmachine-reparatie (the middleware serves it from
      // /reparatie/<slug>). The internal path used to answer 200 as a second copy.
      { source: "/reparatie/:merk", destination: "/:merk-wasmachine-reparatie", permanent: true },
      // Browsers and some crawlers ask for /favicon.ico whatever the page says; the icon is the generated /icon.
      { source: "/favicon.ico", destination: "/icon", permanent: false },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
