import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import QRCode from "qrcode";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { apiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Schema = z.object({
  brand: z.string().min(1).max(40),
  model: z.string().max(80).optional(),
  code: z.string().regex(/^[A-Z0-9]{6,12}$/).optional(),
  size: z.coerce.number().int().min(100).max(1024).optional().default(520),
});

// Returns a QR PNG that links to /qr/{code}. The styled sticker layout
// (brand/model around the QR) is rendered client-side at /tools/qr-sticker
// via HTML/CSS — this endpoint only returns the QR image itself.
export async function GET(req: NextRequest) {
  if (!(await rateLimit(`qr:${getClientKey(req)}`, 20, 60 * 60 * 1000))) {
    return apiError("Te veel QR-aanvragen — probeer over een uur opnieuw.", 429);
  }

  const sp = req.nextUrl.searchParams;
  const parsed = Schema.safeParse({
    brand: sp.get("brand") ?? "",
    model: sp.get("model") ?? undefined,
    code: sp.get("code") ?? undefined,
    size: sp.get("size") ?? undefined,
  });
  if (!parsed.success) return apiError("Ongeldige QR-parameters", 400);

  const code = parsed.data.code ?? generateCode(parsed.data.brand, parsed.data.model ?? "");
  const scanUrl = `https://wasfix.nl/qr/${code}`;

  try {
    const buffer = await QRCode.toBuffer(scanUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: parsed.data.size,
      color: { dark: "#0b1224", light: "#ffffff" },
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="wasfix-qr-${parsed.data.brand}-${code}.png"`,
        "Cache-Control": "public, max-age=3600",
        "X-QR-Code": code, // expose code in header for client to read
        "X-QR-Scan-URL": scanUrl,
      },
    });
  } catch (err) {
    console.error("[qr/generate] failed", err);
    return apiError("QR-generatie mislukt", 500);
  }
}

function generateCode(brand: string, model: string): string {
  const seed = `${brand}-${model}`.replace(/\s+/g, "").toUpperCase().slice(0, 4);
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${seed.padEnd(4, "X")}${rand}`;
}
