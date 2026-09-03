/**
 * Rate limiter with two backends:
 *  - Upstash Redis (REST) when UPSTASH_REDIS_REST_URL/TOKEN are set — shared
 *    across serverless instances, safe for production.
 *  - In-memory fallback otherwise — fine for a single instance / local dev.
 *
 * Fail-open: if Upstash is unreachable the request is allowed and the
 * in-memory limiter is used for that call, so an outage never blocks users.
 */

import type { NextRequest } from "next/server";
import { env, isUpstashConfigured } from "./env";
import { logger } from "./logger";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Periodically clean up expired entries to prevent unbounded memory growth.
let cleanupInterval: NodeJS.Timeout | null = null;
function ensureCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) {
      if (b.resetAt < now) buckets.delete(key);
    }
  }, 60_000);
  // Don't keep Node alive on its own.
  cleanupInterval.unref?.();
}

function memoryRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  ensureCleanup();
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= maxRequests) {
    return false;
  }
  existing.count++;
  return true;
}

async function upstashRateLimit(key: string, maxRequests: number, windowMs: number): Promise<boolean | null> {
  const url = env.UPSTASH_REDIS_REST_URL!;
  const token = env.UPSTASH_REDIS_REST_TOKEN!;
  const redisKey = `wasfix:rl:${key}`;
  const ttlSec = Math.max(1, Math.ceil(windowMs / 1000));
  try {
    // INCR + EXPIRE (only when the key is new) in one pipeline round-trip.
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", redisKey],
        ["EXPIRE", redisKey, String(ttlSec), "NX"],
      ]),
      // Never let a slow Redis hold a request hostage.
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ result?: number | string; error?: string }>;
    const count = Number(data?.[0]?.result ?? 0);
    if (!Number.isFinite(count) || count <= 0) return null;
    return count <= maxRequests;
  } catch (err) {
    logger.warn("[ratelimit] Upstash unreachable — falling back to memory", err);
    return null;
  }
}

/**
 * Check + increment a counter for `key`.
 * @returns true when the request is allowed, false when blocked.
 */
export async function rateLimit(key: string, maxRequests: number, windowMs: number): Promise<boolean> {
  if (isUpstashConfigured()) {
    const result = await upstashRateLimit(key, maxRequests, windowMs);
    if (result !== null) return result;
  }
  return memoryRateLimit(key, maxRequests, windowMs);
}

/**
 * The caller's IP, as far as we can trust it.
 *
 * x-forwarded-for is client-supplied: a caller may prepend any address they
 * like, so its *first* entry is worthless as an identity — rotating the header
 * made every rate limit and the free-tier paywall disappear. Only the platform
 * header is written by our own edge; failing that, the *last* entry of
 * x-forwarded-for is the hop our proxy appended, which a client cannot forge
 * past.
 */
export function clientIp(req: NextRequest): string {
  const platform = req.headers.get("x-vercel-forwarded-for")?.trim();
  if (platform) return platform;

  const hops = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  if (hops.length > 0) return hops[hops.length - 1];

  return req.headers.get("x-real-ip")?.trim() ?? "";
}

/** Build a stable key per request: the account when signed in, else the IP. */
export function getClientKey(req: NextRequest, userId?: string): string {
  // Signed-in callers are keyed on the account alone — with the IP mixed in,
  // one account could mint a fresh bucket per request from headers.
  if (userId) return `user:${userId}`;
  return clientIp(req) || "anon";
}
