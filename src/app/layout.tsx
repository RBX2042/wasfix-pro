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
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const syne = Syne({ subsets: ["latin"], variable: "--font-syne", display: "swap" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://wasfix.nl"),
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
    url: "https://wasfix.nl",
    siteName: "WasFix Pro",
    locale: "nl_NL",
    type: "website",
  },
  // NOTE: deliberately no `alternates.canonical` here. Next.js inherits root
  // metadata into every route that does not override it, so a static absolute
  // canonical made 51 of 68 pages declare themselves duplicates of the
  // homepage — including /onderdelen, /foutcodes, /diagnose and /merken. Pages
  // that want one set it themselves; the rest emit none, which is safe.
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
