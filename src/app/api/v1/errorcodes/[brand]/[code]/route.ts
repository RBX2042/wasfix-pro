import { NextRequest, NextResponse } from "next/server";
import { API_DOCS_URL, authorizeApiRequest } from "@/lib/api-auth";
import { dbErrorCode } from "@/lib/static-db";
import { consumeUsage } from "@/lib/entitlements";
import { pickArr } from "@/lib/utils";
import { absoluteUrl } from "@/lib/site-url";

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
  // Key, scope and hourly burst (the burst belongs to the key owner's CURRENT plan).
  const gate = await authorizeApiRequest(req, { scope: "read:errorcodes", bucket: "all", headers: CORS });
  if ("response" in gate) return gate.response;
  const { auth } = gate;

  const { brand, code } = await params;
  const ec = await dbErrorCode(decodeURIComponent(brand), decodeURIComponent(code));
  if (!ec) {
    // Not metered: a lookup that returns nothing does not cost a call of the monthly allowance.
    return NextResponse.json({ error: "Error code not found", brand, code }, { status: 404, headers: CORS });
  }

  // The plan sells a monthly allowance; the hourly burst alone would let a key
  // make hundreds of times the calls it paid for. Spent after the request is
  // known to be valid.
  const monthly = await consumeUsage("api", auth.quotaKey, auth.monthlyCalls);
  if (!monthly.allowed) {
    return NextResponse.json(
      { error: "Monthly call allowance exhausted", used: monthly.used, limit: monthly.limit, docs: API_DOCS_URL },
      { status: 429, headers: CORS },
    );
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
    detailUrl: absoluteUrl(`/foutcodes/${encodeURIComponent(ec.machine.brand)}-${encodeURIComponent(ec.code)}`),
  };

  return NextResponse.json({ data: out, meta: { version: "v1" } }, { headers: CORS });
}
