import { NextRequest, NextResponse } from "next/server";
import { extractApiKey, validateApiKey } from "@/lib/api-auth";
import { staticErrorCode } from "@/lib/static-db";
import { rateLimit } from "@/lib/ratelimit";
import { pickArr } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, X-API-Key, Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ brand: string; code: string }> }) {
  const apiKey = extractApiKey(req);
  const auth = await validateApiKey(apiKey);
  if (!auth) {
    return NextResponse.json({ error: "Invalid or missing API key", docs: "https://wasfix.nl/api-docs" }, { status: 401, headers: CORS });
  }
  if (!auth.scopes.includes("read:errorcodes")) {
    return NextResponse.json({ error: "Insufficient scope: requires 'read:errorcodes'" }, { status: 403, headers: CORS });
  }

  if (!(await rateLimit(`v1:codes:${auth.keyId}`, auth.rateLimit, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "Rate limit exceeded", retry_after: 3600 }, { status: 429, headers: CORS });
  }

  const { brand, code } = await params;
  const ec = staticErrorCode(decodeURIComponent(brand), decodeURIComponent(code));
  if (!ec) {
    return NextResponse.json({ error: "Error code not found", brand, code }, { status: 404, headers: CORS });
  }

  const out = {
    brand: ec.machine.brand,
    model: ec.machine.model,
    code: ec.code,
    title: ec.title,
    description: ec.description,
    likelyCauses: pickArr(ec.likelyCauses),
    severity: ec.severity,
    diyFriendly: ec.diyFriendly,
    relatedParts: ec.parts.map((ep) => ({ sku: ep.part.sku, name: ep.part.name, priceEur: ep.part.priceEur })),
    relatedGuides: ec.guides.map((eg) => ({ slug: eg.guide.slug, title: eg.guide.title, difficulty: eg.guide.difficulty })),
    detailUrl: `https://wasfix.nl/foutcodes/${encodeURIComponent(ec.machine.brand)}-${encodeURIComponent(ec.code)}`,
  };

  return NextResponse.json({ data: out, meta: { version: "v1" } }, { headers: CORS });
}
