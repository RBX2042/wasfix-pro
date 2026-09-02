import { NextRequest } from "next/server";
import { createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";
import { isDatabaseConfigured } from "./env";
import { logger } from "./logger";

// API key format: wf_<env>_<32 random chars>
// Examples: wf_live_a1b2c3..., wf_test_x7y8z9...
// Only the SHA-256 hash is stored; the plaintext is shown once at creation.

export type ApiKeyInfo = {
  keyId: string;
  userId: string;
  prefix: string;
  rateLimit: number;
  scopes: string[];
};

export const DEFAULT_SCOPES = ["read:parts", "read:errorcodes", "read:guides"];

export const PLAN_API_RATE_LIMIT: Record<string, number> = {
  MONTEUR_PRO: 1000,
  BEDRIJF: 10000,
  API: 100000,
};

const DEMO_KEYS: Record<string, ApiKeyInfo> = {
  "wf_demo_FREE_PUBLIC_DEMO_KEY_ONLY_LIMITED": {
    keyId: "demo-public",
    userId: "demo-user",
    prefix: "wf_demo",
    rateLimit: 10,
    scopes: DEFAULT_SCOPES,
  },
};

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
// Demo key always works; real keys are looked up by hash in the ApiKey table.
export async function validateApiKey(key: string | null): Promise<ApiKeyInfo | null> {
  if (!key) return null;
  if (!/^wf_(live|test|demo)_[A-Za-z0-9_]{8,64}$/.test(key)) return null;

  if (DEMO_KEYS[key]) return DEMO_KEYS[key];
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
