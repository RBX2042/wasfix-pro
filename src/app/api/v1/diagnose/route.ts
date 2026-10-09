import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { API_DOCS_URL, authorizeApiRequest } from "@/lib/api-auth";
import { consumeUsage, refundUsage } from "@/lib/entitlements";
import { runDiagnosis } from "@/lib/diagnose-core";
import { aiAvailability } from "@/lib/ai-guard";
import { logger } from "@/lib/logger";
import { absoluteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, X-API-Key, Content-Type",
};

const Schema = z.object({
  brand: z.string().min(1).max(50),
  model: z.string().max(80).optional(),
  errorCode: z.string().max(20).optional(),
  symptoms: z.string().min(1).max(2000),
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

  // This endpoint sells AI. Without a model it must say so (503) and cost the
  // customer nothing, instead of serving a keyword lookup as if it were the
  // product. It runs in-process now, so there is no longer any internal key or
  // public URL whose absence could push API traffic into the visitor quota.
  const ai = aiAvailability();
  if (!ai.available) {
    if (ai.reason === "not_configured") logger.error("[api/v1/diagnose] GEMINI_API_KEY is not configured - every call answers 503");
    return NextResponse.json({ error: "AI diagnosis is temporarily unavailable", retry_after: 300 }, { status: 503, headers: { ...CORS, "Retry-After": "300" } });
  }

  // The plan sells a monthly allowance; the hourly burst alone would let a key
  // make hundreds of times the calls it paid for. Committed up front (parallel
  // calls would all pass a peek) and given back below when the call does not
  // succeed, so a failed call is never billed to the customer.
  const monthly = await consumeUsage("api", auth.quotaKey, auth.monthlyCalls);
  if (!monthly.allowed) {
    return NextResponse.json(
      { error: "Monthly call allowance exhausted", used: monthly.used, limit: monthly.limit, docs: API_DOCS_URL },
      { status: 429, headers: CORS },
    );
  }

  const { brand, model, errorCode, symptoms, language } = parsed.data;
  try {
    const outcome = await runDiagnosis({
      // The account and its allowance travel with the call so that the per-account daily bound and
      // the "api" daily budget in ai-guard.ts apply: without them one key could use up the whole day.
      caller: { kind: "api", quotaKey: auth.quotaKey, monthlyCalls: auth.monthlyCalls },
      language,
      messages: [
        {
          role: "user",
          content: `[B2B API] Brand: ${brand}${model ? `, Model: ${model}` : ""}${errorCode ? `, Error code: ${errorCode}` : ""}\n\n${symptoms}`,
        },
      ],
    });

    if (!outcome.ok) {
      await refundUsage("api", auth.quotaKey);
      const retryAfter = typeof outcome.details?.retry_after === "number" ? outcome.details.retry_after : null;
      return NextResponse.json(
        { error: outcome.error, ...(retryAfter ? { retry_after: retryAfter } : {}) },
        { status: outcome.status, headers: retryAfter ? { ...CORS, "Retry-After": String(retryAfter) } : CORS },
      );
    }

    // This endpoint is one-shot (the model is told not to ask questions). If it still answered without
    // a diagnosis block, the customer got nothing structured: give the call back and say so.
    if (!outcome.billable) await refundUsage("api", auth.quotaKey);

    return NextResponse.json(
      {
        data: {
          diagnosis: outcome.diagnosis,
          // The model's free-text answer. `diagnosis` is null when the model gave no structured diagnosis; such a call is not counted.
          message: outcome.message,
          recommendedParts: outcome.recommendedParts.map((p) => ({
            sku: p.sku,
            name: p.name,
            priceEur: p.priceEur,
            inStock: p.stock > 0,
            buyUrl: absoluteUrl(`/onderdelen/${p.sku}`),
          })),
          recommendedGuides: outcome.recommendedGuides.map((g) => ({
            slug: g.slug,
            title: g.title,
            url: absoluteUrl(`/gidsen/${g.slug}`),
          })),
          notice: outcome.notice,
        },
        // The model that really ran, never the configured default.
        meta: { version: "v1", language, mode: outcome.mode, model_used: outcome.model, counted: outcome.billable },
      },
      { headers: CORS },
    );
  } catch (err) {
    logger.error("[api/v1/diagnose] unexpected error", err);
    await refundUsage("api", auth.quotaKey);
    return NextResponse.json({ error: "Diagnose service error" }, { status: 500, headers: CORS });
  }
}
