import { NextResponse, type NextRequest } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { locales, defaultLocale, type Locale } from "@/i18n/config";
import brandsData from "@/data/brands.json";
import { isDemoMode } from "@/lib/demo-mode";

// Clerk runs whenever we're not in demo mode. isDemoMode() (see
// lib/demo-mode.ts) is the single source of truth for that decision — in
// particular, it does NOT let missing Clerk keys silently enable demo mode
// in production, which would otherwise auto-admin every visitor on a
// half-configured deploy.
const CLERK_ENABLED = !isDemoMode();
const FEATURE_I18N = process.env.NEXT_PUBLIC_FEATURE_I18N === "true";

// Brand-page SEO URLs: /bosch-wasmachine-reparatie → /reparatie/bosch (rewrite, not redirect)
const BRAND_SLUGS = new Set((brandsData as Array<{ slug: string }>).map((b) => b.slug));

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/admin(.*)",
  "/monteur/dashboard(.*)",
  "/monteur/klanten(.*)",
  "/monteur/onderdelen(.*)",
  "/monteur/werkorders(.*)",
  "/api/orders(.*)",
  "/api/user(.*)",
  "/api/account(.*)",
  "/api/dashboard(.*)",
]);

function detectLocale(req: NextRequest): Locale {
  const country = req.headers.get("x-vercel-ip-country") ?? "";
  const geoMap: Record<string, Locale> = {
    NL: "nl", BE: "nl",
    DE: "de", AT: "de", CH: "de",
    FR: "fr", LU: "fr", MC: "fr",
  };
  if (geoMap[country]) return geoMap[country];

  const accept = req.headers.get("accept-language") ?? "";
  const langs = accept.split(",").map((l) => l.split(";")[0].trim().slice(0, 2).toLowerCase());
  for (const lang of langs) {
    if ((locales as readonly string[]).includes(lang)) return lang as Locale;
  }
  return defaultLocale;
}

/** Everything that is not auth: SEO rewrites + i18n hints. */
function siteMiddleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // ─── Brand-page SEO URL rewrite ──────────────────────────────────
  // /bosch-wasmachine-reparatie → internally serves /reparatie/bosch
  const brandMatch = pathname.match(/^\/([a-z0-9]+)-wasmachine-reparatie\/?$/i);
  if (brandMatch && BRAND_SLUGS.has(brandMatch[1].toLowerCase())) {
    const url = req.nextUrl.clone();
    url.pathname = `/reparatie/${brandMatch[1].toLowerCase()}`;
    return NextResponse.rewrite(url);
  }

  // ─── i18n geo-detection (feature-flagged) ─────────────────────────
  if (FEATURE_I18N) {
    const segments = pathname.split("/").filter(Boolean);
    const hasLocalePrefix = (locales as readonly string[]).includes(segments[0] ?? "");
    if (!hasLocalePrefix && !pathname.startsWith("/api") && !pathname.startsWith("/_next")) {
      const cookieLocale = req.cookies.get("wasfix-locale")?.value as Locale | undefined;
      const target = cookieLocale && (locales as readonly string[]).includes(cookieLocale)
        ? cookieLocale
        : detectLocale(req);
      if (target !== defaultLocale) {
        const url = req.nextUrl.clone();
        url.pathname = `/${target}${pathname}`;
        const res = NextResponse.redirect(url);
        res.cookies.set("wasfix-locale", target, { maxAge: 60 * 60 * 24 * 365, path: "/" });
        return res;
      }
    }
    return NextResponse.next();
  }

  // Hint cookie for "Try EN" banner
  const hinted = req.cookies.get("wasfix-locale-suggested")?.value;
  if (!hinted && !pathname.startsWith("/api") && !pathname.startsWith("/_next")) {
    const detected = detectLocale(req);
    if (detected !== defaultLocale) {
      const res = NextResponse.next();
      res.cookies.set("wasfix-locale-suggested", detected, { maxAge: 60 * 60 * 24 * 30, path: "/" });
      return res;
    }
  }
  return NextResponse.next();
}

// With Clerk configured, clerkMiddleware runs on every matched request so
// auth()/currentUser() work in any server component or route handler, and
// protected routes redirect to /inloggen when signed out.
const withClerk = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      const { userId } = await auth();
      if (!userId) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    } else {
      await auth.protect();
    }
  }
  return siteMiddleware(req);
});

export default function middleware(req: NextRequest, event: Parameters<typeof withClerk>[1]) {
  if (CLERK_ENABLED) return withClerk(req, event);
  return siteMiddleware(req);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|offline.html|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|pdf|html)$).*)",
  ],
};
