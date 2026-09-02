/**
 * Who is allowed to use what, and how much of it.
 *
 * Before this module the free-tier quota was only checked for signed-in users,
 * which meant a signed-out visitor had unlimited AI diagnoses — the paid plans
 * sold something the product gave away. Usage is now metered per identity:
 * the account when signed in, otherwise a visitor cookie falling back to a
 * hashed IP so clearing cookies does not silently reset the counter.
 */

import { createHash, randomUUID } from "crypto";
import type { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { isDatabaseConfigured } from "./env";
import { getPlan, type Plan } from "./plans";
import { logger } from "./logger";
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

/** Stable, non-identifying key for an anonymous visitor. */
export function anonymousKey(req: NextRequest, visitorId?: string | null): string {
  if (visitorId) return `vid:${visitorId}`;
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
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

    // No record, or the window has rolled over: start fresh.
    if (!existing || existing.windowEnd < now) {
      if (!commit) return { allowed: limit > 0, used: 0, limit };
      const windowEnd = new Date(now.getTime() + windowMs);
      await prisma.usageCounter.upsert({
        where: { scope_key: { scope, key } },
        update: { count: 1, windowEnd },
        create: { scope, key, count: 1, windowEnd },
      });
      return { allowed: limit > 0, used: 1, limit };
    }

    if (existing.count >= limit) return { allowed: false, used: existing.count, limit };
    if (!commit) return { allowed: true, used: existing.count, limit };

    const updated = await prisma.usageCounter.update({
      where: { scope_key: { scope, key } },
      data: { count: { increment: 1 } },
    });
    return { allowed: updated.count <= limit, used: updated.count, limit };
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
