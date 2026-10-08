import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { isDemoMode } from "@/lib/demo-mode";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { logger } from "@/lib/logger";
import { issueInvoiceForOrder } from "@/lib/invoicing";
import { orderRef } from "@/lib/order-status";
import { endStripeSubscription, getStripe, scrubStripeCustomer } from "@/lib/stripe";
import { notifyOwner } from "@/lib/notify";

const Schema = z.object({
  confirmation: z.literal("VERWIJDER MIJN ACCOUNT"),
  reason: z.string().max(500).optional(),
});

// What replaces free text we cannot keep but whose row must survive.
const REDACTED = "Verwijderd op verzoek (AVG art. 17)";

// Order.shippingAddress is a JSON string — checkout writes JSON.stringify and
// every reader parses it back, src/app/bestelling/[id]/page.tsx with an
// unguarded JSON.parse. A plain sentence in that column throws a SyntaxError
// and 500s the order page for the customer and for admins, so the redaction
// keeps the JSON shape and blanks the fields inside it.
const REDACTED_ADDRESS = JSON.stringify({
  redacted: true,
  name: REDACTED,
  street: "",
  houseNumber: "",
  postalCode: "",
  city: "",
  country: "NL",
});

// The statuses on which an invoice is due — the same list
// src/app/bestelling/[id]/factuur/page.tsx uses to issue a missing one.
const INVOICED_STATUSES = ["PAID", "SHIPPED", "DELIVERED"];

// An order that is not finished needs the contact details this erasure would
// blank: PAID must still be shipped, OPENSTAAND is waiting for a bank transfer,
// SHIPPED can still be refused at the door or returned, and a DELIVERED order
// stays refundable for the 30-day return window. A refund also needs the
// customer reachable. PENDING is a Stripe payment that may still arrive; one
// older than a Checkout session can live (24 h, plus a margin) is abandoned and
// does not block.
const PENDING_BLOCKS_FOR_MS = 25 * 60 * 60 * 1000;
const RETURN_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const ORDER_STATE_TEXT: Record<string, string> = {
  PAID: "is betaald maar nog niet verzonden",
  OPENSTAAND: "wacht op je overschrijving",
  PENDING: "is nog niet afgerond bij de betaalpagina",
  SHIPPED: "is onderweg naar je toe",
  DELIVERED: "is bezorgd en valt nog binnen de retourtermijn",
};

