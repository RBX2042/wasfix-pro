import { NextRequest, NextResponse } from "next/server";
import { extractApiKey, validateApiKey } from "@/lib/api-auth";
import { staticPart, staticPartFull } from "@/lib/static-db";
import { rateLimit } from "@/lib/ratelimit";
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
  // Auth
  const apiKey = extractApiKey(req);
  const auth = await validateApiKey(apiKey);
  if (!auth) {
    return NextResponse.json({ error: "Invalid or missing API key", docs: "https://wasfix.nl/api-docs" }, { status: 401, headers: CORS });
  }
  if (!auth.scopes.includes("read:parts")) {
    return NextResponse.json({ error: "Insufficient scope: requires 'read:parts'" }, { status: 403, headers: CORS });
  }

  // Rate limit
  if (!(await rateLimit(`v1:parts:${auth.keyId}`, Math.max(10, Math.ceil(auth.monthlyCalls / 100)), 60 * 60 * 1000))) {
    return NextResponse.json({ error: "Rate limit exceeded", retry_after: 3600 }, { status: 429, headers: CORS });
  }

  // The plan sells a monthly allowance; without this the hourly guard alone
  // let a Monteur Pro key make roughly 720x the calls it paid for.
  const monthly = await consumeUsage("api", auth.keyId, auth.monthlyCalls);
  if (!monthly.allowed) {
    return NextResponse.json(
      { error: "Monthly call allowance exhausted", used: monthly.used, limit: monthly.limit, docs: "https://wasfix.nl/api-docs" },
      { status: 429, headers: CORS },
    );
  }

  const { sku } = await params;
  const part = staticPartFull(sku) ?? staticPart(sku);
  if (!part) {
    return NextResponse.json({ error: "Part not found", sku }, { status: 404, headers: CORS });
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
