import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";
import { isDatabaseConfigured } from "./env";
import { isDemoMode } from "./demo-mode";
import { logger } from "./logger";
import { rateLimit } from "./ratelimit";
import { effectivePlan } from "./subscription";

// API key format: wf_<env>_<32 random chars>
// Examples: wf_live_a1b2c3..., wf_test_x7y8z9...
// Only the SHA-256 hash is stored; the plaintext is shown once at creation.

export type ApiKeyInfo = {
  keyId: string;
  userId: string;
  prefix: string;
  /** Hourly burst allowance of the owner's CURRENT plan. */
  rateLimit: number;
  /** Included calls per 30-day window of the owner's CURRENT plan. */
  monthlyCalls: number;
  scopes: string[];
  /** The plan the allowance was derived from (effectivePlan of the owner at request time). */
  plan?: string;
  /**
   * Whose allowance a call spends: the ACCOUNT, not the key. The plan sells
   * "1.000 calls per maand" per customer; with the counter on the key, ten keys
   * (the per-user maximum) made ten times that.
   */
  quotaKey: string;
};

/** The quota counter (UsageCounter scope "api") that backs an account's monthly API allowance. */
export const apiQuotaKeyFor = (userId: string) => `acct:${userId}`;

/** Why a key was not accepted. "suspended" = the key is real but its owner's plan no longer includes the API. */
export type ApiKeyVerdict = { ok: true; info: ApiKeyInfo } | { ok: false; reason: "invalid" | "suspended" };

export const DEFAULT_SCOPES = ["read:parts", "read:errorcodes", "read:guides"];

/**
 * Monthly included calls per plan — the figure the pricing page sells.
 * Kept in sync with apiCallsPerMonth in src/lib/plans.ts.
 */
export const PLAN_API_MONTHLY_CALLS: Record<string, number> = {
  MONTEUR_PRO: 1000,
  BEDRIJF: 10000,
  API: 100000,
};

/**
 * Burst guard, per hour. This is deliberately NOT the monthly allowance:
 * passing the monthly number to an hourly limiter granted roughly 720x what
 * was sold.
 */
export const PLAN_API_HOURLY_BURST: Record<string, number> = {
  MONTEUR_PRO: 120,
  BEDRIJF: 600,
  API: 2000,
};

/** @deprecated Use PLAN_API_MONTHLY_CALLS or PLAN_API_HOURLY_BURST. */
export const PLAN_API_RATE_LIMIT = PLAN_API_MONTHLY_CALLS;

/** What a plan's API keys may do, or null when the plan includes no API. Read at request time, never frozen on the key. */
export function apiAllowanceFor(plan: string | null | undefined): { plan: string; monthlyCalls: number; hourlyBurst: number } | null {
  if (!plan) return null;
  const monthlyCalls = PLAN_API_MONTHLY_CALLS[plan];
  const hourlyBurst = PLAN_API_HOURLY_BURST[plan];
  if (!monthlyCalls || !hourlyBurst) return null;
  return { plan, monthlyCalls, hourlyBurst };
}

/**
 * Sandbox tier. No key is compiled into the bundle any more: a constant one
 * cannot be revoked, and because every caller shared the same quota id one
 * stranger burned the 100 calls/month for every evaluator.
 *
 * API_DEMO_KEY names the single key to accept and is absent by default — a
 * live deploy therefore has no sandbox at all until someone configures one,
 * and unsetting the variable revokes it. Its value must itself match the
 * format regex in validateApiKey (wf_(live|test|demo)_ + 8-64 characters from
 * [A-Za-z0-9_]), otherwise the key is dropped before it ever gets here and the
 * sandbox silently never works.
 *
 * Outside production, a demo deployment additionally accepts any wf_demo_… key
 * so local demos need no configuration at all. That check is isDemoMode() and
 * deliberately NOT the raw env.DEMO_MODE flag: wasfix.nl runs today with
 * DEMO_MODE=true and no Clerk keys (BLOCKED.md), so the raw flag accepted every
 * wf_demo_<anything> on the live site — and since the quota bucket is derived
 * from the key, rotating the suffix handed out a fresh allowance per request,
 * i.e. an unmetered public API. A production build (`next start`, Vercel, and
 * therefore also CI) must configure API_DEMO_KEY to have a sandbox.
 *
 * Scoped to read:parts on purpose: read:errorcodes also unlocks
 * /api/v1/diagnose, which spends AI budget on every call.
 */
const DEMO_SCOPES = ["read:parts"];

function demoKeyInfo(key: string): ApiKeyInfo | null {
  const configured = process.env.API_DEMO_KEY?.trim();
  const accepted = (!!configured && key === configured) || (isDemoMode() && key.startsWith("wf_demo_"));
  if (!accepted) return null;

  return {
    // Quota bucket per key instead of one global "demo" counter: rotating
    // API_DEMO_KEY starts a clean month and a revoked key does not spend its
    // successor's allowance. In production only the configured key reaches
    // this line, so a caller cannot mint himself a fresh bucket.
    keyId: `demo-${hashApiKey(key).slice(0, 12)}`,
    quotaKey: `demo-${hashApiKey(key).slice(0, 12)}`,
    userId: "demo-user",
    prefix: "wf_demo",
    rateLimit: 10,
    monthlyCalls: 100,
    scopes: DEMO_SCOPES,
  };
}

