import { NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { prisma } from "@/lib/prisma";
import { env, isDatabaseConfigured } from "@/lib/env";
import { notifyOwner } from "@/lib/notify";
import { orderRef } from "@/lib/order-status";
import { sendRmaReceivedEmail } from "@/app/admin/_lib/mails";
import { resolveOrderForReturn } from "@/app/retour/_lib/resolve-order";

const Schema = z.object({
  // What the customer typed: the order number from the mail, the invoice number, or the full id from the link.
  orderId: z.string().trim().min(2).max(60),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  reason: z.enum(["DEFECT", "WRONG_PART", "WRONG_ORDER", "WITHDRAWAL", "OTHER"]),
  notes: z.string().trim().min(8).max(2000),
  // The order's access token when the customer comes from the link on their order page.
  token: z.string().trim().max(100).optional(),
});

const RECEIVED_MESSAGE = "Je retour-aanvraag is ontvangen. Bewaar je RMA-nummer; na beoordeling mailen we je het retouradres en de instructies.";
const MAX_PER_EMAIL_PER_DAY = 5;
const MAX_UNLINKED_PINGS_PER_HOUR = 10;

const REASON_LABEL: Record<string, string> = {
  DEFECT: "Defect of beschadigd",
  WRONG_PART: "Verkeerd onderdeel",
  WRONG_ORDER: "Verkeerd besteld",
  WITHDRAWAL: "Bedenktijd (herroeping)",
  OTHER: "Anders",
};

/**
 * Return intake.
 *
 * The answer is the same whether or not the reference matched an order: the form
 * must not tell a stranger which order numbers exist. What differs is what we
 * store: linkedOrderId is set only when the customer proves the order is theirs
 * (token, or the e-mail of the order), and the owner is told which case it is,
 * without any personal data in the message (the channels are shared).
 */
export async function POST(req: NextRequest) {
  try {
    // Rate limit: 5 per hour per IP (anti-spam)
    if (!(await rateLimit(`retour:${getClientKey(req)}`, 5, 60 * 60 * 1000))) {
      return apiError("Te veel aanvragen. Probeer over een uur opnieuw.", 429);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return apiError("Ongeldige JSON", 400);

    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return apiError("Controleer je gegevens: alle velden zijn verplicht en de toelichting is minstens 8 tekens.", 400, parsed.error.flatten());
    }
    const { orderId, name, email, reason, notes, token } = parsed.data;

    // An RMA stored nowhere must never be answered with "received": the customer stops chasing
    // it while the withdrawal period runs out. Outside production (no database) it is accepted
    // so the demo works; in production there is nothing to accept it with.
    if (!isDatabaseConfigured() && env.IS_PRODUCTION) {
      return apiError("Je retour-aanvraag kon nu niet worden opgeslagen. Probeer het over een paar minuten opnieuw.", 503);
    }

    const rmaNumber = `RMA-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    let linkedOrderId: string | null = null;
    let ackTo: string | null = null;

    let notifyAsUnlinked = true;
    if (isDatabaseConfigured()) {
      try {
        const resolved = await resolveOrderForReturn(orderId, email, token);
        linkedOrderId = resolved?.id ?? null;
        ackTo = resolved?.email ?? null;

        // A double click or a re-sent form: the SAME request (same person, order text, reason and notes)
        // while the first one is still unanswered gets the first RMA number back instead of a second row.
        // A different request about the same order (another part, another reason) is a new return and
        // must be stored: answering "received" for something stored nowhere makes the customer stop
        // chasing it while the withdrawal period runs out.
        const day = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const existing = await prisma.rmaRequest.findFirst({
          where: { email, orderId, reason, notes, status: "RECEIVED", createdAt: { gte: day } },
          select: { rmaNumber: true },
          orderBy: { createdAt: "desc" },
        });
        if (existing) {
          return apiSuccess({ rmaNumber: existing.rmaNumber, message: RECEIVED_MESSAGE });
        }

        // Database-backed caps. The per-IP limit above is in memory per server instance unless Upstash is
        // configured, so on its own it does not stop someone who spreads requests over instances.
        if ((await prisma.rmaRequest.count({ where: { email, createdAt: { gte: day } } })) >= MAX_PER_EMAIL_PER_DAY) {
          return apiError("Voor dit e-mailadres zijn vandaag al meerdere retour-aanvragen ingediend. Mail ons voor een volgende aanvraag.", 429);
        }
        // Requests that do not match an order cost the owner a ping each; past a handful per hour the
        // rows are still stored and listed in /admin/retouren, but the channels stay quiet.
        if (!linkedOrderId) {
          const hour = new Date(Date.now() - 60 * 60 * 1000);
          notifyAsUnlinked = (await prisma.rmaRequest.count({ where: { linkedOrderId: null, createdAt: { gte: hour } } })) < MAX_UNLINKED_PINGS_PER_HOUR;
        }

        await prisma.rmaRequest.create({ data: { rmaNumber, orderId, linkedOrderId, name, email, reason, notes } });
      } catch (err) {
        logger.error("RMA persist failed", err);
        return apiError("Je retour-aanvraag kon nu niet worden opgeslagen. Probeer het over een paar minuten opnieuw.", 503);
      }
    }

    logger.info("RMA request received", { rmaNumber, reason, linked: linkedOrderId !== null });

    // The owner hears about it on the shared channels (no personal data) ...
    if (linkedOrderId || notifyAsUnlinked) {
      await notifyOwner({
        event: "rma.received",
        title: `Nieuwe retour-aanvraag ${rmaNumber}`,
        lines: [
          `Reden: ${REASON_LABEL[reason]}`,
          linkedOrderId ? `Gekoppeld aan bestelling #${orderRef(linkedOrderId)}` : "NIET gekoppeld aan een bestelling: controleer het bestelnummer en e-mailadres",
        ],
        url: "/admin/retouren",
        level: linkedOrderId ? "info" : "warn",
      });
    } else {
      logger.warn("RMA owner ping suppressed: too many unlinked requests this hour", { rmaNumber });
    }
    // ... and the customer gets the acknowledgement, but ONLY when the request proved it belongs to an
    // order (token or the order's e-mail). Otherwise this endpoint would mail a text to any address a
    // stranger types, from the shop's sender. Unlinked requests are answered on screen and the owner
    // contacts the person after checking. The acknowledgement promises nothing we do not do: the
    // instructions follow after review, when the owner approves the return.
    if (linkedOrderId && ackTo) {
      // To the ORDER's address: with a valid token the typed e-mail can be anything, and the mail must not become a way to write to strangers.
      const ack = await sendRmaReceivedEmail(ackTo, { rmaNumber, name }).catch(() => ({ ok: false }));
      if (!ack.ok) logger.warn("RMA acknowledgement not sent", { rmaNumber });
    }

    return apiSuccess({ rmaNumber, message: RECEIVED_MESSAGE });
  } catch (err) {
    logger.error("RMA endpoint error", err);
    return apiError("Aanvraag kon niet worden verwerkt", 500);
  }
}
