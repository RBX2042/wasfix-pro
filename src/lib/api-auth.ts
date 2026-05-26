import { NextRequest } from "next/server";
import { createHash } from "crypto";

// API key format: wf_<env>_<32 random chars>
// Examples: wf_live_a1b2c3..., wf_test_x7y8z9...
// Validation: prefix check + hash lookup against DB (when DB online)
// Fallback: simple in-memory store for demo

export type ApiKeyInfo = {
  keyId: string;
  userId: string;
  prefix: string;
  rateLimit: number;
  scopes: string[];
};

const DEMO_KEYS: Record<string, ApiKeyInfo> = {
  "wf_demo_FREE_PUBLIC_DEMO_KEY_ONLY_LIMITED": {
    keyId: "demo-public",
    userId: "demo-user",
    prefix: "wf_demo",
    rateLimit: 10,
    scopes: ["read:parts", "read:errorcodes", "read:guides"],
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
// In demo mode: matches against DEMO_KEYS map.
// In production: hash check + DB lookup against ApiKey table.
export async function validateApiKey(key: string | null): Promise<ApiKeyInfo | null> {
  if (!key) return null;
  if (!/^wf_(live|test|demo)_[A-Za-z0-9_]{8,64}$/.test(key)) return null;

  // Demo lookup
  if (DEMO_KEYS[key]) return DEMO_KEYS[key];

  // Production: hash and lookup in DB (placeholder — needs ApiKey Prisma model)
  // const hashed = createHash("sha256").update(key).digest("hex");
  // const record = await prisma.apiKey.findUnique({ where: { hash: hashed }, include: { user: true } });
  // return record && !record.revokedAt ? { keyId: record.id, userId: record.userId, ... } : null;

  return null;
}

// Hash an API key for storage. Never store the plaintext.
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// Generate a new API key (for /admin/api-keys interface)
export function generateApiKey(env: "live" | "test" | "demo" = "live"): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes).map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 32);
  return `wf_${env}_${random}`;
}