// Extract API key from header (Authorization: Bearer wf_*) or query (?api_key=)
export function extractApiKey(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  const apiKeyHeader = req.headers.get("x-api-key");
  if (apiKeyHeader) return apiKeyHeader.trim();
  const fromQuery = req.nextUrl.searchParams.get("api_key");
  return fromQuery?.trim() ?? null;
}

// Validate key and say WHY when it is not accepted. A sandbox key only works
// when configured (see demoKeyInfo); real keys are looked up by hash in the
// ApiKey table and carry the allowance of their owner's CURRENT plan: the
// number copied onto the row at creation is not consulted, so an upgrade, a
// downgrade and a cancellation all take effect on the next request.
export async function verifyApiKey(key: string | null): Promise<ApiKeyVerdict> {
  if (!key) return { ok: false, reason: "invalid" };
  if (!/^wf_(live|test|demo)_[A-Za-z0-9_]{8,64}$/.test(key)) return { ok: false, reason: "invalid" };

  const demo = demoKeyInfo(key);
  if (demo) return { ok: true, info: demo };
  if (!isDatabaseConfigured()) return { ok: false, reason: "invalid" };

  try {
    const record = await prisma.apiKey.findUnique({
      where: { hash: hashApiKey(key) },
      include: { user: { select: { plan: true, stripeSubStatus: true, stripeCurrentPeriodEnd: true } } },
    });
    if (!record || record.revokedAt) return { ok: false, reason: "invalid" };

    const plan = effectivePlan(record.user);
    const allowance = apiAllowanceFor(plan);
    // The owner no longer has a plan with an API (cancelled, lapsed, downgraded
    // to Particulier): the key stays on file so the owner can still see and
    // revoke it, but it does nothing.
    if (!allowance) return { ok: false, reason: "suspended" };

    // Fire-and-forget usage bookkeeping.
    prisma.apiKey
      .update({ where: { id: record.id }, data: { usageCount: { increment: 1 }, lastUsedAt: new Date() } })
      .catch(() => null);

    return {
      ok: true,
      info: {
        keyId: record.id,
        quotaKey: apiQuotaKeyFor(record.userId),
        userId: record.userId,
        prefix: record.prefix,
        rateLimit: allowance.hourlyBurst,
        monthlyCalls: allowance.monthlyCalls,
        scopes: record.scopes.split(",").map((s) => s.trim()).filter(Boolean),
        plan,
      },
    };
  } catch (err) {
    logger.warn("[api-auth] key lookup failed", err);
    return { ok: false, reason: "invalid" };
  }
}

// Returns ApiKeyInfo if the key may be used right now, null otherwise (unknown,
// revoked, or suspended). Callers that need to tell the last case apart use
// verifyApiKey() or authorizeApiRequest().
export async function validateApiKey(key: string | null): Promise<ApiKeyInfo | null> {
  const verdict = await verifyApiKey(key);
  return verdict.ok ? verdict.info : null;
}

export const API_DOCS_URL = "https://wasfix.nl/api-docs";

/**
 * The preamble every /api/v1 data endpoint shares: key present and valid, scope
 * granted, hourly burst within the plan's limit. Answers 401 (no/unknown/
 * revoked key), 402 (key suspended because the owner's plan has no API), 403
 * (scope) or 429 (burst) as a ready NextResponse; otherwise hands back the key.
 * The MONTHLY allowance is not spent here: the endpoint spends it after it has
 * validated the request, so a 400 or 404 does not cost a call.
 */
export async function authorizeApiRequest(
  req: NextRequest,
  opts: { scope: string; bucket: string; headers?: Record<string, string> },
): Promise<{ auth: ApiKeyInfo } | { response: NextResponse }> {
  const headers = opts.headers;
  const verdict = await verifyApiKey(extractApiKey(req));
  if (!verdict.ok) {
    if (verdict.reason === "suspended") {
      return {
        response: NextResponse.json(
          { error: "API key suspended: the account behind this key has no active plan that includes the API", docs: API_DOCS_URL },
          { status: 402, headers },
        ),
      };
    }
    return { response: NextResponse.json({ error: "Invalid or missing API key", docs: API_DOCS_URL }, { status: 401, headers }) };
  }
  const auth = verdict.info;
  if (!auth.scopes.includes(opts.scope)) {
    return { response: NextResponse.json({ error: `Insufficient scope: requires '${opts.scope}'` }, { status: 403, headers }) };
  }
  if (!(await rateLimit(`v1:${opts.bucket}:${auth.quotaKey}`, auth.rateLimit, 60 * 60 * 1000))) {
    return { response: NextResponse.json({ error: "Hourly rate limit exceeded", limit: auth.rateLimit, retry_after: 3600 }, { status: 429, headers }) };
  }
  return { auth };
}

// Hash an API key for storage. Never store the plaintext.
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// Generate a new API key. Uses base36 over 24 random bytes → 32 chars.
export function generateApiKey(env: "live" | "test" | "demo" = "live"): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(32);
  let random = "";
  for (let i = 0; i < 32; i++) random += alphabet[bytes[i] % alphabet.length];
  return `wf_${env}_${random}`;
}

export function keyPrefix(key: string): string {
  return key.slice(0, 14);
}
