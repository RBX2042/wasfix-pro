"use server";

/**
 * Return (RMA) handling with real effects.
 *
 *   RECEIVED --approve--> APPROVED  : the customer gets the return address, the deadline and who pays shipping
 *   RECEIVED/APPROVED/RETURN_RECEIVED --reject--> REJECTED : the customer gets the reason
 *   APPROVED --received--> RETURN_RECEIVED : the customer is told the parcel arrived
 *   APPROVED/RETURN_RECEIVED --refund--> REFUNDED : recordRefund (credit note, stock, e-mail) and the RMA closes
 *   APPROVED/RETURN_RECEIVED --close--> REFUNDED : only when the order was already refunded from the order
 *       desk; books nothing, records a note. Without it such a return could neither be refunded (nothing
 *       left to refund) nor closed, and stayed in "Open retouren" for ever.
 *
 * Every transition is an updateMany with the expected status in the WHERE
 * (decision D3), so a double click or two admins cannot both win. The refund is
 * booked BEFORE the RMA closes and under a key derived from the RMA id, so a
 * retry after a half-failed attempt replays the same credit note instead of
 * paying twice.
 */
import { refreshPath as revalidatePath } from "../_lib/revalidate";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { parseMoney } from "@/lib/export-csv";
import { adminGuard, done, fail, type ActionState } from "../_lib/guard";
import { performRefund, readRestock } from "../_lib/refund";
import { RETURN_SHIP_DAYS, realReturnAddress } from "../_lib/rma";
import { sendRmaApprovedEmail, sendRmaRejectedEmail, sendRmaReturnReceivedEmail } from "../_lib/mails";
import { cleanReference } from "@/app/retour/_lib/resolve-order";

type Prev = ActionState | null;
/** A form field as a string; a missing one is "" so the schema answers with its own Dutch message. */
const str = (fd: FormData, key: string): string => { const v = fd.get(key); return typeof v === "string" ? v : ""; };
const RmaId = z.string().trim().min(1).max(40).regex(/^[a-z0-9]+$/i);
const DAY = 86_400_000;

function refresh() {
  revalidatePath("/admin/retouren");
  revalidatePath("/admin");
}

export async function approveRmaAction(_prev: Prev, fd: FormData): Promise<ActionState> {
  const g = await adminGuard();
  if (!g.ok) return fail(g.error);
  const parsed = z
    .object({
      id: RmaId,
      labelUrl: z.string().trim().max(500).optional().refine((v) => !v || /^https:\/\/[^\s]+$/.test(v), "Een retourlabel-link moet met https:// beginnen."),
      note: z.string().trim().max(500).optional(),
    })
    .safeParse({ id: str(fd, "id"), labelUrl: (str(fd, "labelUrl") || undefined), note: (str(fd, "note") || undefined) });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Ongeldige invoer.");
  const { id, labelUrl, note } = parsed.data;

  // No real address, no instructions: mailing the stand-in address would send a parcel into the void.
  const address = realReturnAddress();
  if (!address) return fail("Het retouradres is nog niet ingesteld (COMPANY_STREET, COMPANY_POSTAL_CODE en COMPANY_CITY). Zonder echt adres kunnen we geen instructies sturen.");

  const rma = await prisma.rmaRequest.findUnique({ where: { id } });
  if (!rma) return fail("Retour niet gevonden.");
  const claimed = await prisma.rmaRequest.updateMany({ where: { id, status: "RECEIVED" }, data: { status: "APPROVED", adminNote: note ?? rma.adminNote } });
  if (claimed.count === 0) return fail(`Deze retour staat op ${rma.status} en kan niet meer worden goedgekeurd.`);

  const weBear = rma.reason === "DEFECT" || rma.reason === "WRONG_PART";
  const mail = await sendRmaApprovedEmail(rma.email, {
    rmaNumber: rma.rmaNumber,
    name: rma.name,
    returnAddress: address,
    deadline: new Date(Date.now() + RETURN_SHIP_DAYS * DAY),
    labelUrl: labelUrl ?? null,
    shippingNote: weBear
      ? labelUrl
        ? "De retourkosten zijn voor onze rekening: gebruik het label hieronder."
        : "De retourkosten zijn voor onze rekening: stuur het pakket met een vervoerder naar keuze, bewaar het verzendbewijs en mail ons de kosten. We vergoeden ze bij de terugbetaling."
      : "De kosten van het terugsturen zijn voor jouw rekening.",
  });
  logger.info("[admin] rma approved", { rma: rma.rmaNumber, by: g.email });
  refresh();
  return done(`Goedgekeurd.${mail.ok ? " De klant heeft het retouradres en de instructies gemaild." : " De e-mail aan de klant kon NIET worden verstuurd; stuur het retouradres zelf na."}`);
}

