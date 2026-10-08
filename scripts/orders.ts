/**
 * Run the shop from a terminal, before (or without) Clerk and the admin login.
 *
 *   DATABASE_URL=... npx tsx scripts/orders.ts list              open orders: to pay, to ship, on the way
 *   DATABASE_URL=... npx tsx scripts/orders.ts paid <ref> <amount>   book a bank transfer, e.g. paid 2026-00002 34,45
 *   DATABASE_URL=... npx tsx scripts/orders.ts ship <ref> <carrier> <trackingcode>
 *
 * <ref> is the invoice number (2026-00002), the order number (the 8 characters
 * after the #) or the full order id. It must match exactly one order.
 *
 * It calls the same domain functions as the admin screen (markOrderPaidByBankTransfer,
 * markOrderShipped in src/lib/invoicing.ts), so the amount check, the stock
 * handling, the customer e-mail and the owner notice are identical. `paid`
 * REQUIRES the received amount and refuses one cent of difference.
 */
import { PrismaClient } from "@prisma/client";

const eur = (n: number) => `EUR ${n.toFixed(2).replace(".", ",")}`;
const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "-");

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is niet ingesteld.");
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    const inv = await import("../src/lib/invoicing");
    const { ORDER_STATUS_LABEL, orderRef, isOrderStatus } = await import("../src/lib/order-status");
    const { parseMoney } = await import("../src/lib/export-csv");

    const find = async (ref: string) => {
      const clean = ref.replace(/^#/, "").trim();
      const where = /^\d{4}-\d{5}$/.test(clean)
        ? { invoice: { is: { number: clean } } }
        : { id: { startsWith: clean.toLowerCase() } };
      if (clean.length < 8 && !/^\d{4}-\d{5}$/.test(clean)) throw new Error("Geef minstens 8 tekens van het bestelnummer, of het factuurnummer.");
      const found = await prisma.order.findMany({ where, include: { invoice: { select: { number: true } } }, take: 5 });
      if (found.length === 0) throw new Error(`Geen bestelling gevonden voor "${ref}".`);
      if (found.length > 1) throw new Error(`"${ref}" past op meerdere bestellingen: ${found.map((o) => orderRef(o.id)).join(", ")}. Wees specifieker.`);
      return found[0];
    };

    if (cmd === "list") {
      const orders = await prisma.order.findMany({
        where: { status: { in: ["OPENSTAAND", "PAID", "SHIPPED"] } },
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        include: { invoice: { select: { number: true } }, items: { include: { part: { select: { sku: true } } } } },
        take: 200,
      });
      if (orders.length === 0) console.log("Geen open bestellingen.");
      const now = Date.now();
      for (const o of orders) {
        const status = isOrderStatus(o.status) ? ORDER_STATUS_LABEL[o.status] : o.status;
        const late = o.status === "OPENSTAAND" && o.dueAt && o.dueAt.getTime() < now ? "  TE LAAT" : "";
        const items = o.items.map((i) => `${i.quantity}x ${i.part.sku}`).join(", ");
        console.log(`#${orderRef(o.id)}  ${(o.invoice?.number ?? "-").padEnd(11)} ${status.padEnd(24)} ${eur(o.totalEur).padStart(12)}  besteld ${date(o.createdAt)}${o.dueAt && o.status === "OPENSTAAND" ? `  vervalt ${date(o.dueAt)}` : ""}${late}`);
        console.log(`          ${items}`);
      }
      return;
    }

    if (cmd === "paid") {
      const [ref, amountText] = args;
      if (!ref || !amountText) throw new Error("Gebruik: paid <factuurnummer of bestelnummer> <ontvangen bedrag>, bijvoorbeeld: paid 2026-00002 34,45");
      const amount = parseMoney(amountText);
      if (amount === null || amount <= 0) throw new Error(`"${amountText}" is geen geldig bedrag.`);
      const order = await find(ref);
      try {
        const res = await inv.markOrderPaidByBankTransfer(order.id, { receivedAmountEur: amount });
        if (!res.ok) throw new Error(res.error);
        console.log(res.alreadyPaid ? "Stond al als betaald." : `Betaald geboekt voor #${orderRef(order.id)} (${eur(order.totalEur)}).${res.emailSent === false ? " De e-mail aan de klant kon niet worden verstuurd." : ""}`);
      } catch (err) {
        if (err instanceof inv.AmountMismatchError) throw new Error(err.message);
        throw err;
      }
      return;
    }

    if (cmd === "ship") {
      const [ref, carrier, code] = args;
      if (!ref || !carrier || !code) throw new Error("Gebruik: ship <bestelnummer> <vervoerder> <trackingcode>");
      const order = await find(ref);
      const res = await inv.markOrderShipped(order.id, { carrier, trackingCode: code });
      if (!res.ok) throw new Error(res.error);
      console.log(res.alreadyShipped ? "Stond al als verzonden." : `Verzonden gemarkeerd.${res.emailSent === false ? " De e-mail aan de klant kon niet worden verstuurd." : " De klant is gemaild."}`);
      return;
    }

    console.error("Gebruik: orders.ts list | paid <ref> <bedrag> | ship <ref> <vervoerder> <code>");
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`Mislukt: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
