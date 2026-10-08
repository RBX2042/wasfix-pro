import { getCurrentUser, getPlanLimits, planDisplayName } from "@/lib/auth";
import { getEntitlements } from "@/lib/entitlements";
import { apiError, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * What the signed-in person is entitled to right now. Used by the member price
 * on product pages and by the post-payment confirmation, which polls it until
 * the Stripe webhook has switched the plan.
 *
 * `plan` is the plan the account is entitled to (effectivePlan); `storedPlan` is
 * what is on file, which differs after a lapsed or cancelled subscription. The
 * diagnosis counters come from the rolling-window quota that /api/diagnose
 * really enforces, not from a lifetime counter.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Niet ingelogd", 401);

  const limits = getPlanLimits(user);
  const entitlements = await getEntitlements(user);
  const status = user.subscriptionStatus ?? null;

  return apiSuccess({
    plan: user.plan,
    planName: planDisplayName(user.plan),
    storedPlan: user.storedPlan ?? user.plan,
    role: user.role,
    subscriptionStatus: status,
    trialing: status === "trialing",
    currentPeriodEnd: user.currentPeriodEnd ? user.currentPeriodEnd.toISOString() : null,
    cancelAtPeriodEnd: user.cancelAtPeriodEnd ?? false,
    diagnosesUsed: entitlements.diagnosesUsed,
    diagnosesLimit: limits.diagnosesPerMonth,
    diagnosesRemaining: entitlements.diagnosesRemaining,
    // 0 while the subscription is trialing (the trial rule, see getPlanLimits in src/lib/auth.ts); the discount the plan gives
    // once the first payment is made is partsDiscountWhenPaying.
    partsDiscount: limits.partsDiscount,
    partsDiscountWhenPaying: limits.partsDiscountWhenPaying,
    premiumGuides: limits.premiumGuides,
  });
}
