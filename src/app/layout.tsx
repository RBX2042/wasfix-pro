import type { Metadata } from "next";
import { Inter, Syne, Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ConsentedAnalytics } from "@/components/ConsentedAnalytics";
import { ThemeProvider } from "@/components/theme-provider";
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
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const syne = Syne({ subsets: ["latin"], variable: "--font-syne", display: "swap" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

// The one address every relative canonical / og:url below resolves against. In
// production an unusable NEXT_PUBLIC_APP_URL (see src/lib/site-url.ts) falls back
// to the domain the product is built for, because metadataBase must be a URL; the
// build on Vercel refuses that state (next.config.ts), preflight reports it.
const SITE = siteUrl() ?? "https://wasfix.nl";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "WasFix Pro — AI wasmachine diagnose & onderdelen",
    template: "%s · WasFix Pro",
  },
  description: "Diagnostiseer je wasmachine met AI, vind de juiste reparatie en bestel originele onderdelen. Voor consumenten én monteurs.",
  keywords: ["wasmachine", "reparatie", "onderdelen", "foutcode", "diagnose", "AI", "Miele", "Bosch", "Samsung"],
  authors: [{ name: "WasFix Pro" }],
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" suppressHydrationWarning className={`${inter.variable} ${syne.variable} ${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-background font-sans antialiased">
        <AuthProviders>
          <PostHogProvider>
            <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
              <CartProvider>
                {children}
                <Toaster richColors position="top-right" />
              </CartProvider>
            </ThemeProvider>
          </PostHogProvider>
        </AuthProviders>
        <CookieConsent />
        <ExitIntentModal />
        <ReferralTracker />
        <MobileBottomNav />
        <SearchModal />
        <ServiceWorkerRegister />
        <ConsentedAnalytics />
      </body>
    </html>
  );
}
