import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #4f8cff, #00d4ff)",
          borderRadius: 7,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)",
        }}
      >
        {/* Brand mark: outer ring + inner filled circle */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="3" fill="#fff" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
