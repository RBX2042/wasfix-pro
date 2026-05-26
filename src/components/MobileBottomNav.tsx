"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart, cartCount } from "@/components/cart-provider";

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
      aria-label="Mobile navigation"
      className="mobile-bottom-nav"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        background: "rgba(11, 14, 28, 0.92)",
        backdropFilter: "saturate(140%) blur(16px)",
        WebkitBackdropFilter: "saturate(140%) blur(16px)",
        borderTop: "1px solid rgba(255,255,255,0.08)",
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
                padding: "8px 12px",
                color: active ? "#5d97ff" : "rgba(232,238,251,0.6)",
                textDecoration: "none",
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: "0.02em",
                minWidth: 56,
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
          aria-label="Cart"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            padding: "8px 12px",
            color: count > 0 ? "#5d97ff" : "rgba(232,238,251,0.6)",
            background: "transparent",
            border: 0,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.02em",
            minWidth: 56,
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
          <span>Cart</span>
          {count > 0 && (
            <span style={{
              position: "absolute",
              top: 4, right: 8,
              background: "#5d97ff",
              color: "#fff",
              fontSize: 9,
              fontWeight: 600,
              minWidth: 16, height: 16,
              borderRadius: 8,
              display: "grid", placeItems: "center",
              padding: "0 4px",
            }}>{count}</span>
          )}
        </button>
      </div>

      <style>{`
        @media (max-width: 767px) { .mobile-bottom-nav { display: block !important; } body { padding-bottom: 76px; } }
      `}</style>
    </nav>
  );
}
