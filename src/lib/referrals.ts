/**
 * Referral attribution.
 *
 * A visitor arriving with ?ref=CODE gets an anonymous visitor id in a cookie
 * and one Referral row (unique per code+visitor, so refreshes don't inflate
 * clicks). When that visitor later signs up, the row is marked; when they
 * become a paying customer, it converts and the referrer earns credit.
 */

import "server-only";
import { randomBytes } from "crypto";
import { prisma } from "./prisma";
import { isDatabaseConfigured } from "./env";
import { logger } from "./logger";

export const REF_COOKIE = "wasfix-ref";
// Defined in ./visitor so scripts can import it without server-only.
import { VISITOR_COOKIE } from "./visitor";
export { VISITOR_COOKIE };
export const REWARD_EUR = 5;
/** Attribution window: a signup counts for the referrer for this long. */
export const ATTRIBUTION_DAYS = 30;

export function isValidCode(code: string | undefined | null): code is string {
  return typeof code === "string" && /^[A-Z0-9]{4,20}$/.test(code);
}

const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Random code in the shape isValidCode() accepts. */
function newCode(length = 8): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

/** Stable referral code for a user, generated once and persisted. */
export async function referralCodeFor(userId: string): Promise<string> {
  // No database: nothing to collide with and nothing to attribute, so a code
  // derived from the id keeps the link stable between page loads.
  if (!isDatabaseConfigured()) return userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase().padEnd(6, "0");
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
    if (user?.referralCode) return user.referralCode;

    // The code used to be the first 6 characters of the cuid. Those are the
    // same for everyone who signs up within the same ~46 s, so the unique
    // constraint threw and the caller handed out the *other* user's code —
    // every click on that link credited a stranger, forever, because the code
    // was never persisted. Random code, retry on the collision instead.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newCode();
      try {
        await prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
        return code;
      } catch (err) {
        if ((err as { code?: string })?.code !== "P2002" || attempt === 4) throw err;
      }
    }
  } catch (err) {
    logger.warn("[referrals] could not persist referral code", err);
  }
  // Unpersisted, so clicks on it credit nobody. That is the safe failure:
  // handing back a code that already belongs to someone else pays them out.
  return newCode();
}

/** Record a click. Idempotent per (code, visitor). */
export async function recordClick(code: string, visitorId: string, landingPath?: string): Promise<void> {
  if (!isDatabaseConfigured() || !isValidCode(code)) return;
  try {
    const referrer = await prisma.user.findUnique({ where: { referralCode: code }, select: { id: true } });
    await prisma.referral.upsert({
      where: { code_visitorId: { code, visitorId } },
      update: {},
      create: { code, visitorId, referrerId: referrer?.id ?? null, landingPath: landingPath ?? null },
    });
  } catch (err) {
    logger.warn("[referrals] click not recorded", err);
  }
}

/**
 * The user doing the signing up / converting, so they cannot pay themselves.
 * Callers that know it (they resolved the buyer already, or run outside a
 * request like the Stripe webhook) should pass it in.
 */
async function actingUserId(explicit?: string): Promise<string | null> {
  if (explicit) return explicit;
  try {
    const { getCurrentUser } = await import("./auth");
    return (await getCurrentUser())?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * The one referral that gets the credit: last touch, never the visitor's own
 * link. updateMany over every row of this visitor marked them all, so a visitor
 * who clicked three links and bought once paid three referrers.
 */
async function attributableReferral(
  visitorId: string,
  actor: string | null,
  where: { signedUpAt: null } | { convertedAt: null; createdAt: { gte: Date } }
): Promise<string | null> {
  const rows = await prisma.referral.findMany({
    where: { visitorId, ...where },
    orderBy: { createdAt: "desc" },
    select: { id: true, referrerId: true },
  });
  return rows.find((r) => !actor || r.referrerId !== actor)?.id ?? null;
}

/** Mark the visitor's referral as a signup (first time only). */
export async function recordSignup(visitorId: string, userId?: string): Promise<void> {
  if (!isDatabaseConfigured() || !visitorId) return;
  try {
    const id = await attributableReferral(visitorId, await actingUserId(userId), { signedUpAt: null });
    if (!id) return;
    await prisma.referral.update({ where: { id }, data: { signedUpAt: new Date() } });
  } catch (err) {
    logger.warn("[referrals] signup not recorded", err);
  }
}

/** Mark conversion + credit the referrer, within the attribution window. */
export async function recordConversion(visitorId: string, userId?: string): Promise<void> {
  if (!isDatabaseConfigured() || !visitorId) return;
  const cutoff = new Date(Date.now() - ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    const id = await attributableReferral(visitorId, await actingUserId(userId), {
      convertedAt: null,
      createdAt: { gte: cutoff },
    });
    if (!id) return;
    await prisma.referral.update({ where: { id }, data: { convertedAt: new Date(), rewardEur: REWARD_EUR } });
  } catch (err) {
    logger.warn("[referrals] conversion not recorded", err);
  }
}

export type ReferralStats = {
  code: string;
  link: string;
  clicks: number;
  signups: number;
  conversions: number;
  earningsEur: number;
};

export async function referralStats(code: string, appUrl: string): Promise<ReferralStats> {
  const empty: ReferralStats = { code, link: `${appUrl}/?ref=${code}`, clicks: 0, signups: 0, conversions: 0, earningsEur: 0 };
  if (!isDatabaseConfigured()) return empty;
  try {
    const [clicks, signups, converted] = await Promise.all([
      prisma.referral.count({ where: { code } }),
      prisma.referral.count({ where: { code, signedUpAt: { not: null } } }),
      prisma.referral.aggregate({ where: { code, convertedAt: { not: null } }, _count: { _all: true }, _sum: { rewardEur: true } }),
    ]);
    return {
      ...empty,
      clicks,
      signups,
      conversions: converted._count._all,
      earningsEur: converted._sum.rewardEur ?? 0,
    };
  } catch (err) {
    logger.warn("[referrals] stats lookup failed", err);
    return empty;
  }
}

/**
 * Anonymous visitor id from the request cookies, if the visitor ever arrived
 * through a referral link. Returns null outside a request scope.
 */
export async function currentVisitorId(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    return store.get(VISITOR_COOKIE)?.value ?? null;
  } catch {
    // Called outside a request (build, background job) — no attribution.
    return null;
  }
}
