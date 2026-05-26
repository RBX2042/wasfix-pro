"use client";

import * as React from "react";
import Link from "next/link";
import { useCart, cartCount } from "@/components/cart-provider";
import { CartDrawer } from "@/components/cart-drawer";
import "@/app/wasfix-design.css";

// Re-usable Icon (same set as WasFixHome)
export type IconName =
  | "arrow" | "sparkle" | "check" | "play" | "search" | "bolt" | "chart" | "package"
  | "shield" | "code" | "book" | "leaf" | "co2" | "repeat" | "camera" | "qr" | "user"
  | "cart" | "pulse" | "close" | "chevron" | "star" | "plus" | "mic" | "send";

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const props = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.75,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className,
  };
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    sparkle: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    play: <path d="M6 4v16l14-8z" fill="currentColor" stroke="none" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
    bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />,
    chart: <><path d="M3 3v18h18" /><path d="m7 14 4-4 4 4 5-5" /></>,
    package: <><path d="m3 7 9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></>,
    shield: <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3z" />,
    code: <><path d="m9 8-4 4 4 4" /><path d="m15 8 4 4-4 4" /></>,
    book: <><path d="M4 4h13a3 3 0 0 1 3 3v13H7a3 3 0 0 0-3 3z" /><path d="M4 4v17" /></>,
    leaf: <path d="M21 3c-9 0-18 7-18 18 0-9 9-9 12-12 1-1 3-1 4-2s2-3 2-4z" />,
    co2: <><circle cx="8" cy="12" r="4" /><circle cx="16" cy="12" r="4" /></>,
    repeat: <><path d="M17 1 21 5l-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>,
    camera: <><path d="M3 7h4l2-3h6l2 3h4v13H3z" /><circle cx="12" cy="13" r="4" /></>,
    qr: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3M20 14v3M14 20h3M20 17v4" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></>,
    cart: <><path d="M3 4h2l3 12h11l3-8H6" /><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /></>,
    pulse: <path d="M3 12h4l3-8 4 16 3-8h4" />,
    close: <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>,
    chevron: <path d="m9 6 6 6-6 6" />,
    star: <path d="M12 2.5 14.5 9h6.5l-5.3 4 2 6.5L12 16l-5.7 3.5 2-6.5L3 9h6.5z" fill="currentColor" strokeWidth={0} />,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
    send: <path d="m22 2-7 20-4-9-9-4z" />,
  };
  return <svg {...props}>{paths[name]}</svg>;
}

export function WasFixNav() {
  const items = useCart((s) => s.items);
  const setOpen = useCart((s) => s.setOpen);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const count = mounted ? cartCount(items) : 0;

  return (
    <nav className="nav">
      <div className="container nav-inner">
        <Link href="/" className="brand">
          <div className="brand-mark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="7" />
              <circle cx="12" cy="12" r="3" fill="currentColor" />
            </svg>
          </div>
          <div className="brand-name"><b>WasFix</b><span>Pro</span></div>
        </Link>
        <div className="nav-links">
          <Link className="nav-link" href="/diagnose">AI Diagnose</Link>
          <Link className="nav-link" href="/foutcodes">Foutcodes</Link>
          <Link className="nav-link" href="/onderdelen">Onderdelen</Link>
          <Link className="nav-link" href="/gidsen">Gidsen</Link>
          <Link className="nav-link" href="/prijzen">Prijzen</Link>
        </div>
        <div className="nav-cta">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setOpen(true)}
            aria-label="Winkelmand openen"
            style={{ position: "relative" }}
          >
            <Icon name="cart" size={14} />
            {count > 0 && (
              <span style={{
                position: "absolute", top: -4, right: -4,
                background: "linear-gradient(180deg, #5d97ff, #3b7aff)",
                color: "#fff", fontSize: 10, fontWeight: 600,
                minWidth: 16, height: 16, borderRadius: 8,
                display: "grid", placeItems: "center", padding: "0 4px",
                boxShadow: "0 0 12px rgba(79,140,255,0.6)",
              }}>{count}</span>
            )}
          </button>
          <Link className="btn btn-ghost btn-sm" href="/inloggen">Inloggen</Link>
          <Link className="btn btn-primary btn-sm" href="/diagnose">
            Start gratis <Icon name="arrow" size={14} />
          </Link>
        </div>
      </div>
    </nav>
  );
}

