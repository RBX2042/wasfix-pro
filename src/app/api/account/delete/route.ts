import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { isDemoMode } from "@/lib/demo-mode";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { logger } from "@/lib/logger";
import {
  OpenOrdersError,
  anonymizedEmailFor,
  blockingOrdersBody,
  eraseUserData,
  openOrdersMessage,
  ordersBlockingErasure,
  retentionNotes,
} from "@/lib/erasure";
import { supportEmail, supportHint } from "@/lib/support-contact";
import { endStripeSubscription, getStripe, scrubStripeCustomer } from "@/lib/stripe";
import { notifyOwner } from "@/lib/notify";

const Schema = z.object({
  confirmation: z.literal("VERWIJDER MIJN ACCOUNT"),
  reason: z.string().max(500).optional(),
});

// GDPR Art. 17 — Right to be Forgotten.
// Erase what has no basis to stay, anonymize the rows the bookkeeping needs,
// and retain the invoices — ours and the monteur's own. Art. 35a Wet OB and
// art. 52 AWR put a 7-year retention on exactly those records, and that duty
// overrides the erasure right for them (art. 17(3)(b) AVG).
// The erasure steps live in src/lib/erasure.ts, shared with the Clerk
// user.deleted webhook so both doors erase the same things. This route adds
// what only a signed-in request can do: refuse while orders are open, cancel
// the Stripe subscription first, and delete the Clerk identity afterwards.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return apiError("Inloggen vereist", 401);

  const body = await req.json().catch(() => null);
  if (!body) return apiError("Ongeldige JSON", 400);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("Bevestiging-zin klopt niet", 400);

  if (isDemoMode()) {
    // The shared demo account can't be erased — that would break the demo for everyone.
    return apiSuccess({ demo: true, message: "In demo-modus wordt het gedeelde demo-account niet verwijderd." });
  }
  if (!isDatabaseConfigured()) {
    return apiSuccess({ message: "Er zijn geen opgeslagen gegevens om te verwijderen." });
  }

  // Irreversible and it touches every table this account owns; a stolen
  // session should not be able to hammer it. Below the short-circuits above on
  // purpose: in demo mode every visitor resolves to one shared account, so the
  // per-account bucket would be site-wide and the third visitor to open the
  // dialog would lock out the fourth over a call that erases nothing.
  if (!(await rateLimit(`account-delete:${getClientKey(req, user.id)}`, 3, 60 * 60 * 1000))) {
    return apiError("Te veel pogingen — probeer over een uur opnieuw.", 429);
  }

  // Refused before anything is touched: nothing is cancelled or erased.
  try {
    const blocking = await ordersBlockingErasure(prisma, user.id);
    if (blocking.length > 0) return apiError(openOrdersMessage(blocking), 409, blockingOrdersBody(blocking));
  } catch (err) {
    logger.error("[gdpr] could not check open orders", err);
    return apiError(`Verwijdering mislukt. Er is niets gewist. Probeer het later opnieuw of ${supportHint(supportEmail())}.`, 500);
  }

  // The Stripe subscription is cancelled BEFORE the ids that point at it are
  // cleared: afterwards nobody could cancel it, the card would keep being
  // charged for an account that no longer exists, and the person could not even
  // reach the billing portal. If Stripe cannot be reached the erasure stops here
  // with nothing erased, so the person can simply try again.
  const stripeState: { subscription: "none" | "cancelled" | "already_ended"; customerScrubbed: boolean | null } = { subscription: "none", customerScrubbed: null };
  const anonymizedEmail = anonymizedEmailFor(user.id);
  let stripeCustomerId: string | null = null;
  try {
    const account = await prisma.user.findUnique({ where: { id: user.id }, select: { stripeSubId: true, stripeCustomerId: true } });
    if (account?.stripeSubId || account?.stripeCustomerId) {
      const stripe = getStripe();
      if (account.stripeSubId) {
        if (!stripe) {
          logger.error("[gdpr] account has a Stripe subscription but Stripe is not configured — erasure refused", { userId: user.id });
          return apiError(
            `Je account heeft een abonnement bij onze betaalprovider en die kunnen we nu niet bereiken. Er is niets gewist. Probeer het later opnieuw of ${supportHint(supportEmail())}.`,
            503
          );
        }
        stripeState.subscription = await endStripeSubscription(stripe, account.stripeSubId, `account-erase-${user.id}-${account.stripeSubId}`);
        if (stripeState.subscription === "cancelled") logger.info("[gdpr] Stripe subscription cancelled before erasure", { userId: user.id, subscription: account.stripeSubId });
      }
      stripeCustomerId = account.stripeCustomerId;
    }
  } catch (err) {
    logger.error("[gdpr] could not cancel the Stripe subscription — erasure stopped, nothing erased", err);
    await notifyOwner({ event: "gdpr.stripe_cancel_failed", level: "error", title: "Accountverwijdering gestopt: abonnement niet op te zeggen", lines: ["Een klant wil zijn account verwijderen, maar het abonnement kon bij Stripe niet worden opgezegd. Er is niets gewist."] });
    return apiError(`We konden je abonnement niet opzeggen bij onze betaalprovider, daarom is er niets gewist. Probeer het over enkele minuten opnieuw of ${supportHint(supportEmail())}.`, 502);
  }

  try {
    // One transaction, and no swallowed errors inside it: it either commits or nothing happened
    // (see eraseUserData). Invoice issuance is inside it too, so a failure later in the erasure
    // cannot leave a brand-new invoice carrying this person's name and address, retained seven
    // years, while the reply says "er is niets gewist".
    const outcome = await eraseUserData({ userId: user.id, email: user.email, openOrders: "refuse" });

    // After the commit, never before: a scrubbed Stripe customer cannot be
    // restored, and the erasure above could still have rolled back. Best effort:
    // the customer record at Stripe carries this person's name, e-mail address
    // and billing address, and what we can do is stop the live record from
    // identifying them. Invoices Stripe already issued are not rewritten by this.
    const stripe = stripeCustomerId ? getStripe() : null;
    if (stripeCustomerId) {
      try {
        if (!stripe) throw new Error("stripe_not_configured");
        await scrubStripeCustomer(stripe, stripeCustomerId, anonymizedEmail);
        stripeState.customerScrubbed = true;
      } catch (err) {
        stripeState.customerScrubbed = false;
        logger.warn("[gdpr] Stripe customer could not be anonymised", err);
        await notifyOwner({
          event: "gdpr.stripe_customer",
          level: "warn",
          title: "Verwijder een klant handmatig in Stripe",
          lines: [`Klant ${stripeCustomerId} hoort bij een verwijderd account en kon niet automatisch worden geanonimiseerd.`],
        });
      }
    }

    // Remove the Clerk identity too so the login stops working.
    try {
      const { clerkClient, auth } = await import("@clerk/nextjs/server");
      const { userId: clerkId } = await auth();
      if (clerkId) await (await clerkClient()).users.deleteUser(clerkId);
    } catch (err) {
      logger.warn("[gdpr] Clerk user delete failed (continuing)", err);
    }

    logger.info("[gdpr] account erased", { userId: user.id, reason: parsed.data.reason, ...outcome });

    // Name every exception this account actually has, and only those (retentionNotes): telling the
    // data subject "everything is gone" while invoices and un-invoiced orders keep their details is
    // a false statement about an art. 17 request, and naming a retention that does not apply to
    // them is just as wrong.
    const exceptions = [
      ...retentionNotes(outcome),
      stripeState.customerScrubbed === false
        ? "Je naam en adres bij onze betaalprovider (Stripe) konden we niet automatisch wissen; we doen dat handmatig en de eigenaar is daarvan op de hoogte gesteld."
        : "",
      // Said because it is true and because "alles is gewist" would not be: the
      // customer record is anonymised and its saved payment methods are detached,
      // but the payments and invoices Stripe has already issued are not rewritten.
      stripeState.customerScrubbed === true
        ? "Bij onze betaalprovider (Stripe) zijn je naam, e-mailadres, adres en opgeslagen betaalmethoden gewist. De betalingen en facturen die Stripe al heeft vastgelegd blijven bij Stripe staan; die kunnen wij niet aanpassen."
        : "",
    ].filter(Boolean);

    const subscriptionText =
      stripeState.subscription === "cancelled"
        ? "Je abonnement is opgezegd; er worden geen nieuwe betalingen meer afgeschreven."
        : stripeState.subscription === "already_ended"
          ? "Je abonnement liep al niet meer."
          : "";

    return apiSuccess({
      subscription: stripeState.subscription,
      retained: {
        invoices: outcome.retainedInvoices,
        creditNotes: outcome.retainedCreditNotes,
        monteurInvoices: outcome.retainedMonteurInvoices,
        orderRows: outcome.orderRows,
        ordersAwaitingInvoice: outcome.ordersAwaitingInvoice,
        ordersKeptOpen: outcome.ordersKeptOpen,
        guestOrdersAdopted: outcome.guestOrdersAdopted,
      },
      message: [
        exceptions.length === 0
          ? "Account verwijderd. Alles is gewist of geanonimiseerd."
          : ["Account verwijderd. Alles is gewist of geanonimiseerd, op deze uitzonderingen na:", ...exceptions].join(" "),
        subscriptionText,
        // Said because it is true and because the person would otherwise not know those orders were part of it.
        outcome.guestOrdersAdopted > 0
          ? `Ook de bestellingen die je als gast met dit e-mailadres hebt geplaatst (${outcome.guestOrdersAdopted}) zijn in deze verwijdering meegenomen.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    });
  } catch (err) {
    // The transaction rolled back, so no data was erased — say that, rather
    // than leaving the data subject to guess how far it got. The subscription is
    // the one thing that may already be gone, and that is said too.
    const cancelled = stripeState.subscription === "cancelled" ? " Je abonnement is wel al opgezegd." : "";
    if (err instanceof OpenOrdersError) {
      return apiError(`${openOrdersMessage(err.orders)}${cancelled}`, 409, blockingOrdersBody(err.orders));
    }
    logger.error("[gdpr] account delete failed", err);
    return apiError(`Verwijdering mislukt. Er is geen data gewist.${cancelled} Probeer het later opnieuw of ${supportHint(supportEmail())}.`, 500);
  }
}
