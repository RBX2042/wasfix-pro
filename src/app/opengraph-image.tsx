import { ImageResponse } from "next/og";
import { catalogStats, formatCount } from "@/lib/catalog-stats";

const STATS = catalogStats();

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
          padding: 80,
          color: "#e8eefb",
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
        }}
      >
        {/* Brand badge top-left */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 50 }}>
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
            fontSize: 88,
            fontWeight: 500,
            lineHeight: 1.05,
            letterSpacing: "-0.035em",
            display: "flex",
            flexDirection: "column",
            marginBottom: 32,
          }}
        >
          <span>Wasmachine kapot?</span>
          <span style={{ display: "flex" }}>
            <span style={{ color: "#e8eefb" }}>Wij weten wat er&nbsp;</span>
            <span
              style={{
                background: "linear-gradient(180deg, #00d4ff, #4f8cff)",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              echt
            </span>
            <span style={{ color: "#e8eefb" }}>&nbsp;mis is.</span>
          </span>
        </div>

        <div style={{ display: "flex", color: "#b6c0d8", fontSize: 28, lineHeight: 1.4, maxWidth: 1000 }}>
          AI-diagnose in 60 seconden. Het juiste onderdeel. Stap-voor-stap reparatie.
        </div>

        {/* Bottom tags */}
        <div
          style={{
            position: "absolute",
            bottom: 80,
            left: 80,
            right: 80,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            color: "#7b88a6",
            fontSize: 22,
          }}
        >
          <div style={{ display: "flex", gap: 24 }}>
            <span>Powered by Gemini</span>
            <span>·</span>
            <span>{formatCount(STATS.errorCodes)} foutcodes</span>
            <span>·</span>
            <span>EU Right to Repair</span>
          </div>
          <div style={{ color: "#4f8cff", fontWeight: 500 }}>wasfix.nl</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
