"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart, cartCount } from "@/components/cart-provider";
import { ThemeToggle } from "@/components/theme-toggle";

const ITEMS = [
  { href: "/", label: "Home", icon: "M3 12 12 3l9 9-1 1v8h-5v-6h-6v6H5v-8z" },
  { href: "/diagnose", label: "Diagnose", icon: "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" },
  { href: "/foutcodes", label: "Codes", icon: "m9 8-4 4 4 4M15 8l4 4-4 4" },
  { href: "/onderdelen", label: "Shop", icon: "M3 4h2l3 12h11l3-8H6" },
];

// Mobile-only sticky bottom nav. Visible <768px.
export function MobileBottomNav() {
  const pathname = usePathname();
  const items = useCart((s) => s.items);
  const setOpen = useCart((s) => s.setOpen);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const count = mounted ? cartCount(items) : 0;

  // Hide on admin/dashboard pages
  if (pathname.startsWith("/admin") || pathname.startsWith("/dashboard") || pathname.startsWith("/checkout")) return null;

  return (
    <nav
      aria-label="Mobiele navigatie"
      className="mobile-bottom-nav"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        // Colours come from --mbn-* below (the theme tokens), not from literals: this bar sits
        // under every page of both themes.
        background: "var(--mbn-bg)",
        backdropFilter: "saturate(140%) blur(16px)",
        WebkitBackdropFilter: "saturate(140%) blur(16px)",
        borderTop: "1px solid var(--mbn-border)",
        padding: "8px 8px max(8px, env(safe-area-inset-bottom))",
        display: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", maxWidth: 500, margin: "0 auto" }}>
        {ITEMS.map((it) => {
          const active = pathname === it.href || (it.href !== "/" && pathname.startsWith(it.href));
          return (
            <Link
              key={it.href}
              href={it.href}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                padding: "8px 4px",
                color: active ? "var(--mbn-active)" : "var(--mbn-fg)",
                textDecoration: "none",
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.02em",
                minWidth: 48,
                minHeight: 44,
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d={it.icon} />
              </svg>
              <span>{it.label}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setOpen(true)}
          aria-label="Winkelmand openen"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            padding: "8px 4px",
            color: count > 0 ? "var(--mbn-active)" : "var(--mbn-fg)",
            background: "transparent",
            border: 0,
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.02em",
            minWidth: 48,
            minHeight: 44,
            cursor: "pointer",
            position: "relative",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 4h2l3 12h11l3-8H6" />
            <circle cx="9" cy="20" r="1.5" />
            <circle cx="18" cy="20" r="1.5" />
          </svg>
          <span>Mand</span>
          {count > 0 && (
            <span style={{
              position: "absolute",
              top: 4, right: 8,
              background: "var(--mbn-badge-bg)",
              color: "var(--mbn-badge-fg)",
              fontSize: 10,
              fontWeight: 600,
              minWidth: 16, height: 16,
              borderRadius: 8,
              display: "grid", placeItems: "center",
              padding: "0 4px",
            }}>{count}</span>
          )}
        </button>
        {/* The sixth item: Licht / Donker / Systeem. This bar is the switch's home on a phone, where the headers
            have no room for it; it opens upward. */}
        <ThemeToggle label="Thema" placement="top-end" className="mbn-theme" />
      </div>

      <style>{`
        .mobile-bottom-nav {
          --mbn-bg: hsl(var(--background) / 0.92);
          --mbn-border: hsl(var(--border));
          --mbn-fg: hsl(var(--muted-foreground));
          --mbn-active: hsl(var(--primary));
          --mbn-badge-bg: hsl(var(--primary));
          --mbn-badge-fg: hsl(var(--primary-foreground));
        }
        /* On the redesign pages (home, diagnose, legal, blog, tools) wasfix-design.css overrides these six with that
           palette's colours, so the bar matches the page behind it: this bar is rendered by the root layout, outside the
           scope whose variables hold that palette. */
        /* The toggle item looks like its neighbours: icon over a small label. */
        .mobile-bottom-nav .mbn-theme .theme-toggle__trigger {
          flex-direction: column; gap: 4px; width: auto; min-width: 48px; height: auto; min-height: 44px;
          padding: 8px 4px; font-size: 11px; font-weight: 500; letter-spacing: 0.02em; color: var(--mbn-fg); border-radius: 0;
        }
        .mobile-bottom-nav .mbn-theme .theme-toggle__trigger[aria-expanded="true"] { color: var(--mbn-active); background: transparent; }
        .mobile-bottom-nav .mbn-theme .theme-toggle__panel { right: -4px; }
        @media (max-width: 767px) { .mobile-bottom-nav { display: block !important; } body { padding-bottom: 76px; } }
      `}</style>
    </nav>
  );
}