type BlockingOrder = { id: string; status: string; deliveredAt: Date | null; updatedAt: Date };
type OrderReader = Pick<typeof prisma, "order">;
async function ordersBlockingErasure(db: OrderReader, userId: string): Promise<BlockingOrder[]> {
  const returnWindowStart = new Date(Date.now() - RETURN_WINDOW_DAYS * DAY_MS);
  return db.order.findMany({
    where: {
      userId,
      OR: [
        { status: { in: ["PAID", "OPENSTAAND", "SHIPPED"] } },
        { status: "PENDING", createdAt: { gte: new Date(Date.now() - PENDING_BLOCKS_FOR_MS) } },
        // deliveredAt is null on rows delivered before the column existed; updatedAt is the best date left for those.
        { status: "DELIVERED", OR: [{ deliveredAt: { gte: returnWindowStart } }, { deliveredAt: null, updatedAt: { gte: returnWindowStart } }] },
      ],
    },
    select: { id: true, status: true, deliveredAt: true, updatedAt: true },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
}

/** The first day erasure is possible again, when the blocking orders have a known end. */
function blockedUntil(orders: BlockingOrder[]): Date | null {
  if (orders.some((o) => o.status !== "DELIVERED")) return null; // an unfinished order has no date yet
  const ends = orders.map((o) => new Date((o.deliveredAt ?? o.updatedAt).getTime() + RETURN_WINDOW_DAYS * DAY_MS).getTime());
  return ends.length ? new Date(Math.max(...ends)) : null;
}

class OpenOrdersError extends Error {
  constructor(readonly orders: BlockingOrder[]) {
    super("open_orders");
  }
}

function openOrdersMessage(orders: BlockingOrder[]): string {
  const list = orders.map((o) => `#${orderRef(o.id)} ${ORDER_STATE_TEXT[o.status] ?? "loopt nog"}`).join("; ");
  const until = blockedUntil(orders);
  const when = until
    ? `Probeer het opnieuw na ${new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }).format(until)}.`
    : "Wacht tot de bestelling is bezorgd (en de retourtermijn van 30 dagen voorbij is) of geannuleerd.";
  return `Je account kan nog niet worden verwijderd: bestelling ${list}. We hebben je e-mailadres en bezorgadres nodig om die te verzenden, terug te nemen of terug te betalen. ${when} Of mail privacy@wasfix.nl, dan regelen we het samen. Er is niets gewist.`;
}

const blockingOrdersBody = (orders: BlockingOrder[]) => ({ orders: orders.map((o) => ({ ref: orderRef(o.id), status: o.status })) });

// GDPR Art. 17 — Right to be Forgotten.
// Erase what has no basis to stay, anonymize the rows the bookkeeping needs,
// and retain the invoices — ours and the monteur's own. Art. 35a Wet OB and
// art. 52 AWR put a 7-year retention on exactly those records, and that duty
// overrides the erasure right for them (art. 17(3)(b) AVG).
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
    return apiError("Verwijdering mislukt. Er is niets gewist. Mail privacy@wasfix.nl voor handmatige afhandeling.", 500);
  }

  // The Stripe subscription is cancelled BEFORE the ids that point at it are
  // cleared: afterwards nobody could cancel it, the card would keep being
  // charged for an account that no longer exists, and the person could not even
  // reach the billing portal. If Stripe cannot be reached the erasure stops here
  // with nothing erased, so the person can simply try again.
  const stripeState: { subscription: "none" | "cancelled" | "already_ended"; customerScrubbed: boolean | null } = { subscription: "none", customerScrubbed: null };
  const anonymizedEmail = `deleted-${user.id}@anon.wasfix.nl`;
  let stripeCustomerId: string | null = null;
  try {
    const account = await prisma.user.findUnique({ where: { id: user.id }, select: { stripeSubId: true, stripeCustomerId: true } });
    if (account?.stripeSubId || account?.stripeCustomerId) {
      const stripe = getStripe();
      if (account.stripeSubId) {
        if (!stripe) {
          logger.error("[gdpr] account has a Stripe subscription but Stripe is not configured — erasure refused", { userId: user.id });
          return apiError(
            "Je account heeft een abonnement bij onze betaalprovider en die kunnen we nu niet bereiken. Er is niets gewist. Probeer het later opnieuw of mail privacy@wasfix.nl.",
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
    return apiError("We konden je abonnement niet opzeggen bij onze betaalprovider, daarom is er niets gewist. Probeer het over enkele minuten opnieuw of mail privacy@wasfix.nl.", 502);
  }

  try {
    // The full cuid, not an 8-character prefix: User.email is @unique and
    // those 8 characters are only the cuid timestamp, so two accounts created
    // within the same ~36 ms produced the same anonymised address and the
    // second erasure died on the unique constraint halfway through.
    // One transaction, and no swallowed errors inside it. Half-erased is the
    // worst outcome: with the identity anonymised last and every write
    // catching its own failure, a single rejection left the data deleted while
    // the real e-mail, the name and a working login stayed — and the caller
    // was told it had all gone. Now it either commits or nothing happened.
    //
    // Invoice issuance is inside it too. It used to run just above, in its own
    // transaction, so a failure here still left a brand-new invoice carrying
    // this person's name and address — retained seven years — while the reply
    // said "er is niets gewist". issueInvoiceForOrder takes our tx for exactly
    // this reason; the caller's transaction serialises the number allocation
    // just as well as its own would.
    const { retainedInvoices, retainedMonteurInvoices, ordersAwaitingInvoice } = await prisma.$transaction(
      async (tx) => {
        // Checked again inside the transaction: an order paid in the seconds since
        // the check above would otherwise lose the address it still has to be
        // shipped to.
        const blocking = await ordersBlockingErasure(tx, user.id);
        if (blocking.length > 0) throw new OpenOrdersError(blocking);

        // Issue the invoice first, redact after. issueInvoiceForOrder builds
        // the buyer's name and address purely from order.shippingAddress and
        // order.email (src/lib/invoicing.ts), so blanking those before the
        // invoice exists makes the Stripe webhook write an invoice without the
        // details art. 35a Wet OB requires — and there is no other copy left.
        const orders = await tx.order.findMany({
          where: { userId: user.id, invoice: { is: null }, status: { in: INVOICED_STATUSES } },
          select: { id: true },
          // Bounded so one account cannot hold the transaction open past its
          // timeout. Anything beyond this keeps its details and is reported as
          // awaiting an invoice, so a second request finishes the job.
          take: 50,
        });
        for (const order of orders) {
          await issueInvoiceForOrder(order.id, tx);
        }

        // Read before deleting: DiagnosisFeedback has no user column, so those
        // rows are only reachable through this account's diagnoses, and the
        // referral rows are also reachable by code.
        const diagnoses = await tx.diagnosis.findMany({ where: { userId: user.id }, select: { id: true } });
        const account = await tx.user.findUnique({ where: { id: user.id }, select: { referralCode: true } });

        // Monteur CRM: names, addresses, phone numbers and IBANs of this
        // monteur and of their own customers. None of that has a basis to
        // outlive the account — except the invoices the monteur issued
        // themselves. They are the seller on those, art. 52 AWR makes them
        // keep them 7 years, and deleting them would tear a hole in a number
        // series the Belastingdienst requires to be gapless while
        // MonteurInvoiceSequence stays advanced. So only work orders without
        // an invoice go; an invoiced one has to stay (MonteurInvoice pins it
        // with onDelete: Restrict) and is stripped of its free text instead.
        await tx.workOrder.deleteMany({ where: { ownerId: user.id, invoice: { is: null } } });
        await tx.workOrder.updateMany({ where: { ownerId: user.id, notes: { not: null } }, data: { notes: REDACTED } });
        await tx.customer.deleteMany({ where: { ownerId: user.id } });

        // Hard-delete data without legal retention requirements.
        // Matched on diagnosisId only: Diagnosis.sessionId comes straight from
        // the request body (api/diagnose validates it as free text), so a
        // caller who plants a diagnosis carrying someone else's session id
        // would have this delete their feedback. The widget always sends the
        // diagnosis id.
        await tx.diagnosisFeedback.deleteMany({ where: { diagnosisId: { in: diagnoses.map((d) => d.id) } } });
        await tx.diagnosis.deleteMany({ where: { userId: user.id } });
        await tx.savedMachine.deleteMany({ where: { userId: user.id } });
        await tx.apiKey.deleteMany({ where: { userId: user.id } });
        await tx.monteurProfile.deleteMany({ where: { userId: user.id } });
        await tx.monteurApplication.deleteMany({ where: { email: user.email } });
        await tx.newsletterSubscriber.deleteMany({ where: { email: user.email } });
        await tx.referral.deleteMany({
          where: account?.referralCode ? { OR: [{ referrerId: user.id }, { code: account.referralCode }] } : { referrerId: user.id },
        });
        await tx.review.updateMany({ where: { email: user.email }, data: { email: anonymizedEmail, author: "Anoniem" } });
        // The RMA row stays attached to its order for the refund trail, but the
        // reporter's name and their free-text notes are not part of that trail.
        await tx.rmaRequest.updateMany({
          where: { email: user.email },
          data: { name: "Verwijderd account", email: anonymizedEmail, notes: REDACTED },
        });
        // The order row is the accounting record, so it survives — but the
        // contact details on it are a duplicate. Art. 35a Wet OB wants the
        // buyer's name and address on the *invoice*, and Invoice.buyerJson
        // snapshots exactly that, so the copy on the order can go — but only
        // once that invoice exists. Without one the order is the only source
        // of it. vatNumber stays: the VAT return is reconciled against it.
        await tx.order.updateMany({
          where: { userId: user.id, invoice: { isNot: null } },
          data: { email: anonymizedEmail, shippingAddress: REDACTED_ADDRESS },
        });
        // Contact details the bookkeeping never needs, on EVERY order of this account
        // (also the ones still waiting for an invoice, whose e-mail and address stay):
        // the phone number and the free-text note to the courier. The guest link
        // (?t=...) goes too, so an order URL that was mailed or shared stops working;
        // without a token the page only answers its signed-in owner (this account no
        // longer has a login) and an admin.
        await tx.order.updateMany({
          where: { userId: user.id },
          data: { phone: null, customerNote: null, accessToken: null },
        });

        // Last, so the e-mail-keyed cleanups above still matched the real address.
        // stripeCustomerId goes too: it is a live handle to a Stripe record with
        // this person's name and address on it.
        await tx.user.update({
          where: { id: user.id },
          data: {
            email: anonymizedEmail,
            name: "Verwijderd account",
            clerkId: null,
            stripeSubId: null,
            stripeCustomerId: null,
            // The subscription was cancelled above; the account must not keep the
            // plan it was paying for.
            plan: "FREE",
            stripeSubStatus: null,
            stripeCurrentPeriodEnd: null,
            referralCode: null,
          },
        });

        // What is left standing decides what we may claim in the reply.
        return {
          retainedInvoices: await tx.invoice.count({ where: { order: { userId: user.id } } }),
          retainedMonteurInvoices: await tx.monteurInvoice.count({ where: { ownerId: user.id } }),
          ordersAwaitingInvoice: await tx.order.count({ where: { userId: user.id, invoice: { is: null } } }),
        };
      },
      { timeout: 20_000 },
    );

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

    logger.info("[gdpr] account erased", { userId: user.id, reason: parsed.data.reason, retainedInvoices, retainedMonteurInvoices, ordersAwaitingInvoice });

    // Name every exception this account actually has, and only those: telling
    // the data subject "everything is gone" while invoices and un-invoiced
    // orders keep their details is a false statement about an art. 17 request,
    // and naming a retention that does not apply to them is just as wrong.
    const exceptions = [
      retainedInvoices > 0
        ? "de facturen van je bestellingen bewaren we 7 jaar (fiscale bewaarplicht) en daarop blijven je naam en adres staan, omdat art. 35a Wet OB die op een factuur verplicht. De bestellingen zelf zijn losgekoppeld van je e-mailadres en bezorgadres."
        : "",
      retainedMonteurInvoices > 0
        ? (retainedMonteurInvoices === 1
            ? "De factuur die je zelf als monteur hebt verstuurd blijft staan, met de werkorder waaruit hij is opgemaakt:"
            : `De ${retainedMonteurInvoices} facturen die je zelf als monteur hebt verstuurd blijven staan, met de werkorders waaruit ze zijn opgemaakt:`) +
          " jij bent daarop de verkoper en art. 52 AWR verplicht je die 7 jaar te bewaren. Je klantenbestand en je werkorders zonder factuur zijn wel gewist."
        : "",
      ordersAwaitingInvoice > 0
        ? (ordersAwaitingInvoice === 1
            ? "Bij één bestelling is nog geen factuur aangemaakt;"
            : `Bij ${ordersAwaitingInvoice} bestellingen is nog geen factuur aangemaakt;`) +
          " daar blijven je e-mailadres en bezorgadres staan tot die factuur er is, omdat we hem anders niet met de wettelijk verplichte gegevens kunnen uitschrijven. Mail privacy@wasfix.nl als je daar vragen over hebt."
        : "",
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
      message: [
        exceptions.length === 0
          ? "Account verwijderd. Alles is gewist of geanonimiseerd."
          : ["Account verwijderd. Alles is gewist of geanonimiseerd, op deze uitzonderingen na:", ...exceptions].join(" "),
        subscriptionText,
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
    return apiError(`Verwijdering mislukt. Er is geen data gewist.${cancelled} Mail privacy@wasfix.nl voor handmatige afhandeling.`, 500);
  }
}
