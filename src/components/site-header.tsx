"use client";
import Link from "next/link";
import { useCart, cartCount } from "./cart-provider";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Menu, X, Sparkles } from "lucide-react";
import * as React from "react";
import { CartDrawer } from "./cart-drawer";
import { AuthButtons } from "./auth-buttons";
import { ThemeToggle } from "./theme-toggle";

const navItems = [
  { href: "/diagnose", label: "AI Diagnose", desc: "Wat is er mis?", hot: true },
  { href: "/foutcodes", label: "Foutcodes", desc: "Zoek uw code" },
  { href: "/gidsen", label: "Gidsen", desc: "Zelf repareren" },
  { href: "/onderdelen", label: "Onderdelen", desc: "Bestel onderdelen" },
  { href: "/merken", label: "Merken", desc: "Per fabrikant" },
  { href: "/prijzen", label: "Prijzen", desc: "Plannen" },
];

export function SiteHeader() {
  const items = useCart((s) => s.items);
  const setOpen = useCart((s) => s.setOpen);
  const isOpen = useCart((s) => s.isOpen);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const count = mounted ? cartCount(items) : 0;

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-heading font-bold text-xl min-h-11">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </span>
            <span>WasFix<span className="text-accent">Pro</span></span>
          </Link>

          {/* The six links, the switch, the cart, the account button and the CTA need 1092 px (measured, compact links);
              the burger menu below takes over under 1120 px. It used to switch at 1024 px, where the row ran 13 px past
              the screen and "AI Diagnose" wrapped. */}
          <nav className="hidden min-[1120px]:flex items-center gap-1">
            {navItems.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className="px-2 xl:px-3 py-2 min-h-11 inline-flex items-center whitespace-nowrap text-sm font-medium text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
              >
                {it.label}
              </Link>
            ))}
          </nav>

          {/* Tight gaps while the burger menu is in use (under 1120 px): at 320 px the burger sat 1 px past the content edge, and
              at 640 and 768 px the row had no room to spare (signed in, Clerk's "Dashboard" + avatar is about 16 px wider than
              "Mijn account"). */}
          <div className="flex items-center gap-1 min-[1120px]:gap-2">
            {/* Below sm the switch lives in the mobile menu below and in the bottom bar. */}
            <div className="hidden sm:block"><ThemeToggle /></div>
            <Button variant="ghost" size="icon" onClick={() => setOpen(true)} className="relative h-11 w-11" aria-label={count > 0 ? `Winkelmand openen, ${count} ${count === 1 ? "artikel" : "artikelen"}` : "Winkelmand openen"}>
              <ShoppingCart className="h-5 w-5" />
              {count > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground">
                  {count}
                </span>
              )}
            </Button>
            <div className="hidden sm:flex items-center gap-2">
              <AuthButtons />
            </div>
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link href="/diagnose">Start diagnose</Link>
            </Button>
            <Button variant="ghost" size="icon" className="min-[1120px]:hidden h-11 w-11" onClick={() => setMobileOpen(!mobileOpen)} aria-label={mobileOpen ? "Menu sluiten" : "Menu openen"} aria-expanded={mobileOpen}>
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {mobileOpen && (
          <div className="min-[1120px]:hidden border-t bg-background">
            <nav className="container flex flex-col gap-1 py-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-3 mb-1">
                Waar kunnen we u mee helpen?
              </p>
              {navItems.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-3 py-3 hover:bg-muted rounded-md"
                >
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${it.hot ? "text-accent" : ""}`}>
                      {it.label}
                      {it.hot && " 🔥"}
                    </p>
                    {it.desc && <p className="text-xs text-muted-foreground">{it.desc}</p>}
                  </div>
                </Link>
              ))}
              {/* Below 480 px the label sits above the control and the control spans the row (it is 262-292 px wide and
                  did not fit beside the label on a 320-414 px phone); from 480 px they share one line. */}
              <div className="flex flex-col gap-2 px-3 pt-2 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between min-[480px]:gap-3">
                <span className="text-sm font-medium">Thema</span>
                <ThemeToggle variant="segmented" className="theme-toggle--fill-narrow" />
              </div>
              <div className="flex gap-2 pt-2 items-center">
                <AuthButtons onNavigate={() => setMobileOpen(false)} />
                <Button asChild size="sm" className="flex-1">
                  <Link href="/diagnose" onClick={() => setMobileOpen(false)}>Start diagnose</Link>
                </Button>
              </div>
            </nav>
          </div>
        )}
      </header>
      <CartDrawer open={mounted && isOpen} onOpenChange={setOpen} />
    </>
  );
}
