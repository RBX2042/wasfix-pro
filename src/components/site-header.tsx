"use client";
import Link from "next/link";
import { useCart, cartCount } from "./cart-provider";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Menu, X, Sparkles } from "lucide-react";
import * as React from "react";
import { CartDrawer } from "./cart-drawer";

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
          <Link href="/" className="flex items-center gap-2 font-heading font-bold text-xl">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </span>
            <span>WasFix<span className="text-accent">Pro</span></span>
          </Link>

          <nav className="hidden lg:flex items-center gap-1">
            {navItems.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
              >
                {it.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setOpen(true)} className="relative">
              <ShoppingCart className="h-5 w-5" />
              {count > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground">
                  {count}
                </span>
              )}
            </Button>
            <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
              <Link href="/inloggen">Inloggen</Link>
            </Button>
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link href="/diagnose">Start diagnose</Link>
            </Button>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(!mobileOpen)}>
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {mobileOpen && (
          <div className="lg:hidden border-t bg-background">
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
              <div className="flex gap-2 pt-2">
                <Button asChild variant="outline" size="sm" className="flex-1">
                  <Link href="/inloggen" onClick={() => setMobileOpen(false)}>Inloggen</Link>
                </Button>
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
