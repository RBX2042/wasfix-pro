"use client";

import * as React from "react";
import Link from "next/link";

type Hit = {
  type: "foutcode" | "onderdeel" | "gids" | "help" | "blog" | "merk";
  title: string;
  subtitle?: string;
  url: string;
  score: number;
};

// Theme tokens (the modal lives in <body>, outside every page's palette scope, so it cannot use the
// redesign variables; they were undefined here and the panel was transparent).
const TYPE_LABEL: Record<Hit["type"], { label: string; color: string }> = {
  foutcode: { label: "Foutcode", color: "hsl(var(--warning))" },
  onderdeel: { label: "Onderdeel", color: "hsl(var(--primary))" },
  gids: { label: "Gids", color: "hsl(var(--success))" },
  help: { label: "Help", color: "hsl(var(--muted-foreground))" },
  blog: { label: "Blog", color: "hsl(var(--muted-foreground))" },
  merk: { label: "Merk", color: "hsl(var(--accent))" },
};
const KBD: React.CSSProperties = {
  background: "hsl(var(--muted))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 4,
  padding: "2px 6px",
  fontSize: 10,
  color: "hsl(var(--muted-foreground))",
  fontFamily: "var(--font-geist-mono), monospace",
};

// Site-wide search modal — opens via Cmd/Ctrl+K or click on nav search icon.
// Debounced fetch to /api/search?q= with 200ms delay.
export function SearchModal() {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<Hit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+K toggle
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    // Listen to custom event from nav button
    const onOpen = () => setOpen(true);
    window.addEventListener("wasfix-open-search", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("wasfix-open-search", onOpen);
    };
  }, []);

  // Focus input when opening
  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else { setQ(""); setHits([]); setActiveIdx(0); }
  }, [open]);

  // Debounced fetch
  React.useEffect(() => {
    if (q.length < 2) { setHits([]); setLoading(false); return; }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=15`, { signal: ctrl.signal });
        const data = await res.json();
        setHits(data.hits ?? []);
        setActiveIdx(0);
      } catch { /* ignore aborts */ } finally {
        setLoading(false);
      }
    }, 200);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  // Keyboard nav
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && hits[activeIdx]) {
      e.preventDefault();
      window.location.href = hits[activeIdx].url;
    }
  };

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "hsl(var(--overlay))",
        backdropFilter: "blur(8px)",
        display: "grid", placeItems: "start center",
        paddingTop: "10vh", paddingLeft: 16, paddingRight: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 640,
          background: "hsl(var(--popover))",
          color: "hsl(var(--popover-foreground))",
          border: "1px solid hsl(var(--border))",
          borderRadius: 14,
          boxShadow: "0 24px 60px -20px hsl(0 0% 0% / 0.45)",
          overflow: "hidden",
        }}
      >
        {/* Input */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid hsl(var(--border))" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Zoek foutcodes, onderdelen, gidsen..."
            style={{
              flex: 1,
              background: "transparent",
              border: 0,
              outline: "none",
              color: "hsl(var(--popover-foreground))",
              fontSize: 15,
              fontFamily: "inherit",
            }}
          />
          {loading && <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontFamily: "var(--font-geist-mono), monospace" }}>...</span>}
          <kbd style={KBD}>ESC</kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {hits.length === 0 && q.length >= 2 && !loading && (
            <div style={{ padding: 32, textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 14 }}>
              Geen resultaten voor &ldquo;{q}&rdquo;
              <div style={{ marginTop: 8, fontSize: 12.5 }}>
                Probeer een merk + foutcode (bv. &ldquo;bosch e18&rdquo;) of een onderdeel-type.
              </div>
            </div>
          )}
          {hits.length === 0 && q.length < 2 && (
            <div style={{ padding: 20 }}>
              <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10, fontFamily: "var(--font-geist-mono), monospace" }}>
                Snel naar
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
                {[
                  { label: "Bosch E18 foutcode", url: "/foutcodes/Bosch-E18" },
                  { label: "Miele F11 foutcode", url: "/foutcodes/Miele-F11" },
                  { label: "Afvoerpomp vervangen", url: "/gidsen/afvoerpomp-reinigen-vervangen" },
                  { label: "AI Diagnose", url: "/diagnose" },
                  { label: "Onderdelen-shop", url: "/onderdelen" },
                  { label: "Voor monteurs", url: "/monteur" },
                ].map((s) => (
                  <Link key={s.url} href={s.url} onClick={() => setOpen(false)} style={{ display: "block", padding: "8px 10px", borderRadius: 6, color: "hsl(var(--foreground))", textDecoration: "none", fontSize: 13 }}>
                    → {s.label}
                  </Link>
                ))}
              </div>
            </div>
          )}
          {hits.map((h, i) => {
            const meta = TYPE_LABEL[h.type];
            const active = i === activeIdx;
            return (
              <Link
                key={`${h.url}-${i}`}
                href={h.url}
                onClick={() => setOpen(false)}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 20px",
                  background: active ? "hsl(var(--primary) / 0.08)" : "transparent",
                  borderLeft: active ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                  color: "hsl(var(--popover-foreground))",
                  textDecoration: "none",
                  cursor: "pointer",
                }}
              >
                <span style={{
                  flexShrink: 0,
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  padding: "3px 8px",
                  borderRadius: 4,
                  background: "hsl(var(--muted))",
                  color: meta.color,
                  border: "1px solid hsl(var(--border))",
                  minWidth: 70,
                  textAlign: "center",
                }}>{meta.label}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.title}</div>
                  {h.subtitle && (
                    <div style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "hsl(var(--muted-foreground))" }}>
                      {h.subtitle}
                    </div>
                  )}
                </div>
                {active && (
                  <kbd style={KBD}>↵</kbd>
                )}
              </Link>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 20px", borderTop: "1px solid hsl(var(--border))", fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
          <div style={{ display: "flex", gap: 16 }}>
            <span><kbd style={KBD}>↑↓</kbd> navigeer</span>
            <span><kbd style={KBD}>↵</kbd> open</span>
          </div>
          <span>{hits.length > 0 ? `${hits.length} resultaten` : ""}</span>
        </div>
      </div>
    </div>
  );
}
