import { ImageResponse } from "next/og";
import { catalogStats, formatCount } from "@/lib/catalog-stats";
import { siteUrl } from "@/lib/site-url";

const STATS = catalogStats();

// The host printed on the card is the configured public address (NEXT_PUBLIC_APP_URL), not a literal.
// null when it is unusable (production without a proper address): then no host is printed at all.
const HOST = (() => {
  const url = siteUrl();
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
})();

export const alt = "WasFix Pro — AI wasmachine diagnose";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: "#060912",
          backgroundImage:
            "radial-gradient(1200px 600px at 70% -10%, rgba(79,140,255,0.30), transparent 60%), radial-gradient(900px 600px at 0% 0%, rgba(0,212,255,0.18), transparent 50%)",
          display: "flex",
          flexDirection: "column",
          padding: 72,
          color: "#e8eefb",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Brand badge top-left */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 36 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "linear-gradient(135deg, #4f8cff, #00d4ff)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 40px rgba(79,140,255,0.5)",
            }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
              <circle cx="12" cy="12" r="7" />
              <circle cx="12" cy="12" r="3" fill="#fff" />
            </svg>
          </div>
          <div style={{ display: "flex", fontSize: 32, fontWeight: 600, letterSpacing: "-0.01em" }}>
            <span style={{ color: "#e8eefb" }}>WasFix</span>
            <span style={{ color: "#7b88a6", marginLeft: 10 }}>Pro</span>
          </div>
        </div>

        {/* Big headline */}
        <div
          style={{
            fontSize: 68,
            fontWeight: 500,
            lineHeight: 1.05,
            letterSpacing: "-0.035em",
            display: "flex",
            flexDirection: "column",
            marginBottom: 24,
          }}
        >
          <span>Wasmachine kapot?</span>
          {/* The spaces between the three parts are a flex gap, not &nbsp;: the renderer drops a trailing/leading nbsp
              inside a flex item and the gradient word then printed on top of "de" (seen in the rendered PNG). */}
          <span style={{ display: "flex", gap: 16 }}>
            <span style={{ color: "#e8eefb" }}>Wij helpen je de</span>
            <span
              style={{
                background: "linear-gradient(180deg, #00d4ff, #4f8cff)",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              oorzaak
            </span>
            <span style={{ color: "#e8eefb" }}>te vinden.</span>
          </span>
        </div>

        <div style={{ display: "flex", color: "#b6c0d8", fontSize: 26, lineHeight: 1.4, maxWidth: 1000 }}>
          Een eerste AI-diagnose, het waarschijnlijke onderdeel en stap-voor-stap reparatie. Een indicatie, geen zekerheid.
        </div>

        {/* Bottom row: in the normal flow under the tagline (flex: 1 pushes it down), never positioned over it.
            No claim about the AI provider here: this image is the share card of every page, whatever is configured. */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "flex-end",
            justifyContent: "space-between",
            color: "#7b88a6",
            fontSize: 22,
          }}
        >
          <div style={{ display: "flex", gap: 24 }}>
            <span>{formatCount(STATS.errorCodes)} foutcodes</span>
            <span>·</span>
            <span>EU Right to Repair</span>
          </div>
          {HOST ? <div style={{ color: "#4f8cff", fontWeight: 500 }}>{HOST}</div> : null}
        </div>
      </div>
    ),
    { ...size },
  );
}
