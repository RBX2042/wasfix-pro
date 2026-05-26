import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ImageResponse } from "next/og";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { apiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Schema = z.object({
  brand: z.string().min(1).max(40),
  model: z.string().max(80).optional(),
  code: z.string().regex(/^[A-Z0-9]{6,12}$/).optional(),
});

// Generate a printable QR sticker PNG (800x1100) with QR + brand/model + scan-redirect.
// User can print on adhesive paper (Avery 6005 100x140mm) and stick on machine.
//
// QR is generated via api.qrserver.com (free, no key). The scan-target URL is
// https://wasfix.nl/qr/<CODE> which redirects to the saved-machine page in dashboard.
export async function GET(req: NextRequest) {
  if (!rateLimit(`qr:${getClientKey(req)}`, 10, 60 * 60 * 1000)) {
    return apiError("Te veel QR-aanvragen — probeer over een uur opnieuw.", 429);
  }

  const sp = req.nextUrl.searchParams;
  const parsed = Schema.safeParse({
    brand: sp.get("brand") ?? "",
    model: sp.get("model") ?? undefined,
    code: sp.get("code") ?? undefined,
  });
  if (!parsed.success) return apiError("Ongeldige QR-parameters", 400);

  // Generate a deterministic 8-char code if not provided
  const code = parsed.data.code ?? generateCode(parsed.data.brand, parsed.data.model ?? "");
  const scanUrl = `https://wasfix.nl/qr/${code}`;
  const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(scanUrl)}&size=520x520&margin=8&format=png&color=0b1224&bgcolor=ffffff`;

  try {
    return new ImageResponse(
      (
        <div style={{
          width: "100%", height: "100%",
          background: "#fff",
          display: "flex", flexDirection: "column",
          padding: 60,
          fontFamily: "system-ui, sans-serif",
        }}>
          {/* Header — brand strip */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 30 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: "linear-gradient(135deg, #4f8cff, #00d4ff)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                <circle cx="12" cy="12" r="7" />
                <circle cx="12" cy="12" r="3" fill="#fff" />
              </svg>
            </div>
            <div style={{ display: "flex", fontSize: 24, fontWeight: 500 }}>
              <span style={{ color: "#0b1224" }}>WasFix</span>
              <span style={{ color: "#7b88a6", marginLeft: 8 }}>Pro</span>
            </div>
          </div>

          {/* Machine info */}
          <div style={{ display: "flex", flexDirection: "column", marginBottom: 18 }}>
            <div style={{ fontSize: 18, color: "#6a7488", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Wasmachine
            </div>
            <div style={{ fontSize: 44, fontWeight: 600, color: "#0b1224", letterSpacing: "-0.02em", marginTop: 4 }}>
              {parsed.data.brand}
            </div>
            {parsed.data.model && (
              <div style={{ fontSize: 22, color: "#4a5568", marginTop: 4 }}>{parsed.data.model}</div>
            )}
          </div>

          {/* QR code */}
          <div style={{ display: "flex", justifyContent: "center", margin: "10px 0 24px" }}>
            <img src={qrImgUrl} width="520" height="520" alt="QR code" />
          </div>

          {/* Code label */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 14, color: "#6a7488", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Scan-code
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 28, fontWeight: 600, color: "#0b1224", letterSpacing: "0.1em", marginTop: 2 }}>
              {code}
            </div>
          </div>

          {/* Instructions */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "auto" }}>
            <div style={{ fontSize: 16, color: "#4a5568", textAlign: "center", lineHeight: 1.4 }}>
              Scan met je telefoon-camera voor:
            </div>
            <div style={{ fontSize: 14, color: "#6a7488", textAlign: "center", marginTop: 8, lineHeight: 1.5 }}>
              AI-diagnose · Onderdelen · Foutcodes · Reparatiegidsen
            </div>
            <div style={{ fontSize: 13, color: "#7b88a6", marginTop: 16, fontFamily: "monospace" }}>
              wasfix.nl/qr/{code}
            </div>
          </div>
        </div>
      ),
      { width: 800, height: 1100 }
    );
  } catch {
    return apiError("QR-generatie mislukt", 500);
  }
}

function generateCode(brand: string, model: string): string {
  // Deterministic 8-char code based on brand+model + random suffix
  const seed = `${brand}-${model}`.replace(/\s+/g, "").toUpperCase().slice(0, 4);
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${seed.padEnd(4, "X")}${rand}`;
}
