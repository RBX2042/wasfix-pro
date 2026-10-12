import type { Metadata, Viewport } from "next";
import { Inter, Syne, Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ConsentedAnalytics } from "@/components/ConsentedAnalytics";
import { ThemeProvider } from "@/components/theme-provider";
import { STORED_THEME_GUARD_SCRIPT, THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "@/components/theme-colors";
import { AuthProviders } from "@/components/auth-providers";
import { CartProvider } from "@/components/cart-provider";
import { CookieConsent } from "@/components/CookieConsent";
import { ExitIntentModal } from "@/components/ExitIntentModal";
import { ReferralTracker } from "@/components/ReferralTracker";
import { PostHogProvider } from "@/components/PostHogProvider";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { SearchModal } from "@/components/SearchModal";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { siteUrl } from "@/lib/site-url";
import { TITLE_SUFFIX, verificationMetadata } from "@/lib/seo";
import "./globals.css";

// Four families, 132 KB, all preloaded. Measured in decision D23 (Slow 4G, 4x CPU, median of 5): `preload: false` on
// Inter, Geist and Geist Mono left 3 to 4 font files downloaded on every page anyway (the bottom bar sets its text in
// Inter, the cookie banner in Geist), saved 22 KB on the shop pages and raised the layout shift of /diagnose from
// 0.036 to 0.056. Left as it is; the real saving is one font system, which is a design decision, not an SEO one.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const syne = Syne({ subsets: ["latin"], variable: "--font-syne", display: "swap" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

// The one address every relative canonical / og:url below resolves against. In
// production an unusable NEXT_PUBLIC_APP_URL (see src/lib/site-url.ts) falls back
// to the domain the product is built for, because metadataBase must be a URL; the
// build on Vercel refuses that state (next.config.ts), preflight reports it.
const SITE = siteUrl() ?? "https://wasfix.nl";

// Search-engine verification tags from GOOGLE_SITE_VERIFICATION / BING_SITE_VERIFICATION (src/lib/seo.ts): none when unset.
const VERIFICATION = verificationMetadata({
  GOOGLE_SITE_VERIFICATION: process.env.GOOGLE_SITE_VERIFICATION,
  BING_SITE_VERIFICATION: process.env.BING_SITE_VERIFICATION,
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "WasFix Pro — AI wasmachine diagnose & onderdelen",
    // The brand suffix is added here and nowhere else (src/lib/seo.ts pageTitle() strips a suffix a title brings).
    template: `%s${TITLE_SUFFIX}`,
  },
  description: "Diagnostiseer je wasmachine met AI, vind de juiste reparatie en bestel originele onderdelen. Voor consumenten én monteurs.",
  authors: [{ name: "WasFix Pro" }],
  // Optional search-engine verification tags (GOOGLE_SITE_VERIFICATION, BING_SITE_VERIFICATION); no tag when unset.
  // The meta keywords tag is gone: Google ignores it and Bing reads a stuffed one as a spam signal.
  ...(VERIFICATION ? { verification: VERIFICATION } : {}),
  openGraph: {
    title: "WasFix Pro",
    description: "AI-gestuurde wasmachine diagnose en onderdelen",
    // Relative to metadataBase and to the page being rendered, so /foutcodes says
    // /foutcodes, not the homepage. (It used to be the literal https://wasfix.nl.)
    url: "./",
    siteName: "WasFix Pro",
    locale: "nl_NL",
    type: "website",
  },
  // canonical "./" is resolved by Next against metadataBase and the route being
  // rendered, so every page that does not set its own canonical names ITSELF (and
  // never carries a query string, so /onderdelen?merk=X points at /onderdelen).
  // The earlier version here was an absolute https://wasfix.nl, inherited by 51 of
  // 68 pages, which declared them all duplicates of the homepage; "./" is not that.
  alternates: { canonical: "./" },
};

// Theme (decision D22). colorScheme is "light" and not "light dark" on purpose: light is the default whatever
// the operating system prefers, and "light dark" would let a dark phone paint a dark canvas for the instant
// before the stylesheet arrives. The dark theme is applied by next-themes (class on <html> plus an inline
// color-scheme), which overrides this. themeColor follows the phone's preference here; the provider rewrites
// the tags to the chosen theme once the page is up (components/theme-provider.tsx says why).
export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR_LIGHT },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR_DARK },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" suppressHydrationWarning className={`${inter.variable} ${syne.variable} ${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-background text-foreground font-sans antialiased">
        {/* Must stay above the provider: it removes a stored theme that is not light, dark or system before next-themes
            reads it (a value with whitespace made every page answer "Er is iets misgegaan"; theme-colors.ts says why). */}
        <script dangerouslySetInnerHTML={{ __html: STORED_THEME_GUARD_SCRIPT }} />
        {/* The provider wraps everything in <body>, the bottom bar and the modals included: the theme toggle
            in the bottom bar needs its context. Light by default, "system" is a choice (see theme-provider.tsx). */}
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <AuthProviders>
            <PostHogProvider>
              <CartProvider>
                {children}
                {/* Below the 64 px header: a toast at the very top covered the theme toggle, the cart button and the account
                    buttons for its four seconds on screen. */}
                <Toaster richColors position="top-right" offset={{ top: 76, right: 24 }} mobileOffset={{ top: 76, left: 16, right: 16 }} />
              </CartProvider>
            </PostHogProvider>
          </AuthProviders>
          <CookieConsent />
          <ExitIntentModal />
          <ReferralTracker />
          <MobileBottomNav />
          <SearchModal />
          <ServiceWorkerRegister />
          <ConsentedAnalytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