export function WasFixFooter() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <div className="brand" style={{ marginBottom: 14 }}>
              <div className="brand-mark">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="7" />
                  <circle cx="12" cy="12" r="3" fill="currentColor" />
                </svg>
              </div>
              <div className="brand-name"><b>WasFix</b><span>Pro</span></div>
            </div>
            <div className="muted" style={{ fontSize: 13.5, maxWidth: 320, lineHeight: 1.55 }}>
              AI-gestuurde wasmachine diagnose en originele onderdelen, voor consumenten en monteurs.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
              <span className="pill"><Icon name="leaf" size={11} /> EU Right to Repair</span>
              <span className="pill pill-mono">B Corp pending</span>
            </div>
          </div>
          <div>
            <div className="foot-h">Product</div>
            <div className="foot-l">
              <Link href="/diagnose">AI Diagnose</Link>
              <Link href="/onderdelen">Onderdelen</Link>
              <Link href="/gidsen">Reparatiegidsen</Link>
              <Link href="/foutcodes">Foutcodes database</Link>
              <Link href="/tools/repareren-of-vervangen">Repareren of vervangen?</Link>
            </div>
          </div>
          <div>
            <div className="foot-h">Bedrijf</div>
            <div className="foot-l">
              <Link href="/prijzen">Prijzen</Link>
              <Link href="/over">Over ons</Link>
              <Link href="/contact">Contact</Link>
            </div>
          </div>
          <div>
            <div className="foot-h">Support</div>
            <div className="foot-l">
              <Link href="/help">Helpcentrum</Link>
              <Link href="/contact">Contact</Link>
              <Link href="/garantie">Garantie</Link>
              <Link href="/retour/start">Retour starten</Link>
              <Link href="/klachten">Klachten</Link>
              <Link href="/voor-monteurs">Voor monteurs</Link>
            </div>
          </div>
          <div>
            <div className="foot-h">Juridisch</div>
            <div className="foot-l">
              <Link href="/privacy">Privacy</Link>
              <Link href="/voorwaarden">Voorwaarden</Link>
              <Link href="/cookies">Cookies</Link>
              <Link href="/disclaimer">DIY Disclaimer</Link>
              <Link href="/retourvoorwaarden">Retourvoorwaarden</Link>
            </div>
          </div>
        </div>

        {/* Top foutcodes — sterke interne linking voor SEO */}
        <div style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid var(--border)" }}>
          <div className="foot-h" style={{ marginBottom: 12 }}>Top foutcodes</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[
              { brand: "Bosch", codes: ["E18", "E17", "F21", "F23", "F43", "F63"] },
              { brand: "Miele", codes: ["F11", "F19", "F36", "F53", "F101"] },
              { brand: "Samsung", codes: ["OE", "dC", "HE", "5E", "4E"] },
              { brand: "LG", codes: ["UE", "DE", "HE", "OE", "LE"] },
              { brand: "AEG", codes: ["E20", "E40", "E61", "EHO"] },
            ].map(({ brand, codes }) =>
              codes.map((code) => (
                <Link
                  key={`${brand}-${code}`}
                  href={`/foutcodes/${encodeURIComponent(brand)}-${encodeURIComponent(code)}`}
                  className="pill pill-mono"
                  style={{ fontSize: 11, padding: "4px 9px", textDecoration: "none" }}
                >
                  {brand} <b style={{ color: "var(--acc-2)" }}>{code}</b>
                </Link>
              )),
            )}
          </div>
        </div>

        {/* Top onderdelen */}
        <div style={{ marginTop: 18 }}>
          <div className="foot-h" style={{ marginBottom: 12 }}>Populaire onderdelen</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[
              { sku: "WF-PUMP-04", label: "Samsung afvoerpomp" },
              { sku: "WF-FILTER-09", label: "Pluizenfilter" },
              { sku: "WF-HEAT-03", label: "Verwarmingselement 1800W" },
              { sku: "WF-BEAR-03", label: "Trommellager 6205" },
              { sku: "WF-BELT-06", label: "V-snaar 1196 J5" },
              { sku: "WF-LOCK-09", label: "Deurslot Bosch ZV-446" },
              { sku: "WF-NTC-15", label: "NTC sensor Bosch" },
              { sku: "WF-DOOR-04", label: "Deurpakking Bosch S6" },
              { sku: "WF-DAMP-16", label: "Schokdempers Bosch" },
              { sku: "WF-VALVE-08", label: "Magneetventiel" },
            ].map((p) => (
              <Link
                key={p.sku}
                href={`/onderdelen/${p.sku}`}
                className="pill"
                style={{ fontSize: 11.5, padding: "4px 10px", textDecoration: "none" }}
              >
                {p.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="foot-bottom" style={{ marginTop: 32 }}>
          <div>© 2026 WasFix Pro B.V. · KvK 12345678 · Made with care in The Netherlands.</div>
          <div className="mono" style={{ fontSize: 11.5 }}>Gemini 2.0 · Geist</div>
        </div>
      </div>
    </footer>
  );
}

// Shell wrapper that gives the page its dark background, nav and footer
export function WasFixShell({ children }: { children: React.ReactNode }) {
  const isOpen = useCart((s) => s.isOpen);
  const setOpen = useCart((s) => s.setOpen);
  return (
    <div className="wasfix-design">
      <div className="app-bg" />
      <div className="shell">
        <WasFixNav />
        {children}
        <WasFixFooter />
      </div>
      <CartDrawer open={isOpen} onOpenChange={setOpen} />
    </div>
  );
}
