import { getPlan } from "@/lib/plans";
import { subscriptionNotice } from "@/lib/subscription";
import type { DemoUser } from "@/lib/auth";
import type { BannerNotice } from "./subscription-banner";

/**
 * The banner for this account, or null. Looks at the plan STORED on the row
 * (what the customer is paying for), not the entitled one: after a lapse the
 * entitled plan is FREE, which is exactly when the customer needs the notice.
 */
export function bannerFor(user: Pick<DemoUser, "storedPlan" | "plan" | "subscriptionStatus" | "currentPeriodEnd" | "cancelAtPeriodEnd">): BannerNotice | null {
  const notice = subscriptionNotice({
    plan: user.storedPlan ?? user.plan,
    stripeSubStatus: user.subscriptionStatus,
    stripeCurrentPeriodEnd: user.currentPeriodEnd,
    stripeCancelAtPeriodEnd: user.cancelAtPeriodEnd,
  });
  if (!notice) return null;
  const planName = getPlan(notice.plan).name;
  switch (notice.kind) {
    case "past_due":
      return { kind: "past_due", planName, graceEndsAt: notice.graceEndsAt ? notice.graceEndsAt.toISOString() : null, lapsed: notice.lapsed };
    case "payment_required":
      return { kind: "payment_required", planName };
    case "ending":
      return { kind: "ending", planName, endsAt: notice.endsAt.toISOString() };
  }
}
