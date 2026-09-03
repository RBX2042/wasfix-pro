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

  try {
    // The full cuid, not an 8-character prefix: User.email is @unique and
    // those 8 characters are only the cuid timestamp, so two accounts created
    // within the same ~36 ms produced the same anonymised address and the
    // second erasure died on the unique constraint halfway through.
    const anonymizedEmail = `deleted-${user.id}@anon.wasfix.nl`;

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

        // Last, so the e-mail-keyed cleanups above still matched the real address.
        // stripeCustomerId goes too: it is a live handle to a Stripe record with
        // this person's name and address on it.
        await tx.user.update({
          where: { id: user.id },
          data: { email: anonymizedEmail, name: "Verwijderd account", clerkId: null, stripeSubId: null, stripeCustomerId: null, referralCode: null },
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
    ].filter(Boolean);

    return apiSuccess({
      message:
        exceptions.length === 0
          ? "Account verwijderd. Alles is gewist of geanonimiseerd."
          : ["Account verwijderd. Alles is gewist of geanonimiseerd, op deze uitzonderingen na:", ...exceptions].join(" "),
    });
  } catch (err) {
    // The transaction rolled back, so nothing was erased — say that, rather
    // than leaving the data subject to guess how far it got.
    logger.error("[gdpr] account delete failed", err);
    return apiError("Verwijdering mislukt. Er is niets gewist. Mail privacy@wasfix.nl voor handmatige afhandeling.", 500);
  }
}
