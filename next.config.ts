import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  openAnalyzer: false,
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const IS_PROD = process.env.NODE_ENV === "production";

// Content Security Policy — tight but functional for our stack.
// In dev we relax it so HMR + React Refresh work.
const CSP = [
  "default-src 'self'",
  // Next inline scripts + Vercel Analytics + PostHog (when added)
  `script-src 'self' 'unsafe-inline' ${IS_PROD ? "" : "'unsafe-eval'"} https://va.vercel-scripts.com https://*.vercel-analytics.com https://*.posthog.com https://www.googletagmanager.com https://js.stripe.com`,
  // Tailwind / inline styles for SSR-streamed content
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https://*.supabase.co https://images.unsplash.com https://cdn.jsdelivr.net https://img.clerk.com https://placehold.co https://*.gravatar.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://*.supabase.co https://*.clerk.accounts.dev https://api.stripe.com https://*.posthog.com https://va.vercel-scripts.com https://*.vercel-analytics.com https://generativelanguage.googleapis.com",
  "frame-src 'self' https://js.stripe.com https://*.youtube-nocookie.com https://www.youtube.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
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
          {
            key: IS_PROD ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
            value: CSP,
          },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: APP_URL },
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
    ];
  },
  async redirects() {
    return [
      // Trailing-slash normalisation handled by Next, but force https in case
      { source: "/index", destination: "/", permanent: true },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
