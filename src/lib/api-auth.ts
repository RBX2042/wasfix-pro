import { NextRequest } from "next/server";
import { createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";
import { env, isClerkConfigured, isDatabaseConfigured } from "./env";
import { logger } from "./logger";

// API key format: wf_<env>_<32 random chars>
// Examples: wf_live_a1b2c3..., wf_test_x7y8z9...
// Only the SHA-256 hash is stored; the plaintext is shown once at creation.

export type ApiKeyInfo = {
  keyId: string;
  userId: string;
  prefix: string;
  /** Hourly burst allowance. */
  rateLimit: number;
  /** Included calls per 30-day window. */
  monthlyCalls: number;
  scopes: string[];
};

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

/**
 * Sandbox tier. No key is compiled into the bundle any more: a constant one
 * cannot be revoked, and because every caller shared the same quota id one
 * stranger burned the 100 calls/month for every evaluator.
 *
 * API_DEMO_KEY names the single key to accept and is absent by default — a
 * live deploy therefore has no sandbox at all until someone configures one,
 * and unsetting the variable revokes it. A demo deployment (DEMO_MODE with no
 * Clerk configured, i.e. no real authentication anywhere) additionally accepts
 * any wf_demo_… key so local demos and CI need no extra configuration; that
 * only ever exposes catalogue data, which /api/parts already serves without a
 * key at all.
 *
 * Scoped to read:parts on purpose: read:errorcodes also unlocks
 * /api/v1/diagnose, which spends AI budget on every call.
 */
const DEMO_SCOPES = ["read:parts"];

function demoKeyInfo(key: string): ApiKeyInfo | null {
  const configured = process.env.API_DEMO_KEY?.trim();
  const demoDeployment = env.DEMO_MODE && !isClerkConfigured();
  const accepted = (!!configured && key === configured) || (demoDeployment && key.startsWith("wf_demo_"));
  if (!accepted) return null;

  return {
    // Per-key quota bucket, so one caller can no longer exhaust the sandbox
    // for everybody else — and rotating the key starts a fresh month.
    keyId: `demo-${hashApiKey(key).slice(0, 12)}`,
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

// Validate key. Returns ApiKeyInfo if valid, null otherwise.
// A sandbox key only works when configured (see demoKeyInfo); real keys are
// looked up by hash in the ApiKey table.
export async function validateApiKey(key: string | null): Promise<ApiKeyInfo | null> {
  if (!key) return null;
  if (!/^wf_(live|test|demo)_[A-Za-z0-9_]{8,64}$/.test(key)) return null;

  const demo = demoKeyInfo(key);
  if (demo) return demo;
  if (!isDatabaseConfigured()) return null;

  try {
    const record = await prisma.apiKey.findUnique({ where: { hash: hashApiKey(key) } });
    if (!record || record.revokedAt) return null;

    // Fire-and-forget usage bookkeeping.
    prisma.apiKey
      .update({ where: { id: record.id }, data: { usageCount: { increment: 1 }, lastUsedAt: new Date() } })
      .catch(() => null);

    return {
      keyId: record.id,
      userId: record.userId,
      prefix: record.prefix,
      rateLimit: record.rateLimit,
      monthlyCalls: record.rateLimit,
      scopes: record.scopes.split(",").map((s) => s.trim()).filter(Boolean),
    };
  } catch (err) {
    logger.warn("[api-auth] key lookup failed", err);
    return null;
  }
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
