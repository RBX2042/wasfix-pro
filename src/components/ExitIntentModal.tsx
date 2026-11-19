"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { track, EVT } from "@/lib/analytics";
import { exitIntentAllowed } from "@/components/exit-intent-routes";

// Exit-intent modal — triggers when mouse moves up to browser chrome (desktop)
// or scroll-up-fast on mobile. Offers a lead magnet (printable cheatsheet) in
// exchange for an e-mail address; the download link is shown on the spot.

const STORAGE_KEY = "wasfix-exit-shown";
const FEATURE_FLAG = process.env.NEXT_PUBLIC_FEATURE_EXIT_INTENT !== "false";

// Web storage can refuse to answer: site data blocked in the browser settings, a private window, a full quota. An
// unguarded call then throws inside an effect and every page that mounts this component (the home page and the part
// list among them) answers "Er is iets misgegaan". The offer remembers that it was shown or dismissed in storage; a
// browser that cannot remember would show it again on every visit, so with storage unreadable it is not shown at all.
function storageUsable(): boolean {
  try {
    window.sessionStorage.getItem(STORAGE_KEY);
    window.localStorage.getItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
function remember(area: "sessionStorage" | "localStorage", value: string) {
  try {
    window[area].setItem(STORAGE_KEY, value);
  } catch {
    /* blocked or full: the offer simply is not remembered */
  }
}

export function ExitIntentModal() {
  const pathname = usePathname() ?? "/";
  const allowed = exitIntentAllowed(pathname);
  const [open, setOpen] = React.useState(false);
  const [downloadUrl, setDownloadUrl] = React.useState("/leadmagnets/foutcodes-cheatsheet.html");
  const [email, setEmail] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "submitting" | "done" | "error">("idle");
  // What the server did with the newsletter half of the sign-up (see src/lib/newsletter.ts); null = unknown.
  const [newsletterStatus, setNewsletterStatus] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!FEATURE_FLAG || !allowed) return;
    if (typeof window === "undefined") return;
    // Don't show if already shown this session or user dismissed in last 7 days
    if (!storageUsable()) return;
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
        remember("sessionStorage", "1");
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
        remember("sessionStorage", "1");
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
  }, [allowed]);

  // Navigating into a blocked page while it is open closes it.
  React.useEffect(() => {
    if (!allowed) setOpen(false);
  }, [allowed]);

  const dismiss = () => {
    setOpen(false);
    remember("localStorage", String(Date.now()));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setStatus("submitting");
    try {
      const res = await fetch("/api/lead-magnet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, magnetId: "foutcodes-cheatsheet", source: "exit-intent" }),
      });
      if (!res.ok) { setStatus("error"); return; }
      const data = (await res.json().catch(() => null)) as { url?: string; newsletter?: string } | null;
      if (data?.url && data.url.startsWith("/")) setDownloadUrl(data.url);
      setNewsletterStatus(data?.newsletter ?? null);
      setStatus("done");
      track(EVT.NEWSLETTER_SIGNUP, { source: "exit-intent" });
      remember("localStorage", String(Date.now()));
    } catch {
      setStatus("error");
    }
  }

  if (!open || !allowed) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Gratis cheatsheet aanbieding"
      onClick={dismiss}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "hsl(var(--overlay))",
        backdropFilter: "blur(8px)",
        display: "grid", placeItems: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 480, width: "100%",
          // Theme tokens, not literals: this modal opens over any page in either theme.
          background: "hsl(var(--popover))",
          border: "1px solid hsl(var(--border))",
          borderRadius: 18,
          padding: "30px 28px",
          boxShadow: "0 32px 80px -20px hsl(0 0% 0% / 0.45)",
          color: "hsl(var(--popover-foreground))",
          fontFamily: "var(--font-geist), system-ui, sans-serif",
          position: "relative",
        }}
      >
        <button
          onClick={dismiss}
          aria-label="Sluit"
          style={{
            position: "absolute", top: 14, right: 14,
            background: "transparent", border: 0, color: "hsl(var(--muted-foreground))",
            fontSize: 26, cursor: "pointer", lineHeight: 1, padding: 0, width: 44, height: 44,
          }}
        >×</button>

        <div style={{ fontSize: 40, marginBottom: 12 }}>🎁</div>

        {status !== "done" ? (
          <>
            <h2 style={{ fontSize: 22, fontWeight: 500, marginBottom: 8, letterSpacing: "-0.015em" }}>
              Wacht — krijg gratis onze cheatsheet
            </h2>
            <p style={{ color: "hsl(var(--muted-foreground))", fontSize: 14, lineHeight: 1.55, marginBottom: 18 }}>
              De <strong style={{ color: "hsl(var(--foreground))" }}>meest voorkomende wasmachine foutcodes</strong> met de oplossing per code, om te printen of op te slaan. Na je aanmelding staat de download direct klaar.
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
                  padding: "0 14px",
                  minHeight: 44,
                  background: "hsl(var(--background))",
                  border: "1px solid hsl(var(--input))",
                  borderRadius: 8,
                  color: "hsl(var(--foreground))",
                  fontSize: 14,
                  fontFamily: "inherit",
                  // No `outline: "none"`: the keyboard focus ring is the browser's own (a field without one is invisible to a keyboard user).
                }}
              />
              <button
                type="submit"
                disabled={status === "submitting"}
                style={{
                  background: "hsl(var(--primary))",
                  color: "hsl(var(--primary-foreground))",
                  border: 0,
                  borderRadius: 8,
                  padding: "0 18px",
                  minHeight: 44,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 14,
                  boxShadow: "0 6px 16px -8px hsl(var(--primary) / 0.6)",
                }}
              >
                {status === "submitting" ? "..." : "Download"}
              </button>
            </form>

            {status === "error" && (
              <p style={{ color: "hsl(var(--destructive))", fontSize: 12, marginTop: 8 }}>
                Probeer het later opnieuw — controleer je e-mailadres.
              </p>
            )}

            <p style={{ color: "hsl(var(--muted-foreground))", fontSize: 11, marginTop: 14, lineHeight: 1.5 }}>
              Je krijgt de cheatsheet meteen. Daarnaast sturen we je een e-mail om je aanmelding voor de nieuwsbrief te bevestigen; zonder jouw klik daarin sturen we je geen nieuwsbrief. Afmelden kan altijd via de link in elke nieuwsbrief. We delen je e-mailadres niet met derden.
            </p>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 8 }}>Bedankt, je cheatsheet staat klaar</h2>
            <p style={{ color: "hsl(var(--muted-foreground))", fontSize: 14, lineHeight: 1.55, marginBottom: 18 }}>
              We sturen de cheatsheet niet per e-mail. Open hem hieronder; met Ctrl+P (of &lsquo;Deel&rsquo; op je telefoon) bewaar je hem als PDF.{" "}
              {newsletterStatus === "mail_sent"
                ? "Voor de nieuwsbrief hebben we je een bevestigingsmail gestuurd; je bent pas aangemeld als je daarin op de link klikt."
                : newsletterStatus === "already_subscribed"
                  ? "Je was al aangemeld voor de nieuwsbrief."
                  : "De bevestigingsmail voor de nieuwsbrief is niet verstuurd, dus je bent niet aangemeld voor de nieuwsbrief."}
            </p>
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 44,
                background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", borderRadius: 8,
                padding: "0 18px", fontWeight: 500, fontSize: 14, textDecoration: "none", marginRight: 10,
              }}
            >
              Open de cheatsheet
            </a>
            <button
              onClick={dismiss}
              style={{
                background: "transparent",
                color: "hsl(var(--primary))",
                border: "1px solid hsl(var(--primary))",
                borderRadius: 8,
                padding: "0 18px",
                minHeight: 44,
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
