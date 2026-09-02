/**
 * Referral attribution.
 *
 * A visitor arriving with ?ref=CODE gets an anonymous visitor id in a cookie
 * and one Referral row (unique per code+visitor, so refreshes don't inflate
 * clicks). When that visitor later signs up, the row is marked; when they
 * become a paying customer, it converts and the referrer earns credit.
 */

import "server-only";
import { prisma } from "./prisma";
import { isDatabaseConfigured } from "./env";
import { logger } from "./logger";

export const REF_COOKIE = "wasfix-ref";
export const VISITOR_COOKIE = "wasfix-vid";
export const REWARD_EUR = 5;
/** Attribution window: a signup counts for the referrer for this long. */
export const ATTRIBUTION_DAYS = 30;

export function isValidCode(code: string | undefined | null): code is string {
  return typeof code === "string" && /^[A-Z0-9]{4,20}$/.test(code);
}

/** Stable referral code for a user, derived from their id and persisted. */
export async function referralCodeFor(userId: string): Promise<string> {
  const fallback = userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase().padEnd(6, "0");
  if (!isDatabaseConfigured()) return fallback;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
    if (user?.referralCode) return user.referralCode;
    await prisma.user.update({ where: { id: userId }, data: { referralCode: fallback } });
    return fallback;
  } catch (err) {
    logger.warn("[referrals] could not persist referral code", err);
    return fallback;
  }
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

/** Mark the visitor's referral as a signup (first time only). */
export async function recordSignup(visitorId: string): Promise<void> {
  if (!isDatabaseConfigured() || !visitorId) return;
  try {
    await prisma.referral.updateMany({
      where: { visitorId, signedUpAt: null },
      data: { signedUpAt: new Date() },
    });
  } catch (err) {
    logger.warn("[referrals] signup not recorded", err);
  }
}

/** Mark conversion + credit the referrer, within the attribution window. */
export async function recordConversion(visitorId: string): Promise<void> {
  if (!isDatabaseConfigured() || !visitorId) return;
  const cutoff = new Date(Date.now() - ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    await prisma.referral.updateMany({
      where: { visitorId, convertedAt: null, createdAt: { gte: cutoff } },
      data: { convertedAt: new Date(), rewardEur: REWARD_EUR },
    });
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
