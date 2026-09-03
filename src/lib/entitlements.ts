/**
 * Who is allowed to use what, and how much of it.
 *
 * Before this module the free-tier quota was only checked for signed-in users,
 * which meant a signed-out visitor had unlimited AI diagnoses — the paid plans
 * sold something the product gave away. Usage is now metered per identity:
 * the account when signed in, otherwise a hashed IP — the only identity an
 * anonymous caller cannot simply pick for itself.
 */

import { createHash, randomUUID } from "crypto";
import type { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { isDatabaseConfigured } from "./env";
import { getPlan, type Plan } from "./plans";
import { logger } from "./logger";
import { clientIp } from "./ratelimit";
import { VISITOR_COOKIE } from "./visitor";

export const QUOTA_WINDOW_DAYS = 30;

export type Entitlements = {
  plan: Plan;
  signedIn: boolean;
  diagnosesUsed: number;
  /** -1 when unlimited. */
  diagnosesLimit: number;
  diagnosesRemaining: number;
  premiumGuides: boolean;
  partsDiscount: number;
};

/**
 * Stable, non-identifying key for an anonymous visitor.
 *
 * The IP is the only anonymous identity a caller cannot choose. The visitor
 * cookie used to win here, but it is unsigned and on the metered paths only
 * ever read back off the request, so `curl -b "wasfix-vid=$(uuidgen)"` minted
 * a fresh 3-diagnoses bucket per call — the exact paywall bypass this module
 * exists to close, and cheaper than the x-forwarded-for one below. The
 * parameter stays so callers may keep handing us the cookie, but it can never
 * open a bucket of its own; only a server-signed id could, and nothing issues
 * one today.
 */
export function anonymousKey(req: NextRequest, _visitorId?: string | null): string {
  // Via clientIp(): the first x-forwarded-for entry is client-supplied, so
  // reading it here handed anyone who rotates the header an unlimited number
  // of free-tier buckets.
  const ip = clientIp(req) || "unknown";
  // Hashed so we never store a raw IP against usage records.
  return `ip:${createHash("sha256").update(ip).digest("hex").slice(0, 32)}`;
}

/**
 * Read the visitor cookie, minting one when this is a first visit.
 * next/headers is imported lazily so this module stays usable from scripts.
 */
export async function getOrCreateVisitorId(): Promise<string> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const existing = jar.get(VISITOR_COOKIE)?.value;
  if (existing) return existing;
  const id = randomUUID();
  try {
    jar.set(VISITOR_COOKIE, id, { maxAge: 60 * 60 * 24 * 365, path: "/", sameSite: "lax" });
  } catch {
    // Called from a context that cannot set cookies (e.g. a static render).
  }
  return id;
}

// In-memory fallback so the quota still applies without a database.
type MemoryCounter = { count: number; windowEnd: number };
const memoryCounters = new Map<string, MemoryCounter>();

function memoryConsume(key: string, limit: number, windowMs: number, commit: boolean) {
  const now = Date.now();
  const existing = memoryCounters.get(key);
  if (!existing || existing.windowEnd < now) {
    if (commit) memoryCounters.set(key, { count: 1, windowEnd: now + windowMs });
    return { used: commit ? 1 : 0, allowed: limit > 0 };
  }
  if (existing.count >= limit) return { used: existing.count, allowed: false };
  if (commit) existing.count++;
  return { used: existing.count, allowed: true };
}

/**
 * Count one unit of metered usage.
 * @param commit false only reads the counter, true records the use.
 * @returns whether the caller is within their allowance.
 */
