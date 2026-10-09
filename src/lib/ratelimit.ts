/**
 * Rate limiter with two backends:
 *  - Upstash Redis (REST) when UPSTASH_REDIS_REST_URL/TOKEN are set — shared
 *    across serverless instances, safe for production.
 *  - In-memory fallback otherwise — fine for a single instance / local dev.
 *
 * Fail-open: if Upstash is unreachable the request is allowed and the
 * in-memory limiter is used for that call, so an outage never blocks users.
 *
 * WHAT THE MEMORY BACKEND DOES NOT DO: it counts per process. On a serverless
 * host every concurrent instance has its own counters and a cold start begins at
 * zero, so the effective limit is "limit x number of instances". That is
 * acceptable for the abuse limits here (each one is also bounded by a database
 * quota or by stock), but it is a degraded mode, and in production it announces
 * itself once per process (see warnIfDegraded) and in `npm run preflight`.
 */
import type { EnvLike } from "./site-url";




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

let warnedDegraded = false;
/**
 * One loud line per process when production runs without Upstash. Not an error:
 * the site works and the database-backed quotas stay exact. But a limit of
 * "10 orders per hour" silently becoming "10 per instance per hour" is something
 * the owner should have read once.
 */
function warnIfDegraded(): void {
  if (warnedDegraded || isUpstashConfigured() || process.env.NODE_ENV !== "production") return;
  warnedDegraded = true;
  logger.warn(
    "[ratelimit] UPSTASH_REDIS_REST_URL/TOKEN are not set: rate limits are counted per server instance and reset on every cold start, so on a serverless host the real limit is the configured limit times the number of instances. Database-backed quotas (diagnoses, API calls) are unaffected. Set both variables for shared limits.",
  );
}

/** For tests only. */
export function _resetRateLimitStateForTests(): void {
  warnedDegraded = false;
  warnedNoClientIp = false;
  upstashDownUntil = 0;
  buckets.clear();
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

// After a failed Upstash call, use the memory limiter for a while instead of
// making every request wait for the timeout again.
const UPSTASH_BACKOFF_MS = 30_000;
let upstashDownUntil = 0;

async function upstashRateLimit(key: string, maxRequests: number, windowMs: number): Promise<boolean | null> {
  if (Date.now() < upstashDownUntil) return null;
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
    if (!res.ok) {
      upstashDownUntil = Date.now() + UPSTASH_BACKOFF_MS;
      logger.warn(`[ratelimit] Upstash answered HTTP ${res.status} — using the in-memory limiter for ${UPSTASH_BACKOFF_MS / 1000}s`);
      return null;
    }
    const data = (await res.json()) as Array<{ result?: number | string; error?: string }>;
    const count = Number(data?.[0]?.result ?? 0);
    if (!Number.isFinite(count) || count <= 0) return null;
    return count <= maxRequests;
  } catch (err) {
    upstashDownUntil = Date.now() + UPSTASH_BACKOFF_MS;
    logger.warn(`[ratelimit] Upstash unreachable — using the in-memory limiter for ${UPSTASH_BACKOFF_MS / 1000}s`, err);
    return null;
  }
}

/**
 * Check + increment a counter for `key`.
 * @returns true when the request is allowed, false when blocked.
 */
export async function rateLimit(key: string, maxRequests: number, windowMs: number): Promise<boolean> {
  warnIfDegraded();
  if (isUpstashConfigured()) {
    const result = await upstashRateLimit(key, maxRequests, windowMs);
    if (result !== null) return result;
  }
  return memoryRateLimit(key, maxRequests, windowMs);
}

let warnedNoClientIp = false;

/**
 * The caller's IP, as far as we can trust it.
 *
 * x-forwarded-for is client-supplied: a caller may prepend any address they
 * like, so its *first* entry is worthless as an identity — rotating the header
 * made every rate limit and the free-tier paywall disappear.
 *
 *   - On Vercel (VERCEL=1, which the platform sets): x-vercel-forwarded-for.
 *     Vercel overwrites it on every request, so a client cannot choose it.
 *   - Anywhere else that header is just another client-supplied header and is
 *     IGNORED. (Before, it was believed everywhere, so on any other host a
 *     caller minted a fresh free-tier bucket per request by rotating it.)
 *   - Elsewhere the last entry of x-forwarded-for is used, then x-real-ip: the
 *     hop that OUR proxy appended. This is only sound when exactly one trusted
 *     reverse proxy sits in front of the app and appends the address of the peer
 *     it saw. With no proxy at all a client can forge both headers; there is no
 *     socket address available to a Next route handler to do better. Run the app
 *     behind a proxy, or on Vercel.
 *   - Nothing usable: "" (callers share one bucket, see getClientKey). In
 *     production that is logged once, because it means every visitor is counted
 *     as one person.
 */
export function clientIp(req: NextRequest, env: EnvLike = process.env): string {
  if (env.VERCEL) {
    const platform = req.headers.get("x-vercel-forwarded-for")?.trim();
    if (platform) return platform;
  }

  const hops = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  const ip = hops.length > 0 ? hops[hops.length - 1] : req.headers.get("x-real-ip")?.trim() ?? "";

  if (!ip && env.NODE_ENV === "production" && !warnedNoClientIp) {
    warnedNoClientIp = true;
    logger.warn(
      "[ratelimit] a request arrived with no client address (no x-forwarded-for / x-real-ip, and not on Vercel): all such visitors share one rate-limit bucket. Put the app behind a reverse proxy that sets x-forwarded-for, or host it on Vercel.",
    );
  }
  return ip;
}

/** Build a stable key per request: the account when signed in, else the IP. */
export function getClientKey(req: NextRequest, userId?: string): string {
  // Signed-in callers are keyed on the account alone — with the IP mixed in,
  // one account could mint a fresh bucket per request from headers.
  if (userId) return `user:${userId}`;
  return clientIp(req) || "anon";
}
