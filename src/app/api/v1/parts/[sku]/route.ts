import { NextRequest, NextResponse } from "next/server";
import { API_DOCS_URL, authorizeApiRequest } from "@/lib/api-auth";
import { dbPart, dbPartFull } from "@/lib/static-db";
import { consumeUsage } from "@/lib/entitlements";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, X-API-Key, Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ sku: string }> }) {
  // Key, scope and hourly burst (the burst belongs to the key owner's CURRENT plan).
  const gate = await authorizeApiRequest(req, { scope: "read:parts", bucket: "all", headers: CORS });
  if ("response" in gate) return gate.response;
  const { auth } = gate;

  const { sku } = await params;
  const part = (await dbPartFull(sku)) ?? (await dbPart(sku));
  if (!part) {
    // Not metered: a lookup that returns nothing does not cost a call of the monthly allowance.
    return NextResponse.json({ error: "Part not found", sku }, { status: 404, headers: CORS });
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

  // Strip internal fields for public API
  const publicPart = {
    sku: part.sku,
    name: part.name,
    category: part.category,
    brand: part.brand,
    isOriginal: part.isOriginal,
    priceEur: part.priceEur,
    stock: part.stock,
    description: part.description,
    imageUrl: part.imageUrl,
    oemNumbers: ("oemNumbers" in part && typeof part.oemNumbers === "string") ? part.oemNumbers.split("|").filter(Boolean) : [],
    productUrl: `https://wasfix.nl/onderdelen/${part.sku}`,
  };

  return NextResponse.json({ data: publicPart, meta: { version: "v1" } }, { headers: CORS });
}
