import { getCurrentUser } from "@/lib/auth";
import { canReadPremiumGuide } from "@/lib/entitlements";

/**
 * May the person making this request read the full steps of a premium guide?
 *
 * The guide page decided this per request and showed the first two steps to
 * everybody else, but the JSON APIs returned all steps to anybody. Every API that
 * serialises a guide asks this once and passes the answer to redactGuide()
 * (static-db). Anonymous callers and the FREE plan get the preview; the plan check
 * itself stays in entitlements.canReadPremiumGuide, so what a plan includes is
 * defined in one place.
 */
export async function viewerCanReadPremiumGuides(): Promise<boolean> {
  const user = await getCurrentUser().catch(() => null);
  return canReadPremiumGuide(user?.plan);
}
