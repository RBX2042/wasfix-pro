/**
 * Referral attribution and the credit it earns.
 *
 * A visitor arriving with ?ref=CODE gets an anonymous visitor id in a cookie
 * and one Referral row (unique per code+visitor, so refreshes don't inflate
 * clicks). When that visitor later pays for a first order, the row converts and
 * the referrer is credited, under the rules below.
 *
 * THE PROGRAMME IS OFF BY DEFAULT (NEXT_PUBLIC_FEATURE_REFERRAL must be "true"):
 * there is no automatic payout, only a counter, and the owner settles credit by
 * hand on request (see the page /dashboard/referrals, which says exactly that).
 * While it is off the SERVER tracks nothing: no row is written, no cookie is set
 * by /api/referral/track, nothing is credited (qa-plans proves each). The browser
 * component src/components/ReferralTracker.tsx is outside this module and still
 * writes the wasfix-ref cookie and an analytics event after marketing consent
 * when a visitor arrives with ?ref=; it must check this flag too (open item).
 *
 * THE REWARD IS NOT WIRED TO PAYMENTS YET: the Stripe webhook
 * (src/app/api/stripe/_lib/dispatch.ts) calls recordConversion without an order
 * id, which answers "no_payment_proof". Switching the programme on books nothing
 * until that call passes the paid order's id (open item); scripts/qa-plans.ts
 * fails if the flag is documented ON while that is still true.
 *
 * WHEN A REWARD IS BOOKED (recordConversion, with proof of payment)
 *   - only when the referred person's FIRST order is PAID (PAID, SHIPPED or
 *     DELIVERED). Creating an order, a bank-transfer invoice or a subscription
 *     trial earns nothing: a caller without a paid order id gets
 *     {rewarded:false, reason:"no_payment_proof"};
 *   - never for the referrer themselves: same account, same e-mail address (the
 *     order's or the buyer account's), or a click made while signed in as the
 *     referrer (no row is created for it);
 *   - at most once per visitor and once per buyer (their first paid order only);
 *   - never more than REWARD_EUR, and never more than REWARD_SHARE_OF_MARGIN of
 *     what the order contributes (referralRewardFor). An order whose cost price
 *     is not a supplier quote has no known margin and earns EUR 0;
 *   - at most MAX_REWARD_PER_YEAR_EUR per referrer per calendar year.
 */

import "server-only";
import { randomBytes } from "crypto";
import { prisma } from "./prisma";
import { isDatabaseConfigured } from "./env";
import { logger } from "./logger";
import { SHIPPING, VAT_RATE } from "./plans";

export const REF_COOKIE = "wasfix-ref";
// Defined in ./visitor so scripts can import it without server-only.
import { VISITOR_COOKIE } from "./visitor";
export { VISITOR_COOKIE };

/** Build-time flag. Anything but the exact string "true" means OFF. */
export const REFERRAL_ENABLED = process.env.NEXT_PUBLIC_FEATURE_REFERRAL === "true";

/** The most a single referral can earn. */
export const REWARD_EUR = 5;
/** Never more than this share of what the order contributes. */
export const REWARD_SHARE_OF_MARGIN = 0.5;
/** Per referrer, per calendar year (Europe/Amsterdam). */
export const MAX_REWARD_PER_YEAR_EUR = 500;
/** Attribution window: a signup counts for the referrer for this long. */
export const ATTRIBUTION_DAYS = 30;

const PAID_STATUSES = ["PAID", "SHIPPED", "DELIVERED"];
const money = (v: number) => Math.round(v * 100) / 100;

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

/**
 * Record a click. Idempotent per (code, visitor).
 *
 * `actorUserId` is the signed-in user making the click, when there is one: a
 * referrer following their own link records nothing, so the browser they share
 * with a later guest checkout cannot be attributed to them.
 */