export async function consumeUsage(
  scope: string,
  key: string,
  limit: number,
  { commit = true, windowDays = QUOTA_WINDOW_DAYS }: { commit?: boolean; windowDays?: number } = {},
): Promise<{ allowed: boolean; used: number; limit: number }> {
  if (limit === -1) return { allowed: true, used: 0, limit: -1 };
  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  if (!isDatabaseConfigured()) {
    const r = memoryConsume(`${scope}:${key}`, limit, windowMs, commit);
    return { allowed: r.allowed, used: r.used, limit };
  }

  try {
    const now = new Date();
    const existing = await prisma.usageCounter.findUnique({ where: { scope_key: { scope, key } } });

    // A peek: no record, or a window that has rolled over, means nothing used.
    if (!commit) {
      if (!existing || existing.windowEnd < now) return { allowed: limit > 0, used: 0, limit };
      return { allowed: existing.count < limit, used: existing.count, limit };
    }

    if (existing && existing.windowEnd >= now && existing.count >= limit) {
      return { allowed: false, used: existing.count, limit };
    }

    const windowEnd = new Date(now.getTime() + windowMs);

    // Rolling a stale window over is conditional on it still being stale, so of
    // N simultaneous requests exactly one resets the counter and the rest count
    // against the window it just opened.
    if (existing && existing.windowEnd < now) {
      const rolled = await prisma.usageCounter.updateMany({
        where: { scope, key, windowEnd: { lt: now } },
        data: { count: 1, windowEnd },
      });
      if (rolled.count > 0) return { allowed: limit > 0, used: 1, limit };
    }

    // One INSERT ... ON CONFLICT DO UPDATE, and the decision is made on the
    // count the database hands back. The previous upsert wrote count: 1
    // unconditionally, so simultaneous first requests each reset the counter to
    // 1 and all of them were allowed — ten parallel diagnoses on a 3/month
    // allowance, from any key without a row yet, which is every new visitor.
    const counted = await prisma.usageCounter.upsert({
      where: { scope_key: { scope, key } },
      create: { scope, key, count: 1, windowEnd },
      update: { count: { increment: 1 } },
    });
    if (counted.count > limit) {
      // The increment has to happen before we know the answer, so a denied
      // request leaves the counter one too high; give that unit back. Without
      // it a client can drive its own stored count (and the diagnosesUsed we
      // report back) arbitrarily far past the allowance just by retrying.
      // Conditional on count > limit so a window that rolled over in between
      // is not silently charged for someone else's denied request.
      try {
        await prisma.usageCounter.updateMany({
          where: { scope, key, count: { gt: limit } },
          data: { count: { decrement: 1 } },
        });
      } catch (err) {
        // Over-reporting is not worth failing the deny over.
        logger.warn("[entitlements] could not undo a denied usage increment", err);
      }
      return { allowed: false, used: limit, limit };
    }
    return { allowed: true, used: counted.count, limit };
  } catch (err) {
    // Never let a metering failure take the product down; fall back to memory.
    logger.warn("[entitlements] usage counter unavailable — using memory", err);
    const r = memoryConsume(`${scope}:${key}`, limit, windowMs, commit);
    return { allowed: r.allowed, used: r.used, limit };
  }
}

/** Everything a page needs to decide what to show, for user or visitor. */
export async function getEntitlements(
  user: { id: string; plan: string } | null,
  anonKey?: string,
): Promise<Entitlements> {
  const plan = getPlan(user?.plan ?? "FREE");
  const limit = plan.diagnosesPerMonth;

  let used = 0;
  if (limit !== -1) {
    const key = user ? `user:${user.id}` : (anonKey ?? "unknown");
    const r = await consumeUsage("diagnose", key, limit, { commit: false });
    used = r.used;
  }

  return {
    plan,
    signedIn: Boolean(user),
    diagnosesUsed: used,
    diagnosesLimit: limit,
    diagnosesRemaining: limit === -1 ? -1 : Math.max(0, limit - used),
    premiumGuides: plan.premiumGuides,
    partsDiscount: plan.partsDiscount,
  };
}

/** Does this viewer get the full text of a premium guide? */
export function canReadPremiumGuide(plan: string | undefined): boolean {
  return getPlan(plan ?? "FREE").premiumGuides;
}
