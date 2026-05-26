import { NextResponse, type NextRequest } from "next/server";
import { locales, defaultLocale, type Locale } from "@/i18n/config";

const isDemoMode = process.env.DEMO_MODE === "true" || !process.env.CLERK_SECRET_KEY;
const FEATURE_I18N = process.env.NEXT_PUBLIC_FEATURE_I18N === "true";

const protectedPaths = ["/dashboard", "/admin", "/monteur/dashboard", "/monteur/klanten", "/monteur/onderdelen", "/monteur/werkorders"];

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

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ─── i18n geo-detection (feature-flagged) ─────────────────────────
  // Until pages are migrated under [locale]/, this only sets a hint cookie
  // so the homepage can show "Try EN version?" banner.
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
  } else {
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
  }

  // ─── Auth gating ──────────────────────────────────────────────────
  if (isDemoMode) return NextResponse.next();

  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  try {
    const { clerkMiddleware, createRouteMatcher } = await import("@clerk/nextjs/server");
    const matcher = createRouteMatcher(["/dashboard(.*)", "/monteur/dashboard(.*)", "/monteur/klanten(.*)", "/monteur/onderdelen(.*)", "/monteur/werkorders(.*)", "/admin(.*)"]);
    return (clerkMiddleware as never as (handler: (auth: { protect(): Promise<void> }, request: NextRequest) => Promise<NextResponse | undefined> | NextResponse | undefined) => (req: NextRequest) => Promise<NextResponse | undefined>)(async (auth, request) => {
      if (matcher(request)) await auth.protect();
      return undefined;
    })(req);
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)",
  ],
};