export async function recordClick(code: string, visitorId: string, landingPath?: string, actorUserId?: string | null): Promise<void> {
  if (!REFERRAL_ENABLED || !isDatabaseConfigured() || !isValidCode(code)) return;
  try {
    const referrer = await prisma.user.findUnique({ where: { referralCode: code }, select: { id: true } });
    if (referrer && actorUserId && referrer.id === actorUserId) return;
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
 *
 * Rows without a referrer are excluded: /api/referral/track accepts any code in
 * the isValidCode shape, so a typo'd or expired ?ref= stores a row with
 * referrerId null. Such a row as last touch used to swallow the conversion —
 * the €5 was booked onto a code nobody owns and the real referrer's row stayed
 * unconverted. Both exclusions belong in SQL: the row we want is the first hit.
 */
async function attributableReferral(
  visitorId: string,
  actor: string | null,
  where: { signedUpAt: null } | { convertedAt: null; createdAt: { gte: Date } }
): Promise<string | null> {
  const row = await prisma.referral.findFirst({
    where: {
      visitorId,
      referrerId: { not: null, ...(actor ? { notIn: [actor] } : {}) },
      ...where,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Mark the visitor's referral as started: they began a checkout or a
 * subscription. This is NOT a payment and earns nothing (first time only).
 */
export async function recordSignup(visitorId: string, userId?: string): Promise<void> {
  if (!REFERRAL_ENABLED || !isDatabaseConfigured() || !visitorId) return;
  try {
    const id = await attributableReferral(visitorId, await actingUserId(userId), { signedUpAt: null });
    if (!id) return;
    await prisma.referral.update({ where: { id }, data: { signedUpAt: new Date() } });
  } catch (err) {
    logger.warn("[referrals] signup not recorded", err);
  }
}

/** The reward for one paid order and why it is what it is. Pure: no database. */
export function referralRewardFor(order: {
  totalEur: number;
  shippingEur: number;
  vatRate?: number | null;
  /** Cost of the goods ex btw, set at checkout ONLY when every line had a supplier quote (Order.costEur). */
  costEur: number | null;
}): { rewardEur: number; marginEur: number | null; reason: "ok" | "cost_unknown" | "no_margin" } {
  if (order.costEur === null || !Number.isFinite(order.costEur)) return { rewardEur: 0, marginEur: null, reason: "cost_unknown" };
  const rate = order.vatRate ?? VAT_RATE;
  const goodsExVat = (order.totalEur - order.shippingEur) / (1 + rate);
  // Shipping is assumed to cost what the standard fee brings in (ex btw). On a
  // free-shipping order nothing came in for it, so the carrier is paid out of the margin.
  const standardShippingExVat = SHIPPING.rateEur / (1 + rate);
  const shippingShortfall = Math.max(0, standardShippingExVat - order.shippingEur / (1 + rate));
  const marginEur = money(goodsExVat - order.costEur - shippingShortfall);
  const capped = Math.min(REWARD_EUR, Math.floor(marginEur * REWARD_SHARE_OF_MARGIN * 100) / 100);
  if (!(capped > 0)) return { rewardEur: 0, marginEur, reason: "no_margin" };
  return { rewardEur: money(capped), marginEur, reason: "ok" };
}

export type ConversionResult = { rewarded: boolean; rewardEur: number; reason: string };
const noReward = (reason: string): ConversionResult => ({ rewarded: false, rewardEur: 0, reason });

const normaliseEmail = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();

function amsterdamYearStart(now: Date): Date {
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric" }).format(now));
  // 1 January 00:00 Amsterdam is 23:00 UTC the day before in winter time.
  return new Date(Date.UTC(year, 0, 1) - 60 * 60 * 1000);
}

/**
 * Book the reward for a referral, if (and only if) `proof.orderId` is a PAID
 * first order of the referred person. Called from the code that has just seen
 * the payment: the Stripe webhook after fulfilment, and the bank-transfer
 * confirmation. Without proof it books nothing, whatever else the caller knows:
 * creating an order, issuing an invoice or starting a trial is not money.
 */
export async function recordConversion(
  visitorId: string,
  userId?: string,
  proof?: { orderId: string },
): Promise<ConversionResult> {
  if (!REFERRAL_ENABLED) return noReward("programme_off");
  if (!isDatabaseConfigured() || !visitorId) return noReward("not_tracked");
  if (!proof?.orderId) return noReward("no_payment_proof");
  const cutoff = new Date(Date.now() - ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    const order = await prisma.order.findUnique({
      where: { id: proof.orderId },
      select: {
        id: true, userId: true, email: true, status: true, createdAt: true,
        totalEur: true, shippingEur: true, vatRate: true, costEur: true,
        user: { select: { email: true } },
      },
    });
    if (!order) return noReward("order_not_found");
    if (!PAID_STATUSES.includes(order.status)) return noReward("order_not_paid");

    // The buyer's first PAID order: nothing paid before this one, by account or by e-mail address.
    const buyerEmails = [normaliseEmail(order.email), normaliseEmail(order.user?.email)].filter(Boolean);
    const earlier = await prisma.order.count({
      where: {
        id: { not: order.id },
        status: { in: PAID_STATUSES },
        OR: [{ userId: order.userId }, ...buyerEmails.map((email) => ({ email: { equals: email, mode: "insensitive" as const } }))],
        createdAt: { lte: order.createdAt },
      },
    });
    if (earlier > 0) return noReward("not_first_paid_order");

    const actor = userId ?? order.userId;
    const refId = await attributableReferral(visitorId, actor, { convertedAt: null, createdAt: { gte: cutoff } });
    if (!refId) return noReward("no_attributable_referral");

    const alreadyConverted = await prisma.referral.count({ where: { visitorId, convertedAt: { not: null } } });
    if (alreadyConverted > 0) return noReward("visitor_already_rewarded");

    const row = await prisma.referral.findUnique({
      where: { id: refId },
      select: { referrerId: true, referrer: { select: { email: true } } },
    });
    if (!row?.referrerId) return noReward("no_referrer");
    // The referrer buying through their own link: same e-mail address, however the order was placed.
    if (buyerEmails.includes(normaliseEmail(row.referrer?.email))) return noReward("self_referral");

    const { rewardEur: wanted, reason } = referralRewardFor(order);
    const yearTotal = await prisma.referral.aggregate({
      where: { referrerId: row.referrerId, convertedAt: { gte: amsterdamYearStart(new Date()) } },
      _sum: { rewardEur: true },
    });
    const room = Math.max(0, money(MAX_REWARD_PER_YEAR_EUR - (yearTotal._sum.rewardEur ?? 0)));
    const rewardEur = Math.min(wanted, room);

    // Conditional on still being unconverted, so a webhook retry or two parallel
    // calls book this referral once.
    const claimed = await prisma.referral.updateMany({
      where: { id: refId, convertedAt: null },
      data: { convertedAt: new Date(), rewardEur },
    });
    if (claimed.count === 0) return noReward("already_converted");
    return { rewarded: rewardEur > 0, rewardEur, reason: rewardEur > 0 ? "ok" : wanted > 0 ? "yearly_cap_reached" : reason };
  } catch (err) {
    logger.warn("[referrals] conversion not recorded", err);
    return noReward("error");
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
    // referrerId non-null on all three, the same rule attributableReferral()
    // applies. Rows keep their code when the referrer's account is deleted
    // (Referral.referrer is onDelete: SetNull), so a code that comes free and
    // is later handed to someone else would show them the previous owner's
    // clicks, conversions and euros. newCode() makes that collision remote,
    // but the clause costs nothing and this is a payout figure.
    const attributed = { code, referrerId: { not: null } };
    const [clicks, signups, converted] = await Promise.all([
      prisma.referral.count({ where: attributed }),
      prisma.referral.count({ where: { ...attributed, signedUpAt: { not: null } } }),
      prisma.referral.aggregate({ where: { ...attributed, convertedAt: { not: null } }, _count: { _all: true }, _sum: { rewardEur: true } }),
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
