import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { API_DOCS_URL, authorizeApiRequest } from "@/lib/api-auth";
import { consumeUsage } from "@/lib/entitlements";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, X-API-Key, Content-Type",
};

const Schema = z.object({
  brand: z.string().min(1).max(50),
  model: z.string().max(80).optional(),
  errorCode: z.string().max(20).optional(),
  symptoms: z.string().max(2000),
  language: z.enum(["nl", "en", "de", "fr"]).default("nl"),
});

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  // Key, scope and hourly burst (the burst belongs to the key owner's CURRENT plan).
  const gate = await authorizeApiRequest(req, { scope: "read:errorcodes", bucket: "all", headers: CORS });
  if ("response" in gate) return gate.response;
  const { auth } = gate;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400, headers: CORS });
  }

  // The plan sells a monthly allowance; the hourly burst alone would let a key
  // make hundreds of times the calls it paid for. Spent only now: a malformed
  // request (400) costs nothing, the model call below is what is being sold.
  const monthly = await consumeUsage("api", auth.quotaKey, auth.monthlyCalls);
  if (!monthly.allowed) {
    return NextResponse.json(
      { error: "Monthly call allowance exhausted", used: monthly.used, limit: monthly.limit, docs: API_DOCS_URL },
      { status: 429, headers: CORS },
    );
  }

  const { brand, model, errorCode, symptoms, language } = parsed.data;

  // Call internal diagnose service
  try {
    const internalRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/diagnose`, {
      method: "POST",
      // This call occupies two concurrent invocations at once (this one plus the
      // /api/diagnose it waits on). Without a deadline a slow diagnose pins both
      // until the platform kills them, which at the concurrency ceiling deadlocks
      // the whole API. The bound sits just above the Gemini timeout inside
      // /api/diagnose so a genuine slow model still returns its own answer.
      signal: AbortSignal.timeout(12_000),
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Auth": process.env.INTERNAL_API_KEY ?? "",
        // Already metered against the API key above; skip the consumer quota.
        "X-Api-Metered": "1",
      },
      body: JSON.stringify({
        messages: [{
          role: "user",
          content: `[B2B API] Brand: ${brand}${model ? `, Model: ${model}` : ""}${errorCode ? `, Error code: ${errorCode}` : ""}\n\n${symptoms}`,
        }],
        language,
      }),
    });

    if (!internalRes.ok) {
      return NextResponse.json({ error: "Diagnose service unavailable" }, { status: 502, headers: CORS });
    }

    const result = await internalRes.json();

    return NextResponse.json({
      data: {
        diagnosis: result.diagnosis,
        recommendedParts: (result.recommendedParts ?? []).map((p: { sku: string; name: string; priceEur: number }) => ({
          sku: p.sku, name: p.name, priceEur: p.priceEur,
          buyUrl: `https://wasfix.nl/onderdelen/${p.sku}`,
        })),
        recommendedGuides: (result.recommendedGuides ?? []).map((g: { slug: string; title: string }) => ({
          slug: g.slug, title: g.title,
          url: `https://wasfix.nl/gidsen/${g.slug}`,
        })),
      },
      meta: { version: "v1", language, model_used: process.env.GEMINI_MODEL ?? "gemini-2.0-flash" },
    }, { headers: CORS });
  } catch (err) {
    // An aborted call means a slow upstream, not a broken one: give the B2B
    // consumer a 504 with a retry hint instead of a generic 502.
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return NextResponse.json({ error: "Diagnose service timeout", retry_after: 5 }, { status: 504, headers: CORS });
    }
    return NextResponse.json({ error: "Diagnose service error" }, { status: 502, headers: CORS });
  }
}
