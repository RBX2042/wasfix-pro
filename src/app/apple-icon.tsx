import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          borderRadius: 40,
        }}
      >
        <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="3" fill="#fff" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
