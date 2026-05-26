"use client";

import * as React from "react";
import { track, EVT } from "@/lib/analytics";

// Exit-intent modal — triggers when mouse moves up to browser chrome (desktop)
// or scroll-up-fast on mobile. Offers a lead magnet (PDF cheatsheet) in exchange
// for email signup.

const STORAGE_KEY = "wasfix-exit-shown";
const FEATURE_FLAG = process.env.NEXT_PUBLIC_FEATURE_EXIT_INTENT !== "false";

export function ExitIntentModal() {
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "submitting" | "done" | "error">("idle");

  React.useEffect(() => {
    if (!FEATURE_FLAG) return;
    if (typeof window === "undefined") return;
    // Don't show if already shown this session or user dismissed in last 7 days
    if (sessionStorage.getItem(STORAGE_KEY)) return;
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (dismissed && Date.now() - parseInt(dismissed, 10) < 7 * 24 * 60 * 60 * 1000) return;

    let triggered = false;
    let lastTouchY = 0;

    const onMouseLeave = (e: MouseEvent) => {
      if (triggered) return;
      // Only fire on top-edge exit (going to tab bar or URL)
      if (e.clientY <= 0) {
        triggered = true;
        setOpen(true);
        sessionStorage.setItem(STORAGE_KEY, "1");
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (triggered) return;
      const currentY = e.touches[0].clientY;
      // Scroll up FAST from near top
      if (currentY - lastTouchY > 100 && window.scrollY < 50) {
        triggered = true;
        setOpen(true);
        sessionStorage.setItem(STORAGE_KEY, "1");
      }
      lastTouchY = currentY;
    };

    document.addEventListener("mouseleave", onMouseLeave);
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });

    return () => {
      document.removeEventListener("mouseleave", onMouseLeave);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  const dismiss = () => {
    setOpen(false);
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setStatus("submitting");
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "exit-intent-magnet" }),
      });
      if (!res.ok) { setStatus("error"); return; }
      setStatus("done");
      track(EVT.NEWSLETTER_SIGNUP, { source: "exit-intent" });
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      setStatus("error");
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Gratis cheatsheet aanbieding"
      onClick={dismiss}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(6, 9, 18, 0.78)",
        backdropFilter: "blur(8px)",
        display: "grid", placeItems: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 480, width: "100%",
          background: "linear-gradient(135deg, rgba(11,14,28,1), rgba(20,28,52,1))",
          border: "1px solid rgba(79,140,255,0.3)",
          borderRadius: 18,
          padding: "30px 28px",
          boxShadow: "0 32px 80px -20px rgba(79,140,255,0.4)",
          color: "#e8eefb",
          fontFamily: "var(--font-geist), system-ui, sans-serif",
          position: "relative",
        }}
      >
        <button
          onClick={dismiss}
          aria-label="Sluit"
          style={{
            position: "absolute", top: 14, right: 14,
            background: "transparent", border: 0, color: "rgba(232,238,251,0.5)",
            fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 4,
          }}
        >×</button>

        <div style={{ fontSize: 40, marginBottom: 12 }}>🎁</div>

        {status !== "done" ? (
          <>
            <h2 style={{ fontSize: 22, fontWeight: 500, marginBottom: 8, letterSpacing: "-0.015em" }}>
              Wacht — krijg gratis onze cheatsheet
            </h2>
            <p style={{ color: "rgba(232,238,251,0.75)", fontSize: 14, lineHeight: 1.55, marginBottom: 18 }}>
              De <strong style={{ color: "#fff" }}>25 meest voorkomende wasmachine foutcodes</strong> + directe oplossing per code. Gratis PDF, direct in je inbox.
            </p>

            <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="email"
                placeholder="je@email.nl"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={status === "submitting"}
                style={{
                  flex: 1, minWidth: 200,
                  padding: "11px 14px",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 8,
                  color: "#fff",
                  fontSize: 14,
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
              <button
                type="submit"
                disabled={status === "submitting"}
                style={{
                  background: "linear-gradient(180deg, #5d97ff, #3b7aff)",
                  color: "#fff",
                  border: 0,
                  borderRadius: 8,
                  padding: "11px 18px",
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 14,
                  boxShadow: "0 6px 16px -6px rgba(79,140,255,0.6)",
                }}
              >
                {status === "submitting" ? "..." : "Stuur PDF"}
              </button>
            </form>

            {status === "error" && (
              <p style={{ color: "#ff8080", fontSize: 12, marginTop: 8 }}>
                Probeer het later opnieuw — controleer je e-mailadres.
              </p>
            )}

            <p style={{ color: "rgba(232,238,251,0.45)", fontSize: 11, marginTop: 14, lineHeight: 1.5 }}>
              Geen spam, wekelijkse nieuwsbrief, altijd opzegbaar. We delen je e-mailadres nooit met derden.
            </p>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 8 }}>Check je inbox</h2>
            <p style={{ color: "rgba(232,238,251,0.75)", fontSize: 14, lineHeight: 1.55, marginBottom: 18 }}>
              We hebben de cheatsheet naar <strong>{email}</strong> gestuurd. Niet aangekomen binnen 5 min? Check spam.
            </p>
            <button
              onClick={dismiss}
              style={{
                background: "transparent",
                color: "#7eb3ff",
                border: "1px solid rgba(126,179,255,0.3)",
                borderRadius: 8,
                padding: "9px 18px",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 13,
              }}
            >
              Sluit
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