export async function rejectRmaAction(_prev: Prev, fd: FormData): Promise<ActionState> {
  const g = await adminGuard();
  if (!g.ok) return fail(g.error);
  const parsed = z
    .object({ id: RmaId, reason: z.string().trim().min(5, "Geef een reden (minstens 5 tekens); de klant ziet die.").max(500) })
    .safeParse({ id: str(fd, "id"), reason: str(fd, "reason") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Ongeldige invoer.");
  const { id, reason } = parsed.data;
  const rma = await prisma.rmaRequest.findUnique({ where: { id } });
  if (!rma) return fail("Retour niet gevonden.");
  const claimed = await prisma.rmaRequest.updateMany({
    where: { id, status: { in: ["RECEIVED", "APPROVED", "RETURN_RECEIVED"] } },
    data: { status: "REJECTED", adminNote: reason, resolvedAt: new Date() },
  });
  if (claimed.count === 0) return fail(`Deze retour staat op ${rma.status} en kan niet meer worden afgewezen.`);
  const mail = await sendRmaRejectedEmail(rma.email, { rmaNumber: rma.rmaNumber, name: rma.name, reason });
  logger.info("[admin] rma rejected", { rma: rma.rmaNumber, by: g.email });
  refresh();
  return done(`Afgewezen.${mail.ok ? " De klant is gemaild." : " De e-mail aan de klant kon NIET worden verstuurd."}`);
}

export async function returnReceivedAction(_prev: Prev, fd: FormData): Promise<ActionState> {
  const g = await adminGuard();
  if (!g.ok) return fail(g.error);
  const id = RmaId.safeParse(str(fd, "id"));
  if (!id.success) return fail("Ongeldige retour.");
  const rma = await prisma.rmaRequest.findUnique({ where: { id: id.data } });
  if (!rma) return fail("Retour niet gevonden.");
  const claimed = await prisma.rmaRequest.updateMany({ where: { id: id.data, status: "APPROVED" }, data: { status: "RETURN_RECEIVED" } });
  if (claimed.count === 0) return fail(`Deze retour staat op ${rma.status}; alleen een goedgekeurde retour kan als ontvangen worden gemarkeerd.`);
  const mail = await sendRmaReturnReceivedEmail(rma.email, { rmaNumber: rma.rmaNumber, name: rma.name });
  refresh();
  return done(`Pakket als ontvangen gemarkeerd.${mail.ok ? " De klant is gemaild." : " De e-mail aan de klant kon NIET worden verstuurd."}`);
}

export async function refundRmaAction(_prev: Prev, fd: FormData): Promise<ActionState> {
  const g = await adminGuard();
  if (!g.ok) return fail(g.error);
  const parsed = z
    .object({
      id: RmaId,
      amount: z.string().trim().min(1, "Vul het terug te betalen bedrag in.").max(20),
      expected: z.string().trim().max(20),
    })
    .safeParse({ id: str(fd, "id"), amount: str(fd, "amount"), expected: str(fd, "expectedRefundedEur") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Ongeldige invoer.");
  const amount = parseMoney(parsed.data.amount);
  if (amount === null || amount <= 0) return fail("Dit is geen geldig bedrag. Gebruik bijvoorbeeld 12,50.");
  const expected = parsed.data.expected === "" ? undefined : Number(parsed.data.expected);
  if (expected !== undefined && !Number.isFinite(expected)) return fail("Ververs de pagina en probeer het opnieuw.");

  const rma = await prisma.rmaRequest.findUnique({ where: { id: parsed.data.id }, include: { order: { select: { id: true, items: { select: { partId: true, quantity: true } } } } } });
  if (!rma) return fail("Retour niet gevonden.");
  if (!rma.order) return fail("Deze retour is niet aan een bestelling gekoppeld. Koppel eerst de bestelling; zonder bestelling is er niets om terug te betalen.");
  if (rma.status === "REFUNDED") {
    // refundEur is only ever written by this screen together with the credit note. A REFUNDED return
    // without it was set by hand (the label-only buttons under /admin/aanvragen): nothing was booked.
    if (rma.refundEur == null) {
      return fail("Deze retour staat op 'Terugbetaald', maar er is hier geen terugbetaling of creditnota geboekt (de status is waarschijnlijk met de losse knoppen onder Aanvragen gezet). Er is dus mogelijk niets terugbetaald: boek een terugbetaling via de bestelling in /admin/bestellingen als dat nog moet.");
    }
    return done("Deze retour is al terugbetaald.");
  }
  if (rma.status !== "APPROVED" && rma.status !== "RETURN_RECEIVED") return fail(`Deze retour staat op ${rma.status}; keur hem eerst goed.`);

  const restock = readRestock(fd, rma.order.items);
  if ("error" in restock) return fail(restock.error);

  const res = await performRefund({
    orderId: rma.order.id,
    amountEur: amount,
    reason: `Retour ${rma.rmaNumber}`,
    // Stable per RMA: whatever failed halfway, the retry books the same credit note.
    key: `rma-${rma.id}`,
    expectedRefundedEur: expected,
    restock: restock.restock,
  });
  if (!res.ok) return fail(res.error);

  const closed = await prisma.rmaRequest.updateMany({
    where: { id: rma.id, status: { in: ["APPROVED", "RETURN_RECEIVED"] } },
    data: { status: "REFUNDED", refundEur: amount, resolvedAt: new Date() },
  });
  logger.info("[admin] rma refunded", { rma: rma.rmaNumber, by: g.email, credit: res.creditNoteNumber, closed: closed.count });
  refresh();
  return done(res.message);
}

/**
 * The customer typed a number we could not match: the owner links the order by hand after checking.
 * Same rules as the intake (resolve-order.ts): a short number needs 8 characters and must be unambiguous,
 * because every cuid starts with the same letter and a 4-character prefix would link an arbitrary order.
 */
export async function linkRmaAction(_prev: Prev, fd: FormData): Promise<ActionState> {
  const g = await adminGuard();
  if (!g.ok) return fail(g.error);
  const parsed = z.object({ id: RmaId, reference: z.string().trim().min(4, "Vul een bestelnummer of factuurnummer in.").max(60) }).safeParse({ id: str(fd, "id"), reference: str(fd, "reference") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Ongeldige invoer.");
  const ref = cleanReference(parsed.data.reference);
  let candidates: Array<{ id: string }> = [];
  if (/^\d{4}-\d{5}$/.test(ref)) {
    const inv = await prisma.invoice.findUnique({ where: { number: ref }, select: { order: { select: { id: true } } } });
    if (inv) candidates = [inv.order];
  } else if (/^[a-z0-9]+$/i.test(ref)) {
    if (ref.length < 8) return fail("Een bestelnummer heeft minstens 8 tekens (bijvoorbeeld 7K3F9QXA), of gebruik het factuurnummer (2026-00012).");
    candidates = await prisma.order.findMany({ where: { id: { startsWith: ref.toLowerCase() } }, select: { id: true }, take: 2 });
  }
  if (candidates.length === 0) return fail("Geen bestelling gevonden met dit nummer.");
  if (candidates.length > 1) return fail("Dit nummer past bij meerdere bestellingen. Gebruik het factuurnummer of de volledige bestel-id.");
  const rma = await prisma.rmaRequest.findUnique({ where: { id: parsed.data.id }, select: { id: true, linkedOrderId: true, status: true } });
  if (!rma) return fail("Retour niet gevonden.");
  if (rma.linkedOrderId) return fail("Deze retour is al aan een bestelling gekoppeld.");
  await prisma.rmaRequest.update({ where: { id: rma.id }, data: { linkedOrderId: candidates[0].id } });
  logger.info("[admin] rma linked", { rma: rma.id, order: candidates[0].id, by: g.email });
  refresh();
  return done(`Gekoppeld aan bestelling #${candidates[0].id.slice(0, 8).toUpperCase()}. Controleer hieronder of dit de bestelling van de klant is.`);
}

/**
 * Close a return whose money already went back through the order desk. Books nothing. Refused unless
 * the order really has a refund, so it cannot be used to mark an unpaid return as done.
 */
export async function closeRmaAction(_prev: Prev, fd: FormData): Promise<ActionState> {
  const g = await adminGuard();
  if (!g.ok) return fail(g.error);
  const parsed = z
    .object({ id: RmaId, note: z.string().trim().min(5, "Schrijf kort waarom je deze retour sluit (minstens 5 tekens).").max(500) })
    .safeParse({ id: str(fd, "id"), note: str(fd, "note") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Ongeldige invoer.");
  const rma = await prisma.rmaRequest.findUnique({ where: { id: parsed.data.id }, include: { order: { select: { refundedEur: true } } } });
  if (!rma) return fail("Retour niet gevonden.");
  if (!rma.order) return fail("Deze retour is niet aan een bestelling gekoppeld.");
  if (!(rma.order.refundedEur > 0)) return fail("Bij de bestelling is niets terugbetaald. Betaal terug, of wijs de retour af met een reden.");
  const claimed = await prisma.rmaRequest.updateMany({
    where: { id: rma.id, status: { in: ["APPROVED", "RETURN_RECEIVED"] } },
    data: { status: "REFUNDED", refundEur: rma.order.refundedEur, resolvedAt: new Date(), adminNote: `Gesloten: terugbetaald via de bestelling. ${parsed.data.note}` },
  });
  if (claimed.count === 0) return fail(`Deze retour staat op ${rma.status} en kan niet meer worden gesloten.`);
  logger.info("[admin] rma closed, refunded via the order", { rma: rma.rmaNumber, by: g.email });
  refresh();
  return done("Retour gesloten. Er is niets geboekt; de terugbetaling stond al bij de bestelling.");
}
