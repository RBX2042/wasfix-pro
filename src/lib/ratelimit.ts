/**
 * Lightweight in-memory rate limiter.
 * Suitable for single-instance dev/prototype deployments.
 * For multi-instance production, switch to Upstash Redis or similar.
 */

import type { NextRequest } from "next/server";

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

/**
 * Check + increment a counter for `key`.
 * @returns true when the request is allowed, false when blocked.
 */
export function rateLimit(key: string, maxRequests: number, windowMs: number): boolean {
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

/** Build a stable key per request (IP + optional user). */
export function getClientKey(req: NextRequest, userId?: string): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "anon";
  return userId ? `${userId}:${ip}` : ip;
}
