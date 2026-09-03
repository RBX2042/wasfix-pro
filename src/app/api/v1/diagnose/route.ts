import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { extractApiKey, validateApiKey } from "@/lib/api-auth";
import { rateLimit } from "@/lib/ratelimit";
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
  const apiKey = extractApiKey(req);
  const auth = await validateApiKey(apiKey);
  if (!auth) {
    return NextResponse.json({ error: "Invalid or missing API key", docs: "https://wasfix.nl/api-docs" }, { status: 401, headers: CORS });
  }
  if (!auth.scopes.includes("read:errorcodes")) {
    return NextResponse.json({ error: "Insufficient scope: requires 'read:errorcodes'" }, { status: 403, headers: CORS });
  }

  // Diagnose is more expensive — lower rate limit
  if (!(await rateLimit(`v1:diagnose:${auth.keyId}`, Math.max(10, Math.ceil(auth.monthlyCalls / 100)), 60 * 60 * 1000))) {
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

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400, headers: CORS });
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
