import { getPlan, type PlanId } from "@/lib/plans";

/**
 * The consumer's request for immediate start and acknowledgement of the loss of
 * the right of withdrawal, asked before a consumer subscription is created
 * (art. 6:230m BW). One text, used by the checkbox (upgrade-button.tsx), the
 * server check (/api/stripe/subscribe) and the line Stripe shows on its payment
 * page, so what the customer ticked is what is recorded.
 *
 * LEGAL REVIEW NEEDED: the wording is a draft for the owner's lawyer (see the
 * report of bundle S5). Business plans are sold to businesses, which have no
 * withdrawal right, so they are not asked.
 */
export const WITHDRAWAL_WAIVER_TEXT =
  "Ik wil dat de dienst direct begint, ook tijdens de bedenktijd van 14 dagen. Ik begrijp dat ik mijn herroepingsrecht verlies zodra WasFix de dienst volledig heeft uitgevoerd, en dat ik bij herroeping voor die tijd een evenredig deel betaal van wat al is geleverd.";

/** Whether this plan's buyer must give that consent: consumer plans only. */
export function requiresWithdrawalWaiver(plan: PlanId | string): boolean {
  return getPlan(plan).audience === "consumer" && getPlan(plan).priceCents > 0;
}
