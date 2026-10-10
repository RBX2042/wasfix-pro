/**
 * Order domain: state machine, cancellation, credit notes, refunds, shipping,
 * bank-transfer confirmation, guest token, owner notifications.
 *
 * Runs against a real Postgres (never mocked) and a local HTTP server standing
 * in for Slack, so the owner messages that the flows really send are captured
 * and inspected.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/qa-orders.ts
 */
import http from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
// The probe scripts below each live in their own temp directory; all of them are removed in the main finally.
const probeDirs: string[] = [];
function probeDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  probeDirs.push(dir);
  return dir;
}

const log: string[] = [];
const check = (cond: boolean, ok: string, bad: string) => log.push(cond ? `✅ ${ok}` : `❌ ${bad}`);

const DOMAIN = "qa-orders.test";
const SKU_PREFIX = "QA-ORD-";

async function main() {
  // The notify module reads its channels at import time, so the stand-in Slack
  // must exist before anything is imported.
  const slackBodies: string[] = [];
  const slack = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      slackBodies.push(body);
      res.statusCode = 200;
      res.end("ok");
    });
  });
  await new Promise<void>((r) => slack.listen(0, "127.0.0.1", r));
  process.env.SLACK_WEBHOOK_URL = `http://127.0.0.1:${(slack.address() as AddressInfo).port}/hook`;
  delete process.env.RESEND_API_KEY;
  delete process.env.DISCORD_WEBHOOK_URL;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const inv = await import("../src/lib/invoicing");
  const st = await import("../src/lib/order-status");

  const cleanup = async () => {
    const orders = await prisma.order.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { id: true } });
    const ids = orders.map((o) => o.id);
    await prisma.creditNote.deleteMany({ where: { invoice: { orderId: { in: ids } } } });
    await prisma.invoice.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { id: { in: ids } } });
    await prisma.part.deleteMany({ where: { sku: { startsWith: SKU_PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    // This is a test database: with the test credit notes gone, rewind each
    // year's sequence to the highest number that still exists, as if the test
    // notes had never been issued. Otherwise the series would show holes that
    // only the cleanup made.
    const years = await prisma.creditNoteSequence.findMany();
    for (const { year } of years) {
      if (year === 2999) continue;
      const rows = await prisma.creditNote.findMany({ where: { year }, select: { number: true } });
      const max = rows.reduce((m, r) => Math.max(m, Number(r.number.slice(-5))), 0);
      await prisma.creditNoteSequence.update({ where: { year }, data: { last: max } });
    }
  };

  try {
    await cleanup();

    // ── 1. The transition table ─────────────────────────────────────────────
    const expectedAllowed = new Set([
      "PENDING>PAID", "PENDING>CANCELLED", "OPENSTAAND>PAID", "OPENSTAAND>CANCELLED",
      "PAID>SHIPPED", "PAID>CANCELLED", "SHIPPED>DELIVERED",
    ]);
    const wrong: string[] = [];
    for (const from of st.ORDER_STATUSES) {
      for (const to of st.ORDER_STATUSES) {
        if (st.canTransition(from, to) !== expectedAllowed.has(`${from}>${to}`)) wrong.push(`${from}>${to}`);
      }
    }
    check(wrong.length === 0, `Table: all ${st.ORDER_STATUSES.length * st.ORDER_STATUSES.length} state pairs match the table (exactly D3's edges; there is no way back from CANCELLED, decision D14)`, `Table: wrong pairs ${wrong.join(", ")}`);
    check(!st.canTransition("SHIPPED", "CANCELLED") && !st.canTransition("DELIVERED", "CANCELLED"), "Table: a shipped order can never be cancelled", "Table: SHIPPED -> CANCELLED is allowed");
    check(st.ORDER_TRANSITIONS.CANCELLED.length === 0 && !st.statusesThatCanGo("PAID").includes("CANCELLED"), "Table: nothing leaves CANCELLED, so a late wire cannot revive an order (D14, terms 7.1)", "Table: CANCELLED has an outgoing edge");
    check(!st.canTransition("PAID", "PENDING") && !st.canTransition("PAID", "OPENSTAAND") && !st.canTransition("DELIVERED", "SHIPPED"), "Table: no way back to unpaid or from delivered", "Table: a backwards transition is allowed");
    check(!st.canTransition("FOO", "PAID") && !st.canTransition("PAID", "FOO"), "Table: unknown states are refused", "Table: unknown state accepted");
    check(st.ORDER_STATUSES.every((s) => st.ORDER_STATUS_LABEL[s].length > 0), "Labels: every state has a Dutch label", "Labels: a state has no label");
    check(st.holdsStock("OPENSTAAND") && st.holdsStock("PAID") && !st.holdsStock("PENDING") && !st.holdsStock("CANCELLED"), "Stock: PENDING and CANCELLED hold none; OPENSTAAND and PAID do", "Stock: holdsStock is wrong");

    // ── Fixtures ────────────────────────────────────────────────────────────
    let n = 0;
    const user = await prisma.user.create({ data: { email: `buyer@${DOMAIN}`, name: "QA Buyer" } });
    const mkPart = async (stock: number, price = 10.15) =>
      prisma.part.create({ data: { sku: `${SKU_PREFIX}${Date.now()}-${++n}`, name: `QA onderdeel ${n}`, brand: "QA", category: "OTHER", priceEur: price, stock } });

    /** An order in the state a real checkout would have left it in (stock already moved). */
    async function mkOrder(opts: { status: string; method?: "STRIPE" | "BANK_TRANSFER"; qty?: number; price?: number; invoice?: boolean; stock?: number; shipping?: number; discount?: number }) {
      const qty = opts.qty ?? 3;
      const part = await mkPart(opts.stock ?? 50, opts.price ?? 10.15);
      const goods = inv.money(part.priceEur * qty);
      const shipping = opts.shipping ?? 0;
      const discount = opts.discount ?? 0;
      const total = inv.money(goods - discount + shipping);
      const vat = inv.splitVatInclusive(total);
      const method = opts.method ?? (opts.status === "OPENSTAAND" ? "BANK_TRANSFER" : "STRIPE");
      const order = await prisma.order.create({
        data: {
          userId: user.id,
          email: `buyer${++n}@${DOMAIN}`,
          status: opts.status,
          paymentMethod: method,
          subtotalEur: goods,
          discountEur: discount,
          shippingEur: shipping,
          totalEur: total,
          vatRate: vat.vatRate,
          vatEur: vat.vatEur,
          accessToken: inv.newAccessToken(),
          shippingAddress: JSON.stringify({ name: "Piet Jansen", street: "Teststraat", houseNumber: "1", postalCode: "1011 AB", city: "Amsterdam" }),
          paidAt: ["PAID", "SHIPPED", "DELIVERED"].includes(opts.status) ? new Date() : null,
          items: { create: [{ partId: part.id, quantity: qty, unitPrice: part.priceEur }] },
        },
      });
      // PENDING reserves nothing; every other live state has taken its units.
      if (st.holdsStock(opts.status)) await prisma.part.update({ where: { id: part.id }, data: { stock: { decrement: qty } } });
      if (opts.invoice ?? (opts.status !== "PENDING")) await inv.issueInvoiceForOrder(order.id);
      const stockNow = async () => (await prisma.part.findUniqueOrThrow({ where: { id: part.id } })).stock;
      return { order, part, qty, total, stockStart: opts.stock ?? 50, stockNow };
    }
    const statusOf = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;
    const notesOf = async (orderId: string) => inv.getCreditNotesForOrder(orderId);

    // ── 2. cancelOrder per state ────────────────────────────────────────────
    {
      const o = await mkOrder({ status: "PENDING", invoice: false });
      const r = await inv.cancelOrder(o.order.id, { reason: "klant belde", actor: "admin" });
      check(r.ok && !r.alreadyCancelled && !r.restocked && r.creditNote === null && (await o.stockNow()) === o.stockStart, "Cancel PENDING: no stock moved (none was reserved), no credit note (never invoiced)", `Cancel PENDING wrong: ${JSON.stringify(r)}`);
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      check(row.status === "CANCELLED" && row.cancelledAt !== null && row.cancelReason === "klant belde", "Cancel: sets status, cancelledAt and cancelReason", `Cancel fields wrong: ${row.status} ${row.cancelledAt} ${row.cancelReason}`);
    }
    {
      const o = await mkOrder({ status: "OPENSTAAND" });
      const before = await o.stockNow();
      const r = await inv.cancelOrder(o.order.id, { reason: "niet betaald", actor: "system" });
      const invoice = await inv.getInvoiceForOrder(o.order.id);
      check(
        r.ok && r.restocked && (await o.stockNow()) === before + o.qty && r.creditNote?.totalEur === invoice?.totalEur && /^CN-\d{4}-\d{5}$/.test(r.creditNote?.number ?? ""),
        `Cancel OPENSTAAND: reservation released (+${o.qty}) and invoice credited in full (${r.ok ? r.creditNote?.number : "?"})`,
        `Cancel OPENSTAAND wrong: ${JSON.stringify(r)}`,
      );
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      check(r.ok && r.refundDueEur === 0 && row.refundedEur === 0, "Cancel OPENSTAAND: no money had arrived, so nothing is owed back", `Cancel OPENSTAAND refund fields wrong: due ${r.ok && r.refundDueEur}, refunded ${row.refundedEur}`);
      check(r.ok && r.emailSent === false, "Cancel: the customer mail was attempted and honestly reported as not sent (no RESEND_API_KEY)", `Cancel: emailSent is ${r.ok && r.emailSent}`);
      const again = await inv.cancelOrder(o.order.id, { reason: "nog een keer", actor: "admin" });
      check(
        again.ok && again.alreadyCancelled && !again.restocked && (await o.stockNow()) === before + o.qty && (await notesOf(o.order.id)).length === 1 && again.creditNote?.replayed === true,
        "Cancel replay: nothing restocked twice, no second credit note, the existing note is returned",
        `Cancel replay wrong: ${JSON.stringify(again)}`,
      );
      const invAfter = await prisma.invoice.findUniqueOrThrow({ where: { orderId: o.order.id } });
      check(invAfter.totalEur === invoice?.totalEur && invAfter.number === invoice?.number, "Invoice is untouched by the credit note", "Cancel changed the invoice");
    }
    {
      const o = await mkOrder({ status: "PAID" });
      const before = await o.stockNow();
      const r = await inv.cancelOrder(o.order.id, { reason: "klant wil niet meer", actor: "admin", stripeRefundId: "re_test_cancel_1" });
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      check(
        r.ok && r.restocked && (await o.stockNow()) === before + o.qty && r.refundDueEur === o.total && row.refundedEur === o.total && r.creditNote?.stripeRefundId === "re_test_cancel_1",
        "Cancel PAID: units back, credit note carries the Stripe refund id, refundedEur and refundDueEur = the paid total",
        `Cancel PAID wrong: ${JSON.stringify(r)} refunded ${row.refundedEur}`,
      );
    }
    for (const status of ["SHIPPED", "DELIVERED"]) {
      const o = await mkOrder({ status });
      const before = await o.stockNow();
      const r = await inv.cancelOrder(o.order.id, { reason: "te laat", actor: "admin" });
      check(
        !r.ok && r.code === "not_cancellable" && (await statusOf(o.order.id)) === status && (await o.stockNow()) === before && (await notesOf(o.order.id)).length === 0,
        `Cancel ${status}: refused, status/stock/credit notes unchanged`,
        `Cancel ${status} not refused: ${JSON.stringify(r)}`,
      );
    }
    {
      const r = await inv.cancelOrder("does-not-exist", { reason: "x", actor: "admin" });
      check(!r.ok && r.code === "not_found", "Cancel: unknown order is not_found", `Cancel unknown order: ${JSON.stringify(r)}`);
    }

    // ── 3. Concurrency: restock exactly once ────────────────────────────────
    for (const status of ["PAID", "OPENSTAAND"]) {
      const o = await mkOrder({ status, qty: 4 });
      const before = await o.stockNow();
      const results = await Promise.all(Array.from({ length: 8 }, () => inv.cancelOrder(o.order.id, { reason: "race", actor: "system" })));
      const winners = results.filter((r) => r.ok && !r.alreadyCancelled).length;
      const notes = await notesOf(o.order.id);
      check(
        results.every((r) => r.ok) && winners === 1 && (await o.stockNow()) === before + o.qty && notes.length === 1,
        `Cancel ${status} x8 concurrent: 1 winner, stock +${o.qty} exactly once, 1 credit note`,
        `Cancel ${status} race: winners ${winners}, stock ${before}->${await o.stockNow()}, notes ${notes.length}, results ${JSON.stringify(results.map((r) => (r.ok ? "ok" : r.code)))}`,
      );
    }
    {
      // Cancel racing the bank-transfer confirmation: exactly one of them wins, the books stay consistent,
      // and the owner hears about the winner only (one message, not two, not the loser's).
      const o = await mkOrder({ status: "OPENSTAAND", qty: 2 });
      const before = await o.stockNow();
      const ref = st.orderRef(o.order.id);
      slackBodies.length = 0;
      const [c, p] = await Promise.all([
        inv.cancelOrder(o.order.id, { reason: "race", actor: "admin" }),
        inv.markOrderPaidByBankTransfer(o.order.id).catch((e) => ({ ok: false as const, error: String(e) })),
      ]);
      const final = await statusOf(o.order.id);
      const stock = await o.stockNow();
      const notes = (await notesOf(o.order.id)).length;
      await new Promise((r) => setTimeout(r, 150));
      const texts = slackBodies.map((x) => String(JSON.parse(x).text)).filter((t) => t.includes(`#${ref}`));
      const paidMsgs = texts.filter((t) => /Betaling ontvangen/.test(t)).length;
      const cancelMsgs = texts.filter((t) => /geannuleerd/.test(t)).length;
      const consistent =
        (final === "PAID" && stock === before && notes === 0 && c.ok === false && p.ok === true && paidMsgs === 1 && cancelMsgs === 0) ||
        (final === "CANCELLED" && stock === before + o.qty && notes === 1 && c.ok === true && p.ok === false && cancelMsgs === 1 && paidMsgs === 0) ||
        // The payment committed completely before the cancel started: both are real events, in that order.
        (final === "CANCELLED" && stock === before + o.qty && notes === 1 && c.ok === true && p.ok === true && cancelMsgs === 1 && paidMsgs === 1);
      check(consistent, `Cancel vs mark-paid race: ends ${final}, stock ${stock - before >= 0 ? "+" : ""}${stock - before}, ${notes} credit note(s), exactly one winner and exactly one owner notice (paid ${paidMsgs}, cancelled ${cancelMsgs})`, `Cancel vs mark-paid race inconsistent: final ${final}, stock ${before}->${stock}, notes ${notes}, cancel ${JSON.stringify(c)}, paid ${JSON.stringify(p)}, notices paid ${paidMsgs} cancelled ${cancelMsgs}`);
    }

    // ── 4. Credit notes: gapless, VAT-exact, bounded, idempotent ────────────
    {
      const orders = await Promise.all(Array.from({ length: 5 }, () => mkOrder({ status: "PAID", qty: 1 })));
      const year = inv.amsterdamYear(new Date());
      const before = (await prisma.creditNoteSequence.findUnique({ where: { year } }))?.last ?? 0;
      const results = await Promise.all(orders.map((o) => inv.cancelOrder(o.order.id, { reason: "gapless", actor: "system" })));
      const seqs = results.map((r) => (r.ok && r.creditNote ? Number(r.creditNote.number.slice(-5)) : -1)).sort((a, b) => a - b);
      const after = (await prisma.creditNoteSequence.findUnique({ where: { year } }))?.last ?? 0;
      const contiguous = seqs.every((s, i) => s === before + 1 + i);
      check(contiguous && after === before + 5, `Credit notes: 5 concurrent cancellations took ${seqs[0]}..${seqs[4]}, contiguous, sequence advanced by exactly 5`, `Credit notes: numbers ${seqs} (before ${before}, after ${after})`);
      const numbers = (await prisma.creditNote.findMany({ where: { year }, select: { number: true } })).map((c) => Number(c.number.slice(-5))).sort((a, b) => a - b);
      check(numbers.every((x, i) => x === i + 1), `Credit notes: the whole ${year} series 1..${numbers.length} has no hole`, `Credit notes: hole in the series ${numbers}`);
      check(results.every((r) => r.ok && r.creditNote?.number.startsWith(`CN-${year}-`)), "Credit notes: numbers are CN-<Amsterdam year>-NNNNN", "Credit notes: wrong number format");
    }
    {
      // The first note of a year, requested by many transactions at once.
      const year = 2999;
      await prisma.creditNoteSequence.deleteMany({ where: { year } });
      const got = await Promise.all(Array.from({ length: 8 }, () => prisma.$transaction((t) => inv.allocateCreditNoteSequence(t, year))));
      const sorted = [...got].sort((a, b) => a - b);
      check(sorted.every((s, i) => s === i + 1), "Credit notes: 8 concurrent allocations on a brand-new year get 1..8 (no unique-violation, no hole)", `Credit notes: fresh-year race gave ${got}`);
      // A rolled-back transaction hands its number back.
      await prisma.$transaction(async (t) => { await inv.allocateCreditNoteSequence(t, year); throw new Error("rollback"); }).catch(() => undefined);
      const next = await prisma.$transaction((t) => inv.allocateCreditNoteSequence(t, year));
      check(next === 9, "Credit notes: a rolled-back allocation does not burn a number", `Credit notes: after a rollback the next number was ${next}, expected 9`);
      await prisma.creditNoteSequence.deleteMany({ where: { year } });
    }
    {
      // 30,45 incl. 21% (5,29 VAT) credited as 10,00 + 20,45: the VAT of the parts must add up to the invoice VAT.
      const o = await mkOrder({ status: "PAID", qty: 3, price: 10.15 });
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { orderId: o.order.id } });
      const a = await inv.issueCreditNote(invoice.id, { amountEur: 10, reason: "deel 1", stripeRefundId: "re_part_1" });
      const b = await inv.issueCreditNote(invoice.id, { amountEur: 20.45, reason: "deel 2", stripeRefundId: "re_part_2" });
      check(
        inv.money(a.vatEur + b.vatEur) === invoice.vatEur && inv.money(a.totalEur + b.totalEur) === invoice.totalEur && inv.money(a.subtotalEur + b.subtotalEur) === inv.money(invoice.totalEur - invoice.vatEur),
        `Credit notes: partial notes add up to the invoice to the cent (VAT ${a.vatEur} + ${b.vatEur} = ${invoice.vatEur})`,
        `Credit notes: partials drift: VAT ${a.vatEur}+${b.vatEur} vs ${invoice.vatEur}, total ${a.totalEur}+${b.totalEur} vs ${invoice.totalEur}`,
      );
      check(a.totalEur > 0 && a.vatEur > 0 && a.subtotalEur > 0 && a.subtotalEur === inv.money(a.totalEur - a.vatEur), "Credit notes: all amounts are positive magnitudes, net = gross - VAT", "Credit notes: sign convention broken");
      let over: unknown = null;
      try { await inv.issueCreditNote(invoice.id, { amountEur: 0.01, reason: "te veel" }); } catch (e) { over = e; }
      check(over instanceof inv.OrderDomainError && over.code === "exceeds_invoice", "Credit notes: crediting more than the invoice is refused (exceeds_invoice)", `Credit notes: overshoot gave ${String(over)}`);
      const replay = await inv.issueCreditNote(invoice.id, { amountEur: 10, reason: "deel 1", stripeRefundId: "re_part_1" });
      check(replay.replayed && replay.number === a.number && (await prisma.creditNote.count({ where: { invoiceId: invoice.id } })) === 2, "Credit notes: a replayed Stripe refund id returns the same note, no new number", "Credit notes: replay created a new note");
      const full = await inv.issueCreditNote(invoice.id, { reason: "alles nog eens" });
      check(full.replayed && full.number === b.number, "Credit notes: no amount on a fully credited invoice returns the latest note instead of failing", `Credit notes: full replay gave ${full.number} replayed=${full.replayed}`);
      check(a.seller.name.length > 0 && a.buyer.name === "Piet Jansen" && a.lines.length === 1 && a.invoiceNumber === invoice.number, "Credit notes: seller/buyer snapshots copied from the invoice, invoice number referenced", "Credit notes: snapshot incomplete");
    }
    {
      // Two concurrent partial credits that together exceed the invoice: only one fits.
      const o = await mkOrder({ status: "PAID", qty: 1, price: 40 });
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { orderId: o.order.id } });
      const res = await Promise.allSettled([
        inv.issueCreditNote(invoice.id, { amountEur: 25, reason: "a" }),
        inv.issueCreditNote(invoice.id, { amountEur: 25, reason: "b" }),
      ]);
      const ok = res.filter((r) => r.status === "fulfilled").length;
      const credited = (await prisma.creditNote.aggregate({ where: { invoiceId: invoice.id }, _sum: { totalEur: true } }))._sum.totalEur ?? 0;
      check(ok === 1 && credited <= invoice.totalEur, `Credit notes: two concurrent 25,00 credits on a 40,00 invoice: ${ok} accepted, credited ${credited} <= ${invoice.totalEur}`, `Credit notes: over-credit under concurrency: ${ok} accepted, ${credited} credited`);
    }

    // ── 5. recordRefund ─────────────────────────────────────────────────────
    {
      const o = await mkOrder({ status: "PAID", qty: 2, price: 20 }); // 40,00
      const before = await o.stockNow();
      const r1 = await inv.recordRefund(o.order.id, { amountEur: 15, stripeRefundId: "re_rr_1", reason: "krasje" });
      const row1 = await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      check(r1.ok && !r1.cancelled && !r1.fullyRefunded && r1.refundedEur === 15 && row1.refundedEur === 15 && row1.status === "PAID" && (await o.stockNow()) === before, "Refund partial on PAID: status stays PAID, refundedEur 15, stock untouched", `Refund partial wrong: ${JSON.stringify(r1)} ${row1.status} ${row1.refundedEur}`);
      const dup = await inv.recordRefund(o.order.id, { amountEur: 15, stripeRefundId: "re_rr_1" });
      const row2 = await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      check(dup.ok && dup.replayed && row2.refundedEur === 15 && (await notesOf(o.order.id)).length === 1, "Refund replay (same Stripe refund id): no second note, refundedEur unchanged", `Refund replay wrong: ${JSON.stringify(dup)} ${row2.refundedEur}`);
      const over = await inv.recordRefund(o.order.id, { amountEur: 30, stripeRefundId: "re_rr_over" });
      check(!over.ok && over.code === "exceeds_invoice" && (await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).refundedEur === 15, "Refund beyond what is left is refused and changes nothing", `Refund overshoot: ${JSON.stringify(over)}`);
      const rest = await inv.recordRefund(o.order.id, { amountEur: 25, stripeRefundId: "re_rr_2" });
      const row3 = await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      check(
        rest.ok && rest.fullyRefunded && rest.cancelled && row3.status === "CANCELLED" && row3.refundedEur === 40 && (await o.stockNow()) === before + o.qty,
        "Refund completing the credit on an UNSHIPPED order cancels it: units back on the shelf once, refundedEur = total",
        `Refund completing wrong: ${JSON.stringify(rest)} ${row3.status} ${row3.refundedEur} stock ${await o.stockNow()} vs ${before + o.qty}`,
      );
      const notes = await notesOf(o.order.id);
      check(notes.length === 2 && inv.money(notes[0].totalEur + notes[1].totalEur) === 40, "Refund: two credit notes add up to the invoice", `Refund notes wrong: ${notes.map((x) => x.totalEur)}`);
    }
    {
      const o = await mkOrder({ status: "SHIPPED", qty: 2, price: 20 });
      const before = await o.stockNow();
      const r = await inv.recordRefund(o.order.id, { amountEur: 40, stripeRefundId: "re_ship_1", restock: [{ partId: o.part.id, quantity: 2 }] });
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      check(r.ok && r.fullyRefunded && !r.cancelled && row.status === "SHIPPED" && row.refundedEur === 40 && (await o.stockNow()) === before + 2, "Refund full on SHIPPED: status stays, refundedEur = total, returned units restocked", `Refund SHIPPED wrong: ${JSON.stringify(r)} ${row.status} ${row.refundedEur}`);
      const bad = await mkOrder({ status: "DELIVERED", qty: 1, price: 20 });
      const rb = await inv.recordRefund(bad.order.id, { amountEur: 5, restock: [{ partId: bad.part.id, quantity: 9 }] });
      check(!rb.ok && rb.code === "invalid_input" && (await notesOf(bad.order.id)).length === 0 && (await prisma.order.findUniqueOrThrow({ where: { id: bad.order.id } })).refundedEur === 0, "Refund: restocking more than was ordered is refused before anything is written", `Refund bad restock: ${JSON.stringify(rb)}`);
    }
    {
      // Cancel first (credit note, no refund id yet), then the Stripe refund webhook arrives.
      const o = await mkOrder({ status: "PAID", qty: 2, price: 20 });
      const c = await inv.cancelOrder(o.order.id, { reason: "klant belde", actor: "admin" });
      const rec = await inv.recordRefund(o.order.id, { amountEur: 40, stripeRefundId: "re_after_cancel" });
      const notes = await notesOf(o.order.id);
      check(c.ok && rec.ok && rec.replayed && notes.length === 1 && notes[0].stripeRefundId === "re_after_cancel" && (await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).refundedEur === 40, "Refund after cancel: the Stripe refund id is attached to the existing credit note, no second note, refundedEur not doubled", `Refund after cancel: ${JSON.stringify(rec)} notes ${notes.length}`);
      const other = await inv.recordRefund(o.order.id, { amountEur: 40, stripeRefundId: "re_unknown_second" });
      check(!other.ok && other.code === "illegal_transition" && (await notesOf(o.order.id)).length === 1, "Refund after cancel: a second, different refund for the same money is refused (needs a human)", `Second refund after cancel: ${JSON.stringify(other)}`);
    }
    for (const status of ["PENDING", "OPENSTAAND", "CANCELLED"]) {
      const o = await mkOrder({ status, invoice: status !== "PENDING" });
      const r = await inv.recordRefund(o.order.id, { amountEur: 5, stripeRefundId: `re_illegal_${status}` });
      check(!r.ok && r.code === "illegal_transition" && (await notesOf(o.order.id)).length === 0, `Refund on ${status} is refused, nothing written`, `Refund on ${status} not refused: ${JSON.stringify(r)}`);
    }
    {
      const o = await mkOrder({ status: "PAID" });
      const r = await inv.recordRefund(o.order.id, { amountEur: -3 });
      const z = await inv.recordRefund(o.order.id, { amountEur: Number.NaN });
      check(!r.ok && r.code === "invalid_amount" && !z.ok && z.code === "invalid_amount", "Refund: negative and NaN amounts are refused", "Refund: invalid amount accepted");
    }

    // ── 6. Ship / deliver ───────────────────────────────────────────────────
    for (const status of ["PENDING", "OPENSTAAND", "CANCELLED", "DELIVERED"]) {
      const o = await mkOrder({ status, invoice: status !== "PENDING" });
      const r = await inv.markOrderShipped(o.order.id, { carrier: "PostNL", trackingCode: "3SQAORD00001" });
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      check(!r.ok && row.status === status && row.shippedAt === null && row.trackingCode === null, `Ship from ${status}: refused, nothing written`, `Ship from ${status} not refused: ${JSON.stringify(r)} -> ${row.status}`);
    }
    {
      const o = await mkOrder({ status: "PAID" });
      const bad = await inv.markOrderShipped(o.order.id, { carrier: "PostNL", trackingCode: " " });
      check(!bad.ok && bad.code === "invalid_input" && (await statusOf(o.order.id)) === "PAID", "Ship: an empty tracking code is refused", `Ship empty code: ${JSON.stringify(bad)}`);
      const notDelivered = await inv.markOrderDelivered(o.order.id);
      check(!notDelivered.ok && notDelivered.code === "illegal_transition", "Deliver from PAID is refused (must ship first)", `Deliver from PAID: ${JSON.stringify(notDelivered)}`);
      const both = await Promise.all([
        inv.markOrderShipped(o.order.id, { carrier: "postnl", trackingCode: "3SQAORD00002" }),
        inv.markOrderShipped(o.order.id, { carrier: "postnl", trackingCode: "3SQAORD00002" }),
      ]);
      const firsts = both.filter((r) => r.ok && !r.alreadyShipped).length;
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      check(both.every((r) => r.ok) && firsts === 1 && row.status === "SHIPPED" && row.carrier === "POSTNL" && row.trackingCode === "3SQAORD00002" && row.shippedAt !== null, "Ship: two concurrent identical calls ship once; carrier normalised to POSTNL", `Ship race: ${JSON.stringify(both)} ${row.status} ${row.carrier}`);
      check(both.every((r) => r.ok && r.emailSent !== true), "Ship: emailSent is never true without Resend", `Ship: emailSent claimed: ${JSON.stringify(both)}`);
      const other = await inv.markOrderShipped(o.order.id, { carrier: "DHL", trackingCode: "JVGL0001" });
      check(!other.ok && other.code === "conflict" && (await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).trackingCode === "3SQAORD00002", "Ship: shipping again with different tracking is refused (conflict)", `Ship conflict: ${JSON.stringify(other)}`);
      const fixed = await inv.updateOrderTracking(o.order.id, { carrier: "DHL", trackingCode: "JVGL0001" });
      check(fixed.ok && (await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).carrier === "DHL", "Ship: updateOrderTracking corrects a shipped order", `updateOrderTracking: ${JSON.stringify(fixed)}`);
      const d1 = await inv.markOrderDelivered(o.order.id);
      const d2 = await inv.markOrderDelivered(o.order.id);
      const drow = await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      check(d1.ok && !d1.alreadyDelivered && d2.ok && d2.alreadyDelivered && drow.status === "DELIVERED" && drow.deliveredAt !== null, "Deliver: SHIPPED -> DELIVERED, replay is a no-op", `Deliver wrong: ${JSON.stringify([d1, d2])}`);
      const cancelDelivered = await inv.cancelOrder(o.order.id, { reason: "x", actor: "admin" });
      check(!cancelDelivered.ok, "A delivered order cannot be cancelled either", "Delivered order was cancelled");
    }

    // ── 7. Bank transfer confirmation ───────────────────────────────────────
    {
      const o = await mkOrder({ status: "OPENSTAAND", qty: 3, price: 10.15 }); // 30,45
      let err: unknown = null;
      try { await inv.markOrderPaidByBankTransfer(o.order.id, { receivedAmountEur: 30.44 }); } catch (e) { err = e; }
      check(err instanceof inv.AmountMismatchError && err.expectedEur === 30.45 && err.receivedEur === 30.44 && (await statusOf(o.order.id)) === "OPENSTAAND", "Bank transfer: 1 cent too little throws AmountMismatchError and changes nothing", `Bank transfer mismatch: ${String(err)}`);
      const notRefused: number[] = [];
      for (const bad of [30.46, 0, -30.45, Number.NaN, 304.5]) {
        let e2: unknown = null;
        try { await inv.markOrderPaidByBankTransfer(o.order.id, { receivedAmountEur: bad }); } catch (e) { e2 = e; }
        if (!(e2 instanceof inv.AmountMismatchError) || (await statusOf(o.order.id)) !== "OPENSTAAND") notRefused.push(bad);
      }
      check(notRefused.length === 0, "Bank transfer: 30,46 / 0 / negative / NaN / 304,50 are all refused and the order stays OPENSTAAND", `Bank transfer: amounts not refused: ${notRefused.join(", ")}`);
      const ok = await inv.markOrderPaidByBankTransfer(o.order.id, { receivedAmountEur: 30.45 });
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      check(ok.ok && row.status === "PAID" && row.paidAt !== null, "Bank transfer: exact amount marks the order PAID with paidAt", `Bank transfer exact: ${JSON.stringify(ok)} ${row.status}`);
      check(ok.ok && ok.emailSent === false, "Bank transfer: the 'betaling ontvangen' mail was attempted and reported as not sent without Resend", `Bank transfer emailSent: ${JSON.stringify(ok)}`);
      const again = await inv.markOrderPaidByBankTransfer(o.order.id, { receivedAmountEur: 30.45 });
      check(again.ok && again.alreadyPaid === true && again.emailSent === undefined, "Bank transfer: replay is a no-op (alreadyPaid, no second mail)", `Bank transfer replay: ${JSON.stringify(again)}`);
      let e3: unknown = null;
      try { await inv.markOrderPaidByBankTransfer(o.order.id, { receivedAmountEur: 5 }); } catch (e) { e3 = e; }
      check(e3 instanceof inv.AmountMismatchError, "Bank transfer: the amount is checked even on a replay", "Bank transfer: replay skipped the amount check");
    }
    {
      const o = await mkOrder({ status: "OPENSTAAND" });
      const noAmount = await inv.markOrderPaidByBankTransfer(o.order.id);
      check(noAmount.ok && (await statusOf(o.order.id)) === "PAID", "Bank transfer: without an amount the old behaviour stays (admin checked it elsewhere)", `Bank transfer no amount: ${JSON.stringify(noAmount)}`);
      const stripeOrder = await mkOrder({ status: "PAID", method: "STRIPE" });
      const wrongMethod = await inv.markOrderPaidByBankTransfer(stripeOrder.order.id);
      check(!wrongMethod.ok, "Bank transfer: a Stripe order is refused", `Bank transfer on Stripe order: ${JSON.stringify(wrongMethod)}`);
      const pend = await mkOrder({ status: "PENDING", method: "BANK_TRANSFER", invoice: false });
      const pendRes = await inv.markOrderPaidByBankTransfer(pend.order.id);
      check(!pendRes.ok && (await statusOf(pend.order.id)) === "PENDING", "Bank transfer: a PENDING order cannot be marked paid this way", `Bank transfer on PENDING: ${JSON.stringify(pendRes)}`);
      const unknown = await inv.markOrderPaidByBankTransfer("nope", { receivedAmountEur: 1 });
      check(!unknown.ok, "Bank transfer: unknown order with an amount is refused, not thrown", `Bank transfer unknown: ${JSON.stringify(unknown)}`);
    }
    {
      // Late wire after expiry (decision D14, terms 7.1): NEVER revived. The cancellation put the units back and
      // credited the invoice; the customer is paid back or orders again.
      const late = await mkOrder({ status: "OPENSTAAND", qty: 2 });
      await inv.cancelOrder(late.order.id, { reason: "verlopen", actor: "system" });
      const lateNotes = await notesOf(late.order.id);
      check(lateNotes.length === 1, "Every cancelled bank-transfer order carries a credit note (its invoice exists from checkout), which is why a revival could never happen", `Cancelled bank-transfer order has ${lateNotes.length} credit notes`);
      const stockAfterCancel = await late.stockNow();
      const blocked = await inv.markOrderPaidByBankTransfer(late.order.id, { receivedAmountEur: late.total });
      check(!blocked.ok && /creditnota/i.test(blocked.error) && /terug|opnieuw/i.test(blocked.error) && (await statusOf(late.order.id)) === "CANCELLED" && (await late.stockNow()) === stockAfterCancel, "Late wire on an order whose invoice was credited is NOT revived: refused, still CANCELLED, stock untouched, the message says refund or reorder", `Late wire after credit note: ${JSON.stringify(blocked)}`);

      // A cancelled order without any credit note (state reproduced by hand): the same refusal, no stock re-taken.
      const legacy = await mkOrder({ status: "OPENSTAAND", qty: 2 });
      await prisma.order.update({ where: { id: legacy.order.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Bestelling verlopen" } });
      await prisma.part.update({ where: { id: legacy.part.id }, data: { stock: { increment: legacy.qty } } });
      const before = await legacy.stockNow();
      const refused = await inv.markOrderPaidByBankTransfer(legacy.order.id, { receivedAmountEur: legacy.total });
      const legacyRow = await prisma.order.findUniqueOrThrow({ where: { id: legacy.order.id } });
      check(!refused.ok && legacyRow.status === "CANCELLED" && legacyRow.cancelledAt !== null && legacyRow.paidAt === null && (await legacy.stockNow()) === before, "Late wire on a cancelled order WITHOUT a credit note is refused too (no revival branch exists): still CANCELLED, cancelledAt kept, stock untouched", `Late wire without credit note: ${JSON.stringify(refused)} ${legacyRow.status}`);
      check(!refused.ok && /terug|opnieuw/i.test(refused.error), "Late wire refusal tells the owner to pay back or let the customer reorder", `Late wire message: ${JSON.stringify(refused)}`);

      const gone = await mkOrder({ status: "OPENSTAAND", qty: 2 });
      await prisma.order.update({ where: { id: gone.order.id }, data: { status: "CANCELLED" } });
      await prisma.part.update({ where: { id: gone.part.id }, data: { stock: 0 } });
      const noStock = await inv.markOrderPaidByBankTransfer(gone.order.id);
      check(!noStock.ok && (await statusOf(gone.order.id)) === "CANCELLED" && (await gone.stockNow()) === 0, "Late wire when the stock is gone: refused, still CANCELLED", `Late wire without stock: ${JSON.stringify(noStock)}`);
    }

    // ── 7b. FA: the cancel guard, quiet cancellations, the restock record ──
    {
      // R2-01 as a real race: the owner's "paid" and a sweep's "cancel" on the same OPENSTAAND order, 20 times.
      // Whatever order they run in, the books are consistent: PAID without a credit note, or CANCELLED with exactly
      // one credit note and never paid. (Without onlyFrom the cancel could follow the payment and credit it.)
      const outcomes = { paidWon: 0, cancelWon: 0, inconsistent: [] as string[] };
      for (let i = 0; i < 20; i++) {
        const o = await mkOrder({ status: "OPENSTAAND", qty: 1 });
        const [c, p] = await Promise.all([
          inv.cancelOrder(o.order.id, { reason: "race", actor: "system", notifyCustomer: false, onlyFrom: ["OPENSTAAND"] }),
          inv.markOrderPaidByBankTransfer(o.order.id, { receivedAmountEur: o.total }),
        ]);
        const row = await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
        const notes = (await notesOf(o.order.id)).length;
        if (row.status === "PAID" && notes === 0 && p.ok && !c.ok && c.code === "conflict" && row.cancelledAt === null) outcomes.paidWon++;
        else if (row.status === "CANCELLED" && notes === 1 && c.ok && !p.ok && row.paidAt === null && row.refundedEur === 0) outcomes.cancelWon++;
        else outcomes.inconsistent.push(`${row.status}/notes ${notes}/paidAt ${row.paidAt}/cancel ${JSON.stringify(c)}/pay ${JSON.stringify(p)}`);
      }
      check(outcomes.inconsistent.length === 0, `R2-01: 20 sampled simultaneous 'cancel (onlyFrom OPENSTAAND)' and 'mark paid' calls always end consistent (${outcomes.paidWon} paid first, ${outcomes.cancelWon} cancel first; never a paid order that was cancelled; this samples the interleavings, the forced ones follow)`, `R2-01 race: ${outcomes.inconsistent.slice(0, 2).join(" | ")}`);
      // The same two interleavings, forced (the loop above only samples them and says nothing about which ones it hit).
      {
        // (a) the owner's payment lands between the sweep's list and its cancel: the stale cancel must be refused.
        const a = await mkOrder({ status: "OPENSTAAND", qty: 2 });
        const stockA = await a.stockNow();
        const payFirst = await inv.markOrderPaidByBankTransfer(a.order.id, { receivedAmountEur: a.total });
        const staleCancel = await inv.cancelOrder(a.order.id, { reason: "verouderde lijst", actor: "system", notifyCustomer: false, onlyFrom: ["OPENSTAAND"] });
        const aRow = await prisma.order.findUniqueOrThrow({ where: { id: a.order.id } });
        check(payFirst.ok && !staleCancel.ok && staleCancel.code === "conflict" && aRow.status === "PAID" && aRow.cancelledAt === null && aRow.refundedEur === 0 && (await notesOf(a.order.id)).length === 0 && (await a.stockNow()) === stockA,
          "R2-01 (forced order a): payment first, then the sweep's stale cancel: typed conflict, order stays PAID, no credit note, no refund owed, stock untouched", `R2-01 forced a: ${JSON.stringify(staleCancel)} ${aRow.status} notes ${(await notesOf(a.order.id)).length}`);
        // Negative control: the SAME call without onlyFrom does cancel and credit the paid order. Without this the check above could pass for the wrong reason.
        const b = await mkOrder({ status: "OPENSTAAND", qty: 2 });
        await inv.markOrderPaidByBankTransfer(b.order.id, { receivedAmountEur: b.total });
        const blind = await inv.cancelOrder(b.order.id, { reason: "blind", actor: "system", notifyCustomer: false });
        check(blind.ok && (await statusOf(b.order.id)) === "CANCELLED" && (await notesOf(b.order.id)).length === 1, "R2-01 (control): without onlyFrom the same cancel DOES cancel and credit a paid order, so the guard in (a) is what protects it", `R2-01 control: ${JSON.stringify(blind)}`);
        // (b) the sweep wins: the late payment is refused and the order stays cancelled with its single credit note.
        const c = await mkOrder({ status: "OPENSTAAND", qty: 2 });
        const sweepFirst = await inv.cancelOrder(c.order.id, { reason: "verlopen", actor: "system", notifyCustomer: false, onlyFrom: ["OPENSTAAND"] });
        const latePay = await inv.markOrderPaidByBankTransfer(c.order.id, { receivedAmountEur: c.total });
        const cRow = await prisma.order.findUniqueOrThrow({ where: { id: c.order.id } });
        check(sweepFirst.ok && !latePay.ok && cRow.status === "CANCELLED" && cRow.paidAt === null && (await notesOf(c.order.id)).length === 1, "R2-01 (forced order b): cancel first, then the payment: the payment is refused, still CANCELLED with exactly one credit note", `R2-01 forced b: ${JSON.stringify(latePay)} ${cRow.status}`);
      }
      const paid = await mkOrder({ status: "PAID", qty: 2 });
      const stock0 = await paid.stockNow();
      const notOnlyPaid = await inv.cancelOrder(paid.order.id, { reason: "veroudert besluit", actor: "system", onlyFrom: ["OPENSTAAND", "PENDING"] });
      check(!notOnlyPaid.ok && notOnlyPaid.code === "conflict" && (await statusOf(paid.order.id)) === "PAID" && (await paid.stockNow()) === stock0 && (await notesOf(paid.order.id)).length === 0, "R2-01: a cancel whose onlyFrom does not list PAID leaves a PAID order alone (typed conflict, no credit note, stock untouched)", `R2-01 onlyFrom: ${JSON.stringify(notOnlyPaid)}`);

      const noticesSince = async (m: number) => slackBodies.slice(m).map((x) => { try { return String(JSON.parse(x).text); } catch { return x; } });
      // R2-14: an abandoned, never-invoiced, unpaid order cancelled by stripe or the system is not news.
      const mark = slackBodies.length;
      const abandoned = await mkOrder({ status: "PENDING", invoice: false });
      const viaStripe = await inv.cancelOrder(abandoned.order.id, { reason: "Betaalsessie verlopen", actor: "stripe", notifyCustomer: false });
      const abandoned2 = await mkOrder({ status: "PENDING", invoice: false });
      const viaSystem = await inv.cancelOrder(abandoned2.order.id, { reason: "Betaling niet afgerond", actor: "system", notifyCustomer: false });
      await new Promise((r) => setTimeout(r, 150));
      check(viaStripe.ok && viaSystem.ok && (await noticesSince(mark)).length === 0, "R2-14 AFTER: abandoned PENDING orders cancelled by stripe/system send no owner notice", `R2-14: ${(await noticesSince(mark)).join(" | ")}`);
      const adminCancel = await mkOrder({ status: "PENDING", invoice: false });
      await inv.cancelOrder(adminCancel.order.id, { reason: "klant belde", actor: "admin", notifyCustomer: false });
      const invoicedSystem = await mkOrder({ status: "OPENSTAAND" });
      await inv.cancelOrder(invoicedSystem.order.id, { reason: "Niet betaald binnen de termijn", actor: "system", notifyCustomer: false });
      const paidStripe = await mkOrder({ status: "PAID", method: "STRIPE" });
      await inv.cancelOrder(paidStripe.order.id, { reason: "Betaling mislukt", actor: "stripe", notifyCustomer: false });
      await new Promise((r) => setTimeout(r, 150));
      check((await noticesSince(mark)).filter((t) => /geannuleerd/.test(t)).length === 3, "R2-14: an admin cancel, a system cancel of an INVOICED order and a cancel of a PAID order still reach the owner (3 notices)", `R2-14 others: ${(await noticesSince(mark)).length} notices`);
      check(inv.isQuietCancellation({ wasPaid: false, hadInvoice: false }, "stripe") && inv.isQuietCancellation({ wasPaid: false, hadInvoice: false }, "system") && !inv.isQuietCancellation({ wasPaid: false, hadInvoice: false }, "admin") && !inv.isQuietCancellation({ wasPaid: false, hadInvoice: true }, "system") && !inv.isQuietCancellation({ wasPaid: true, hadInvoice: false }, "stripe"), "R2-14: isQuietCancellation is the one rule (unpaid + never invoiced + stripe/system)", "R2-14: isQuietCancellation wrong");

      // R2-15: the restock record lives on OrderItem.restockedQty (section 12) and caps cumulatively; the guard for unshipped orders.
      const sh = await mkOrder({ status: "SHIPPED", method: "BANK_TRANSFER", qty: 3 });
      const base = await sh.stockNow();
      const a1 = await inv.recordRefund(sh.order.id, { amountEur: 3, idempotencyKey: "qa-orders-rs-1", restock: [{ partId: sh.part.id, quantity: 2 }], notifyCustomer: false });
      const a2 = await inv.recordRefund(sh.order.id, { amountEur: 3, idempotencyKey: "qa-orders-rs-2", restock: [{ partId: sh.part.id, quantity: 2 }], notifyCustomer: false });
      const a3 = await inv.recordRefund(sh.order.id, { amountEur: 3, idempotencyKey: "qa-orders-rs-3", restock: [{ partId: sh.part.id, quantity: 1 }], notifyCustomer: false });
      check(a1.ok && a1.restockedUnits === 2 && !a2.ok && a2.code === "invalid_input" && /maximaal 1/.test(a2.error) && a3.ok && (await sh.stockNow()) === base + 3 && (await inv.restockedByPart(sh.order.id)).get(sh.part.id) === 3,
        "R2-15: ordered 3, restock 2 then 2 -> the second is refused (max 1 left, nothing booked), then 1 is accepted: stock +3 in total, never more than ordered", `R2-15 cap: ${JSON.stringify([a1.ok, a2, a3.ok])} stock ${await sh.stockNow()} vs ${base + 3}`);
      check((await notesOf(sh.order.id)).length === 2, "R2-15: the refused refund booked no credit note", "R2-15: the refused restock left a credit note behind");
      const unshipped = await mkOrder({ status: "PAID", method: "BANK_TRANSFER", qty: 2 });
      const u0 = await unshipped.stockNow();
      const bad = await inv.recordRefund(unshipped.order.id, { amountEur: 4, idempotencyKey: "qa-orders-rs-4", restock: [{ partId: unshipped.part.id, quantity: 1 }], notifyCustomer: false });
      check(!bad.ok && bad.code === "invalid_input" && /annuleer/i.test(bad.error) && (await notesOf(unshipped.order.id)).length === 0 && (await unshipped.stockNow()) === u0, "R2-15: a restock on an unshipped PAID order is refused (cancel is the tool), nothing booked", `R2-15 unshipped: ${JSON.stringify(bad)}`);
      const full = await inv.recordRefund(unshipped.order.id, { amountEur: unshipped.total, idempotencyKey: "qa-orders-rs-5", notifyCustomer: false });
      check(full.ok && full.cancelled && (await unshipped.stockNow()) === u0 + 2, "R2-15: a full refund of an unshipped PAID order cancels it and puts exactly the ordered units back", `R2-15 full refund: ${JSON.stringify(full.ok)} stock ${await unshipped.stockNow()} vs ${u0 + 2}`);

      // Webhook first, admin second, at the domain level: the replay applies the restock once and records it.
      const wh = await mkOrder({ status: "SHIPPED", method: "STRIPE", qty: 2 });
      const w0 = await wh.stockNow();
      const first = await inv.recordRefund(wh.order.id, { amountEur: 5, stripeRefundId: "re_qa_orders_wh", notifyCustomer: false });
      const second = await inv.recordRefund(wh.order.id, { amountEur: 5, stripeRefundId: "re_qa_orders_wh", idempotencyKey: "qa-orders-wh-key", restock: [{ partId: wh.part.id, quantity: 1 }], notifyCustomer: false });
      const third = await inv.recordRefund(wh.order.id, { amountEur: 5, stripeRefundId: "re_qa_orders_wh", idempotencyKey: "qa-orders-wh-key", restock: [{ partId: wh.part.id, quantity: 1 }], notifyCustomer: false });
      const byKey = await inv.recordRefund(wh.order.id, { amountEur: 5, idempotencyKey: "qa-orders-wh-key", restock: [{ partId: wh.part.id, quantity: 1 }], notifyCustomer: false });
      check(first.ok && second.ok && second.replayed && second.restockedUnits === 1 && third.ok && third.restockedUnits === 0 && byKey.ok && byKey.replayed && byKey.restockedUnits === 0 && (await wh.stockNow()) === w0 + 1 && (await notesOf(wh.order.id)).length === 1,
        "R2-15: webhook books refund re_X first, the admin's booking of re_X is a replay that restocks once (+1), a repeat does not, and the same admin key now finds the note too", `R2-15 domain replay: ${JSON.stringify([first.ok, second.ok && [second.replayed, second.restockedUnits], third.ok && third.restockedUnits, byKey.ok && [byKey.replayed, byKey.restockedUnits]])} stock ${await wh.stockNow()} vs ${w0 + 1}`);
    }

    // ── 8. Guest token ──────────────────────────────────────────────────────
    {
      const token = inv.newAccessToken();
      check(/^[0-9a-f]{48}$/.test(token), "Token: 48 hex characters (24 random bytes)", `Token format: ${token}`);
      check(new Set(Array.from({ length: 2000 }, () => inv.newAccessToken())).size === 2000, "Token: 2000 generated tokens are all distinct", "Token: collision");
      const order = { accessToken: token };
      check(inv.orderAccessOk(order, token), "Token: the right token opens the order", "Token: right token refused");
      const refused = [token.slice(0, -1), token + "0", token.toUpperCase(), "", null, undefined, "x", token.slice(0, 10), " " + token];
      check(refused.every((t) => !inv.orderAccessOk(order, t as string | null | undefined)), "Token: wrong, truncated, extended, upper-cased, empty and missing tokens are refused", "Token: a wrong token was accepted");
      check(!inv.orderAccessOk({ accessToken: null }, "anything") && !inv.orderAccessOk({}, ""), "Token: an order without a token cannot be opened with one", "Token: tokenless order opened");
      const url = inv.orderUrlFor({ id: "abc123", accessToken: token });
      check(url.endsWith(`/bestelling/abc123?t=${token}`) && /^https?:\/\//.test(url), "Token: customer URL is absolute /bestelling/<id>?t=<token>", `Token url: ${url}`);
      check(st.customerOrderUrl("abc123") .endsWith("/bestelling/abc123") && !st.customerOrderUrl("abc123").includes("?"), "Token: without a token the URL carries no query", "Token: url without token has a query");
    }

    // ── 9. Company gate on invoicing ────────────────────────────────────────
    {
      check(inv.invoicingBlockedReason({ isProduction: false, readiness: { ready: false, missing: ["iban"] } }) === null, "Gate: outside production the dev fallbacks may invoice", "Gate: blocked outside production");
      check(inv.invoicingBlockedReason({ isProduction: true, readiness: { ready: true, missing: [] } }) === null, "Gate: a ready company may invoice in production", "Gate: ready company blocked");
      const b = inv.invoicingBlockedReason({ isProduction: true, readiness: { ready: false, missing: ["iban", "vatNumber"] } });
      check(b !== null && b.missing.join() === "iban,vatNumber", "Gate: an incomplete company is blocked in production, naming what is missing", "Gate: incomplete company not blocked");

      // The A1-02 repro: production, only COMPANY_KVK set. The invoice must NOT be issued.
      const o = await mkOrder({ status: "PAID", invoice: false });
      const probeFile = path.join(probeDir("qa-orders-probe-"), "probe.ts");
      writeFileSync(
        probeFile,
        `import { issueInvoiceForOrder } from ${JSON.stringify(path.resolve("src/lib/invoicing"))};
         issueInvoiceForOrder(process.env.PROBE_ORDER_ID!).then((r) => console.log("ISSUED " + (r && r.number)), (e) => console.log("THROWN " + e.name + " " + (e.missing || []).join(",")))
           .finally(() => process.exit(0));`,
      );
      const probe = (extra: Record<string, string>) =>
        spawnSync("npx", ["tsx", probeFile], {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, PROBE_ORDER_ID: o.order.id, NODE_ENV: "production", DEMO_MODE: "", SLACK_WEBHOOK_URL: "", COMPANY_NAME: "", COMPANY_STREET: "", COMPANY_POSTAL_CODE: "", COMPANY_CITY: "", COMPANY_KVK: "", COMPANY_VAT: "", COMPANY_IBAN: "", ...extra },
        });
      const kvkOnly = probe({ COMPANY_KVK: "90000001" });
      const out1 = (kvkOnly.stdout.match(/(ISSUED|THROWN).*/) ?? [""])[0];
      check(out1.startsWith("THROWN CompanyNotReadyError") && (await prisma.invoice.count({ where: { orderId: o.order.id } })) === 0, `Production with only COMPANY_KVK: no invoice is issued (${out1})`, `Production kvk-only repro: ${out1} ${kvkOnly.stderr.slice(0, 200)}`);
      // COMPANY_EMAIL belongs to the full identity since decision D15 (bundle FB): without it the company is not ready and no invoice is issued.
      const full = probe({ COMPANY_NAME: "WasFix Test B.V.", COMPANY_STREET: "Teststraat 1", COMPANY_POSTAL_CODE: "1011 AB", COMPANY_CITY: "Amsterdam", COMPANY_KVK: "90000001", COMPANY_VAT: "NL900000010B01", COMPANY_IBAN: "NL02ABNA0123456789", COMPANY_EMAIL: "info@wasfix-test.nl" });
      const out2 = (full.stdout.match(/(ISSUED|THROWN).*/) ?? [""])[0];
      const issued = await prisma.invoice.findUnique({ where: { orderId: o.order.id } });
      const seller = issued ? JSON.parse(issued.sellerJson) : {};
      check(out2.startsWith("ISSUED") && seller.iban === "NL02ABNA0123456789" && seller.vatNumber === "NL900000010B01" && seller.street === "Teststraat 1", "Production with the full identity: the invoice is issued with the real seller block", `Production full identity: ${out2} ${JSON.stringify(seller)} ${full.stderr.slice(0, 200)}`);
    }

    // ── 10. What the owner is told ──────────────────────────────────────────
    {
      await new Promise((r) => setTimeout(r, 150));
      const texts = slackBodies.map((b) => { try { return String(JSON.parse(b).text); } catch { return b; } });
      const joined = texts.join("\n---\n");
      check(texts.some((t) => /geannuleerd/i.test(t)) && texts.some((t) => /Betaling ontvangen/i.test(t)) && texts.some((t) => /Terugbetaling/i.test(t)), `Owner notices: cancel, payment and refund each reached the (local) Slack channel (${texts.length} messages)`, `Owner notices missing: ${texts.length} messages`);
      check(!/@qa-orders\.test/i.test(joined) && !/Piet|Jansen|Teststraat|1011/.test(joined), "Owner notices: no customer e-mail, name or address in any message", "Owner notices leak customer data");
      check(/#[0-9A-Z]{8}/.test(joined) && /€ \d+,\d{2}/.test(joined) && /\d+ artikel/.test(joined) && /\/admin\/bestellingen/.test(joined), "Owner notices: order number, total, item count and admin link are present", "Owner notices lack order number/total/items/link");
      // notifyOrderPlaced
      const o = await mkOrder({ status: "OPENSTAAND" });
      slackBodies.length = 0;
      await inv.notifyOrderPlaced(o.order.id);
      const placed = slackBodies.map((b) => String(JSON.parse(b).text)).join("\n");
      check(/Nieuwe bestelling/.test(placed) && /overschrijving/.test(placed) && !/qa-orders\.test/.test(placed), "Owner notices: notifyOrderPlaced announces a new order without customer data", `notifyOrderPlaced: ${placed}`);
    }

    // ── 11. Repair round ────────────────────────────────────────────────────
    const sumLines = (lines: Array<{ lineTotalEur: number }>) => inv.money(lines.reduce((n, l) => n + l.lineTotalEur, 0));
    const slackTextsSince = async (mark: number) => {
      await new Promise((r) => setTimeout(r, 200));
      return slackBodies.slice(mark).map((b) => String(JSON.parse(b).text));
    };

    // 11a. A paid order that was never invoiced still owes its money back.
    {
      const o = await mkOrder({ status: "PAID", invoice: false, qty: 2, price: 20 }); // 40,00
      const before = await o.stockNow();
      const r = await inv.cancelOrder(o.order.id, { reason: "klant belde", actor: "admin" });
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      const invoice = await inv.getInvoiceForOrder(o.order.id);
      check(
        r.ok && r.refundDueEur === 40 && row.refundedEur === 40 && r.creditNote !== null && r.creditNote.totalEur === 40 && invoice !== null && (await o.stockNow()) === before + 2,
        "Cancel PAID without an invoice: the invoice is issued and credited, refundDueEur = 40,00, refundedEur = 40,00, units back",
        `Cancel PAID without invoice lost the refund: ${JSON.stringify(r)} refunded ${row.refundedEur} invoice ${invoice?.number}`,
      );
      const double = await inv.cancelOrder(o.order.id, { reason: "nog eens", actor: "admin" });
      check(double.ok && double.alreadyCancelled && (await notesOf(o.order.id)).length === 1 && (await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).refundedEur === 40, "Cancel PAID without an invoice: a replay books nothing twice", `Replay of the uninvoiced cancel: ${JSON.stringify(double)}`);
    }
    {
      // Production, company identity incomplete: no invoice can be issued, the refund is still owed.
      const o = await mkOrder({ status: "PAID", invoice: false, qty: 2, price: 20 });
      const before = await o.stockNow();
      const probeFile = path.join(probeDir("qa-orders-cancel-"), "probe.ts");
      writeFileSync(
        probeFile,
        `import { cancelOrder } from ${JSON.stringify(path.resolve("src/lib/invoicing"))};
         cancelOrder(process.env.PROBE_ORDER_ID!, { reason: "klant belde", actor: "admin" }).then((r) => console.log("RESULT " + JSON.stringify(r)))
           .finally(() => process.exit(0));`,
      );
      const mark = slackBodies.length;
      const run = spawnSync("npx", ["tsx", probeFile], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, PROBE_ORDER_ID: o.order.id, NODE_ENV: "production", DEMO_MODE: "", COMPANY_NAME: "", COMPANY_STREET: "", COMPANY_POSTAL_CODE: "", COMPANY_CITY: "", COMPANY_KVK: "", COMPANY_VAT: "", COMPANY_IBAN: "" },
      });
      const res = JSON.parse((run.stdout.split("\n").find((l) => l.startsWith("RESULT ")) ?? "RESULT {}").slice(7)) as { ok?: boolean; refundDueEur?: number; creditNote?: unknown; emailSent?: boolean | null };
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      const texts = (await slackTextsSince(mark)).filter((t) => t.includes(`#${st.orderRef(o.order.id)}`));
      check(
        res.ok === true && res.creditNote === null && res.refundDueEur === 40 && row.status === "CANCELLED" && row.refundedEur === 40 && (await inv.getInvoiceForOrder(o.order.id)) === null && (await o.stockNow()) === before + 2,
        "Cancel PAID in production with an incomplete company identity: no invoice is invented, the 40,00 refund is still owed and recorded",
        `Cancel PAID, company blocked: ${JSON.stringify(res)} refunded ${row.refundedEur} ${run.stderr.slice(0, 200)}`,
      );
      check(texts.some((t) => /Nog terug te betalen: € 40,00/.test(t) && /Geen factuur mogelijk/.test(t)), "Cancel PAID without a possible invoice: the owner is told what is still to be paid back", `Owner notice lacks the refund line: ${texts.join(" | ")}`);
    }

    // 11b. Credit notes carry shipping and discount: the lines add up to the total.
    {
      const o = await mkOrder({ status: "PAID", qty: 2, price: 20, shipping: 5.95, discount: 4 }); // 40 - 4 + 5.95 = 41.95
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { orderId: o.order.id } });
      const r = await inv.cancelOrder(o.order.id, { reason: "klant belde", actor: "admin" });
      const note = r.ok ? r.creditNote : null;
      const names = (note?.lines ?? []).map((l) => l.name).join("|");
      check(
        invoice.totalEur === 41.95 && note !== null && note.totalEur === 41.95 && sumLines(note.lines) === note.totalEur && /Verzendkosten/.test(names) && /Korting/.test(names),
        `Credit note of an invoice with shipping and discount: lines add up to the total (${note ? sumLines(note.lines) : "?"} = ${note?.totalEur}), shipping and discount are listed`,
        `Credit note lines do not add up: ${note ? JSON.stringify(note.lines.map((l) => [l.name, l.lineTotalEur])) : JSON.stringify(r)} total ${note?.totalEur}`,
      );
      check(note !== null && inv.money(note.subtotalEur + note.vatEur) === note.totalEur && note.vatEur === invoice.vatEur, "Credit note of a full invoice: net + VAT = total and the VAT equals the invoice VAT", `Credit note VAT: ${note?.subtotalEur} + ${note?.vatEur} vs ${note?.totalEur}, invoice VAT ${invoice.vatEur}`);
      const partialOrder = await mkOrder({ status: "PAID", qty: 2, price: 20, shipping: 5.95, discount: 4 });
      const pinv = await prisma.invoice.findUniqueOrThrow({ where: { orderId: partialOrder.order.id } });
      const part = await inv.issueCreditNote(pinv.id, { amountEur: 10, reason: "deel" });
      check(sumLines(part.lines) === part.totalEur && part.lines.length === 1, "Partial credit note: one descriptive line that equals its amount", `Partial note lines: ${JSON.stringify(part.lines)}`);
    }

    // 11c. VAT of consecutive credit notes is never negative and adds up to the invoice.
    {
      const noneNegative: string[] = [];
      const drift: string[] = [];
      let seed = 12345;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let i = 0; i < 3000; i++) {
        const totalCents = 1 + Math.floor(rnd() * 20000);
        const vatEur = inv.splitVatInclusive(totalCents / 100).vatEur;
        const parts = 1 + Math.floor(rnd() * 5);
        let prior = 0;
        let priorVat = 0;
        let sumVat = 0;
        let sumNet = 0;
        for (let k = 0; k < parts && prior < totalCents; k++) {
          const last = k === parts - 1;
          const amountCents = last ? totalCents - prior : Math.max(1, Math.min(totalCents - prior, Math.floor(rnd() * (totalCents - prior))));
          const n = inv.creditNoteVat({ invoiceTotalCents: totalCents, invoiceVatEur: vatEur, priorCents: prior, priorVatEur: priorVat, amountCents, vatRate: 0.21 });
          if (n.vatEur < 0 || n.vatEur > amountCents / 100 || n.subtotalEur < 0) noneNegative.push(`${totalCents}:${prior}+${amountCents}=>${n.vatEur}/${n.subtotalEur}`);
          prior += amountCents;
          priorVat = inv.money(priorVat + n.vatEur);
          sumVat += n.vatEur;
          sumNet += n.subtotalEur;
        }
        if (prior === totalCents && (inv.money(sumVat) !== vatEur || inv.money(sumVat + sumNet) !== totalCents / 100)) drift.push(`${totalCents}: vat ${inv.money(sumVat)} vs ${vatEur}`);
      }
      check(noneNegative.length === 0, "Credit note VAT: 3000 random splits, no note has negative VAT or net, none has more VAT than its amount", `Credit note VAT out of range: ${noneNegative.slice(0, 3).join("; ")}`);
      check(drift.length === 0, "Credit note VAT: the notes of 3000 random splits add up to the invoice VAT and total to the cent", `Credit note VAT drift: ${drift.slice(0, 3).join("; ")}`);
      // The reviewed case: 1,00 incl. VAT (0,17), credited 0,50 + 0,49 + 0,01. The old arithmetic gave the last note -0,01.
      const tiny = await mkOrder({ status: "PAID", qty: 1, price: 1 });
      const tinv = await prisma.invoice.findUniqueOrThrow({ where: { orderId: tiny.order.id } });
      const n1 = await inv.issueCreditNote(tinv.id, { amountEur: 0.5, reason: "a" });
      const n2 = await inv.issueCreditNote(tinv.id, { amountEur: 0.49, reason: "b" });
      const n3 = await inv.issueCreditNote(tinv.id, { amountEur: 0.01, reason: "c" });
      check(
        tinv.vatEur === 0.17 && [n1, n2, n3].every((n) => n.vatEur >= 0 && n.subtotalEur >= 0 && n.subtotalEur <= n.totalEur) && inv.money(n1.vatEur + n2.vatEur + n3.vatEur) === 0.17,
        `Credit note VAT, 1,00 credited as 0,50 + 0,49 + 0,01: VAT ${n1.vatEur} + ${n2.vatEur} + ${n3.vatEur} = 0,17, none negative`,
        `Tiny split: ${[n1, n2, n3].map((n) => `${n.totalEur}/${n.vatEur}/${n.subtotalEur}`).join(" ")}`,
      );
    }

    // 11d. Partial refunds are idempotent when the caller says how.
    {
      const mk = () => mkOrder({ status: "PAID", method: "BANK_TRANSFER", qty: 2, price: 20 }); // 40,00, no Stripe id possible
      const a = await mk();
      const key = `form-${a.order.id}`;
      const r1 = await inv.recordRefund(a.order.id, { amountEur: 10, reason: "krasje", idempotencyKey: key });
      const r2 = await inv.recordRefund(a.order.id, { amountEur: 10, reason: "krasje", idempotencyKey: key });
      const rowA = await prisma.order.findUniqueOrThrow({ where: { id: a.order.id } });
      check(r1.ok && !r1.replayed && r2.ok && r2.replayed && r2.creditNote.number === r1.creditNote.number && rowA.refundedEur === 10 && (await notesOf(a.order.id)).length === 1, "Refund with an idempotencyKey: a second submit returns the first note, refundedEur stays 10", `Idempotency key replay: ${JSON.stringify([r1, r2])} refunded ${rowA.refundedEur}`);

      const b = await mk();
      const bKey = `form-${b.order.id}`;
      const burst = await Promise.all(Array.from({ length: 6 }, () => inv.recordRefund(b.order.id, { amountEur: 10, idempotencyKey: bKey })));
      check(burst.every((x) => x.ok) && burst.filter((x) => x.ok && !x.replayed).length === 1 && (await notesOf(b.order.id)).length === 1 && (await prisma.order.findUniqueOrThrow({ where: { id: b.order.id } })).refundedEur === 10, "Refund with an idempotencyKey: 6 concurrent submits book exactly one credit note", `Idempotency burst: ${JSON.stringify(burst.map((x) => (x.ok ? (x.replayed ? "replay" : "new") : x.code)))}`);

      const c = await mk();
      const raced = await Promise.all([
        inv.recordRefund(c.order.id, { amountEur: 10, reason: "a", expectedRefundedEur: 0 }),
        inv.recordRefund(c.order.id, { amountEur: 10, reason: "a", expectedRefundedEur: 0 }),
        inv.recordRefund(c.order.id, { amountEur: 10, reason: "a", expectedRefundedEur: 0 }),
      ]);
      const rowC = await prisma.order.findUniqueOrThrow({ where: { id: c.order.id } });
      check(raced.filter((x) => x.ok).length === 1 && raced.filter((x) => !x.ok && x.code === "conflict").length === 2 && rowC.refundedEur === 10 && (await notesOf(c.order.id)).length === 1, "Refund with expectedRefundedEur: of 3 concurrent submits built from the same page exactly one wins, the others are refused as a conflict", `expectedRefundedEur race: ${JSON.stringify(raced.map((x) => (x.ok ? "ok" : x.code)))} refunded ${rowC.refundedEur}`);
      const stale = await inv.recordRefund(c.order.id, { amountEur: 5, expectedRefundedEur: 0 });
      const fresh = await inv.recordRefund(c.order.id, { amountEur: 5, expectedRefundedEur: 10 });
      check(!stale.ok && stale.code === "conflict" && fresh.ok && fresh.refundedEur === 15, "Refund with expectedRefundedEur: a stale value is refused, the current one is accepted", `expectedRefundedEur stale/fresh: ${JSON.stringify([stale, fresh])}`);

      // What it does NOT do, stated as a test: with neither key nor expectation two identical partial refunds are two refunds.
      const d = await mk();
      await inv.recordRefund(d.order.id, { amountEur: 10 });
      await inv.recordRefund(d.order.id, { amountEur: 10 });
      check((await notesOf(d.order.id)).length === 2, "Refund without any key: two partial refunds of the same amount are booked twice (documented, not a replay)", "Refund without key was deduplicated");

      const e = await mk();
      const other = await mk();
      await inv.recordRefund(other.order.id, { amountEur: 5, idempotencyKey: "shared-key-1" });
      const cross = await inv.recordRefund(e.order.id, { amountEur: 5, idempotencyKey: "shared-key-1" });
      const tooLong = await inv.recordRefund(e.order.id, { amountEur: 5, idempotencyKey: "x".repeat(101) });
      check(!cross.ok && cross.code === "conflict" && !tooLong.ok && tooLong.code === "invalid_input" && (await notesOf(e.order.id)).length === 0, "Refund: a key used on another order is a conflict, a key over 100 characters is invalid; nothing is written", `Key misuse: ${JSON.stringify([cross, tooLong])}`);

      const f = await mk();
      const fKey = `full-${f.order.id}`;
      const full1 = await inv.recordRefund(f.order.id, { amountEur: 40, idempotencyKey: fKey });
      const full2 = await inv.recordRefund(f.order.id, { amountEur: 40, idempotencyKey: fKey });
      const stockF = await f.stockNow();
      check(full1.ok && full1.cancelled && full2.ok && full2.replayed && (await notesOf(f.order.id)).length === 1 && stockF === f.stockStart, "Refund completing an unshipped order with a key: the replay returns the note and the units were restocked once", `Full refund with key: ${JSON.stringify([full1, full2])} stock ${stockF} vs ${f.stockStart}`);
    }

    // 11e. The Dutch calendar year decides the series, not the server's UTC clock.
    {
      check(
        inv.amsterdamYear(new Date("2026-12-31T23:30:00Z")) === 2027 && inv.amsterdamYear(new Date("2027-01-01T00:30:00Z")) === 2027 && inv.amsterdamYear(new Date("2026-12-31T22:59:00Z")) === 2026 && inv.amsterdamYear(new Date("2026-06-30T22:30:00Z")) === 2026,
        "Year: 23:30 UTC on 31 December is already 2027 in Amsterdam (22:59 is not)",
        `amsterdamYear: ${[ "2026-12-31T23:30:00Z", "2027-01-01T00:30:00Z", "2026-12-31T22:59:00Z" ].map((d) => inv.amsterdamYear(new Date(d))).join(",")}`,
      );
      // End to end: a clock set to 23:30 UTC on New Year's Eve. The invoice and the credit note both belong to 2027.
      const o = await mkOrder({ status: "PAID", invoice: false, qty: 1, price: 20 });
      const RealDate = Date;
      const FIXED = new RealDate("2026-12-31T23:30:00Z").getTime();
      class FakeDate extends RealDate {
        constructor(...args: unknown[]) {
          if (args.length === 0) super(FIXED);
          else super(...(args as [number]));
        }
        static now() { return FIXED; }
      }
      (globalThis as { Date: DateConstructor }).Date = FakeDate as unknown as DateConstructor;
      let r;
      try { r = await inv.cancelOrder(o.order.id, { reason: "oud en nieuw", actor: "system", notifyCustomer: false }); } finally { (globalThis as { Date: DateConstructor }).Date = RealDate; }
      const invoice = await inv.getInvoiceForOrder(o.order.id);
      const invRow = await prisma.invoice.findUnique({ where: { orderId: o.order.id } });
      check(r.ok && r.creditNote?.number.startsWith("CN-2027-") === true && invoice?.number.startsWith("2027-") === true && invRow?.year === 2027, `Year: an invoice and credit note issued at 23:30 UTC on 31 December are numbered ${invoice?.number} and ${r.ok ? r.creditNote?.number : "?"} (2027 series)`, `New Year's Eve numbering: ${JSON.stringify(r)} invoice ${invoice?.number}`);
      // Remove the 2027 test documents and their sequence rows so the real series is untouched.
      await prisma.creditNote.deleteMany({ where: { year: 2027 } });
      await prisma.invoice.deleteMany({ where: { year: 2027 } });
      await prisma.creditNoteSequence.deleteMany({ where: { year: 2027 } });
      await prisma.invoiceSequence.deleteMany({ where: { year: 2027 } });
    }

    // 11f. Production: the company identity is stored as validated, and test values are not invoiced in silence.
    {
      const o1 = await mkOrder({ status: "PAID", invoice: false });
      const o2 = await mkOrder({ status: "PAID", invoice: false });
      const probeFile = path.join(probeDir("qa-orders-company-"), "probe.ts");
      writeFileSync(
        probeFile,
        `import { issueInvoiceForOrder } from ${JSON.stringify(path.resolve("src/lib/invoicing"))};
         (async () => { for (const id of process.env.PROBE_ORDER_IDS!.split(",")) { const r = await issueInvoiceForOrder(id); console.log("ISSUED " + (r && r.number)); } })()
           .catch((e) => console.log("THROWN " + e.name)).finally(() => setTimeout(() => process.exit(0), 400));`,
      );
      const mark = slackBodies.length;
      const run = spawnSync("npx", ["tsx", probeFile], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          PROBE_ORDER_IDS: `${o1.order.id},${o2.order.id}`,
          NODE_ENV: "production",
          DEMO_MODE: "",
          // The contact address is part of company readiness (decision D15): without one nothing is invoiced.
          COMPANY_EMAIL: "info@wasfix-test.nl",
          // Messy, as pasted: groups, lower case, stray spaces, a dotted KvK.
          COMPANY_NAME: "  WasFix   Test B.V.  ",
          COMPANY_STREET: " Teststraat 1 ",
          COMPANY_POSTAL_CODE: "1011ab",
          COMPANY_CITY: " Amsterdam ",
          COMPANY_KVK: "9000 0001",
          COMPANY_VAT: "nl900000010b01",
          COMPANY_IBAN: "nl02 abna 0123 4567 89",
        },
      });
      const inv1 = await prisma.invoice.findUnique({ where: { orderId: o1.order.id } });
      const seller = inv1 ? JSON.parse(inv1.sellerJson) : {};
      check(
        seller.name === "WasFix Test B.V." && seller.street === "Teststraat 1" && seller.postalCode === "1011 AB" && seller.city === "Amsterdam" && seller.kvk === "90000001" && seller.vatNumber === "NL900000010B01" && seller.iban === "NL02ABNA0123456789",
        "Production with a messy company env: the permanent invoice seller block holds the canonical, validated values",
        `Seller block is not canonical: ${JSON.stringify(seller)} ${run.stdout.slice(0, 200)} ${run.stderr.slice(0, 200)}`,
      );
      const texts = (await slackTextsSince(mark)).filter((t) => /Bedrijfsgegevens zien er niet echt uit/.test(t));
      check(
        texts.length === 1 && /COMPANY_KVK is een testnummer/.test(texts[0]) && /COMPANY_IBAN is een testrekening/.test(texts[0]),
        "Production with the sandbox test numbers: two invoices produce exactly ONE owner warning naming the test KvK/IBAN (a missing COMPANY_EMAIL no longer only warns: it blocks, see below)",
        `Test-value warning: ${texts.length} message(s): ${texts.join(" | ").slice(0, 300)} ${run.stdout.slice(0, 200)}`,
      );
    }

    // 11g. D15: no contact address, no invoice (the old behaviour was a warning and an invoice anyway).
    {
      const o3 = await mkOrder({ status: "PAID", invoice: false });
      const probeFile = path.join(probeDir("qa-orders-noemail-"), "probe.ts");
      writeFileSync(
        probeFile,
        `import { issueInvoiceForOrder } from ${JSON.stringify(path.resolve("src/lib/invoicing"))};
         (async () => { const r = await issueInvoiceForOrder(process.env.PROBE_ORDER_IDS!); console.log("ISSUED " + (r && r.number)); })()
           .catch((e) => console.log("THROWN " + e.name + " " + (e.missing ?? []).join(","))).finally(() => setTimeout(() => process.exit(0), 400));`,
      );
      const run = spawnSync("npx", ["tsx", probeFile], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, PROBE_ORDER_IDS: o3.order.id, NODE_ENV: "production", DEMO_MODE: "", COMPANY_EMAIL: "", COMPANY_NAME: "WasFix Test B.V.", COMPANY_STREET: "Teststraat 1", COMPANY_POSTAL_CODE: "1011 AB", COMPANY_CITY: "Amsterdam", COMPANY_KVK: "90000001", COMPANY_VAT: "NL900000010B01", COMPANY_IBAN: "NL02ABNA0123456789" },
      });
      const out = (run.stdout.match(/(ISSUED|THROWN).*/) ?? [""])[0];
      check(/^THROWN CompanyNotReadyError.*email/.test(out) && (await prisma.invoice.count({ where: { orderId: o3.order.id } })) === 0, `Production with a complete identity but no COMPANY_EMAIL: no invoice (${out})`, `No-email repro: ${out} ${run.stderr.slice(0, 200)}`);
    }

    // ── 12. OrderItem.restockedQty: the restock record as a column ─────────
    // Until migration 20261009120000 the units a refund put back were written on the first line of the credit
    // note's linesJson and the cap was computed by parsing every note. Now the order line counts them and the cap
    // is one conditional update on that column, inside the refund's transaction.
    {
      const itemOf = async (orderId: string) => prisma.orderItem.findFirstOrThrow({ where: { orderId }, select: { id: true, quantity: true, restockedQty: true } });
      const rawNotes = async (orderId: string) => prisma.creditNote.findMany({ where: { invoice: { orderId } }, orderBy: { issuedAt: "asc" }, select: { linesJson: true, idempotencyKey: true } });

      // 12a. Every refund that restocks adds to the column; the document carries no restock key.
      const o = await mkOrder({ status: "SHIPPED", method: "BANK_TRANSFER", qty: 3, price: 10 }); // 30,00
      const s0 = await o.stockNow();
      check((await itemOf(o.order.id)).restockedQty === 0, "Column: a fresh order line has restockedQty 0", "Column: a fresh order line is not 0");
      const r1 = await inv.recordRefund(o.order.id, { amountEur: 5, idempotencyKey: `qa-col-1-${o.order.id}`, restock: [{ partId: o.part.id, quantity: 1 }], notifyCustomer: false });
      const after1 = await itemOf(o.order.id);
      const r2 = await inv.recordRefund(o.order.id, { amountEur: 5, idempotencyKey: `qa-col-2-${o.order.id}`, restock: [{ partId: o.part.id, quantity: 1 }], notifyCustomer: false });
      const after2 = await itemOf(o.order.id);
      check(
        r1.ok && r1.restockedUnits === 1 && after1.restockedQty === 1 && r2.ok && r2.restockedUnits === 1 && after2.restockedQty === 2 && (await o.stockNow()) === s0 + 2,
        "Column: two refunds that each restock one unit leave restockedQty 2 (1 after the first) and the shelf +2",
        `Column increments: ${JSON.stringify([r1.ok, after1.restockedQty, r2.ok, after2.restockedQty])} stock ${await o.stockNow()} vs ${s0 + 2}`,
      );
      const notes = await rawNotes(o.order.id);
      const parsedLines = notes.map((n) => JSON.parse(n.linesJson) as Array<Record<string, unknown>>);
      check(
        notes.length === 2 && notes.every((n) => !/"restock"/.test(n.linesJson)) && parsedLines.every((lines) => Array.isArray(lines) && lines.length === 1 && !("restock" in lines[0]) && typeof lines[0].name === "string"),
        'Document: the issued credit notes\' linesJson carries no "restock" key (the record is the column, not the fiscal document)',
        `linesJson still annotated: ${notes.map((n) => n.linesJson).join(" | ")}`,
      );
      check((await inv.getCreditNotesForOrder(o.order.id)).every((n) => n.lines.every((l) => l.restock === undefined)), "Document: getCreditNotesForOrder returns lines without a restock property", "Document: a deserialised line has a restock property");

      // 12b. The cap: the unit that would exceed what was ordered is refused with the Dutch message; nothing moves.
      const r3 = await inv.recordRefund(o.order.id, { amountEur: 5, idempotencyKey: `qa-col-3-${o.order.id}`, restock: [{ partId: o.part.id, quantity: 2 }], notifyCustomer: false });
      const after3 = await itemOf(o.order.id);
      check(
        !r3.ok && r3.code === "invalid_input" && /maximaal 1 stuk/.test(r3.error) && /besteld 3, eerder al 2/.test(r3.error) && after3.restockedQty === 2 && (await o.stockNow()) === s0 + 2 && (await rawNotes(o.order.id)).length === 2,
        `Cap: ordered 3, 2 already back, a restock of 2 is refused ("${r3.ok ? "" : r3.error}"); the column stays 2, no note, no stock movement`,
        `Cap: ${JSON.stringify(r3)} column ${after3.restockedQty} stock ${await o.stockNow()} vs ${s0 + 2}`,
      );
      const r4 = await inv.recordRefund(o.order.id, { amountEur: 5, idempotencyKey: `qa-col-4-${o.order.id}`, restock: [{ partId: o.part.id, quantity: 1 }], notifyCustomer: false });
      const r5 = await inv.recordRefund(o.order.id, { amountEur: 5, idempotencyKey: `qa-col-5-${o.order.id}`, restock: [{ partId: o.part.id, quantity: 1 }], notifyCustomer: false });
      check(
        r4.ok && (await itemOf(o.order.id)).restockedQty === 3 && !r5.ok && r5.code === "invalid_input" && /al alles terug/.test(r5.error) && (await o.stockNow()) === s0 + 3,
        "Cap: the last unit goes back (column 3 = ordered), one more is refused as 'al alles terug'",
        `Cap last unit: ${JSON.stringify([r4, r5])} column ${(await itemOf(o.order.id)).restockedQty}`,
      );

      // 12c. The cap reads the column, not the notes: a line set by hand counts although no credit note exists.
      const h = await mkOrder({ status: "SHIPPED", method: "BANK_TRANSFER", qty: 2 });
      await prisma.orderItem.updateMany({ where: { orderId: h.order.id }, data: { restockedQty: 1 } });
      const byPart = await inv.restockedByPart(h.order.id);
      const hr = await inv.recordRefund(h.order.id, { amountEur: 4, idempotencyKey: `qa-col-h-${h.order.id}`, restock: [{ partId: h.part.id, quantity: 2 }], notifyCustomer: false });
      const summed = inv.restockedOfItems([{ partId: "a", restockedQty: 1 }, { partId: "a", restockedQty: 2 }, { partId: "b", restockedQty: 0 }]);
      check(
        byPart.get(h.part.id) === 1 && (await notesOf(h.order.id)).length === 0 && !hr.ok && /maximaal 1 stuk/.test(hr.ok ? "" : hr.error) && summed.get("a") === 3 && summed.get("b") === 0,
        "Cap reads the column: restockedQty 1 set without any credit note caps the next restock at 1; restockedOfItems sums per part",
        `Column read: ${JSON.stringify([byPart.get(h.part.id), hr, [...summed]])}`,
      );

      // 12d. TWO CONCURRENT refunds that together exceed what was ordered: exactly one is booked (real Postgres, two connections).
      const c = await mkOrder({ status: "SHIPPED", method: "BANK_TRANSFER", qty: 2, price: 10 }); // 20,00
      const c0 = await c.stockNow();
      const race = await Promise.all([
        inv.recordRefund(c.order.id, { amountEur: 4, idempotencyKey: `qa-col-c1-${c.order.id}`, restock: [{ partId: c.part.id, quantity: 2 }], notifyCustomer: false }),
        inv.recordRefund(c.order.id, { amountEur: 4, idempotencyKey: `qa-col-c2-${c.order.id}`, restock: [{ partId: c.part.id, quantity: 1 }], notifyCustomer: false }),
      ]);
      const cItem = await itemOf(c.order.id);
      const won = race.filter((r) => r.ok);
      const wonUnits = won[0]?.ok ? won[0].restockedUnits : -1;
      check(
        won.length === 1 && race.filter((r) => !r.ok && (r.code === "invalid_input" || r.code === "conflict")).length === 1 && cItem.restockedQty === wonUnits && (await c.stockNow()) === c0 + wonUnits && (await notesOf(c.order.id)).length === 1,
        `Race: two concurrent refunds restocking 2 and 1 on an order of 2: exactly one is booked (${wonUnits} unit(s)), the other is refused, the column (${cItem.restockedQty}) equals the shelf delta, one note`,
        `Race: ${JSON.stringify(race.map((r) => (r.ok ? `ok:${r.restockedUnits}` : r.code)))} column ${cItem.restockedQty} stock ${await c.stockNow()} vs ${c0}`,
      );

      // 12e. The conditional update ALONE is the lock. Two transactions claim 2 units on a line of 2 without any order
      // lock. No sleep decides who goes first: the FIRST claims the row and signals; only then the SECOND starts, reads
      // the line as still 0 (nothing is committed), passes the pre-check and blocks on the row; the first commits only
      // once Postgres reports the second waiting on a lock (pg_stat_activity, up to 10 s as a safety valve), so the
      // second's WHERE no longer holds when it finally runs (count 0), at any timing.
      const d = await mkOrder({ status: "SHIPPED", method: "BANK_TRANSFER", qty: 2 });
      const d0 = await d.stockNow();
      const dOrder = { id: d.order.id, status: "SHIPPED", items: [{ partId: d.part.id, quantity: 2 }] };
      const txOpts = { maxWait: 10_000, timeout: 20_000 };
      let rowHeld!: () => void;
      const held = new Promise<void>((resolve) => (rowHeld = resolve));
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      const first = prisma.$transaction(async (t) => {
        const units = await inv.applyRestock(t, dOrder, [{ partId: d.part.id, quantity: 2 }]);
        rowHeld(); // the row is locked by this transaction from here until it commits
        await released;
        return units;
      }, txOpts);
      await held;
      let secondSaw = -1;
      const second = prisma.$transaction(async (t) => {
        secondSaw = (await t.orderItem.findFirstOrThrow({ where: { orderId: d.order.id }, select: { restockedQty: true } })).restockedQty;
        return inv.applyRestock(t, dOrder, [{ partId: d.part.id, quantity: 2 }]);
      }, txOpts);
      let secondWaited = false;
      for (const deadline = Date.now() + 10_000; !secondWaited && Date.now() < deadline; ) {
        const waiting = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'`;
        secondWaited = waiting[0].n > 0;
        if (!secondWaited) await new Promise((r) => setTimeout(r, 20));
      }
      release();
      const claims = await Promise.allSettled([first, second]);
      const dItem = await itemOf(d.order.id);
      const lost = claims.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      check(
        secondSaw === 0 && secondWaited && claims[0].status === "fulfilled" && claims[0].value === 2 && lost.length === 1 && lost[0].reason instanceof inv.OrderDomainError && lost[0].reason.code === "conflict" && dItem.restockedQty === 2 && (await d.stockNow()) === d0 + 2,
        "Lock: two transactions each claim the 2 units of a line of 2 with no order lock; the second read the line as 0 and was seen waiting on the row; the conditional update on restockedQty lets exactly the first through, the second is a conflict, column 2, shelf +2",
        `applyRestock race: ${JSON.stringify(claims.map((r) => (r.status === "fulfilled" ? `ok:${r.value}` : String((r.reason as { code?: string; message?: string }).code ?? r.reason))))} second saw ${secondSaw}, waited on a lock: ${secondWaited}, column ${dItem.restockedQty} stock ${await d.stockNow()} vs ${d0 + 2}`,
      );

      // 12f. Replay (the webhook books first): the admin's key claims the note and the column takes the admin's restock, once.
      const w = await mkOrder({ status: "SHIPPED", method: "STRIPE", qty: 2 });
      const wRefund = `re_qa_col_${w.order.id}`;
      const wKey = `qa-col-w-${w.order.id}`;
      const wFirst = await inv.recordRefund(w.order.id, { amountEur: 5, stripeRefundId: wRefund, notifyCustomer: false });
      const wSecond = await inv.recordRefund(w.order.id, { amountEur: 5, stripeRefundId: wRefund, idempotencyKey: wKey, restock: [{ partId: w.part.id, quantity: 1 }], notifyCustomer: false });
      const wThird = await inv.recordRefund(w.order.id, { amountEur: 5, stripeRefundId: wRefund, idempotencyKey: wKey, restock: [{ partId: w.part.id, quantity: 1 }], notifyCustomer: false });
      const wNotes = await rawNotes(w.order.id);
      check(
        wFirst.ok && wSecond.ok && wSecond.replayed && wSecond.restockedUnits === 1 && wThird.ok && wThird.restockedUnits === 0 && (await itemOf(w.order.id)).restockedQty === 1 && wNotes.length === 1 && wNotes[0].idempotencyKey === wKey && !/"restock"/.test(wNotes[0].linesJson),
        "Replay: the webhook's note takes the admin's key, the column takes the admin's restock once (a repeat of the form adds nothing), and the note's lines stay without a restock key",
        `Replay column: ${JSON.stringify([wSecond.ok && [wSecond.replayed, wSecond.restockedUnits], wThird.ok && wThird.restockedUnits, (await itemOf(w.order.id)).restockedQty, wNotes])}`,
      );
      // A replay that brings no key could not be told apart from its own repeat, so it restocks nothing (documented).
      const k = await mkOrder({ status: "SHIPPED", method: "STRIPE", qty: 2 });
      const kRefund = `re_qa_colk_${k.order.id}`;
      const kFirst = await inv.recordRefund(k.order.id, { amountEur: 5, stripeRefundId: kRefund, notifyCustomer: false });
      const kKeyless = await inv.recordRefund(k.order.id, { amountEur: 5, stripeRefundId: kRefund, restock: [{ partId: k.part.id, quantity: 1 }], notifyCustomer: false });
      check(
        kFirst.ok && kKeyless.ok && kKeyless.replayed && kKeyless.restockedUnits === 0 && (await itemOf(k.order.id)).restockedQty === 0 && (await k.stockNow()) === k.stockStart - 2,
        "Replay without a key: recognised as the same refund, but it restocks nothing (nothing could make its repeat a no-op)",
        `Keyless replay: ${JSON.stringify(kKeyless)} column ${(await itemOf(k.order.id)).restockedQty}`,
      );

      // 12g. Cancelling puts every unit back but counts nothing on the column: the order is over.
      const cz = await mkOrder({ status: "PAID", qty: 2 });
      const czCancel = await inv.cancelOrder(cz.order.id, { reason: "klant belde", actor: "admin", notifyCustomer: false });
      check(czCancel.ok && czCancel.restocked && (await itemOf(cz.order.id)).restockedQty === 0 && (await cz.stockNow()) === cz.stockStart, "Cancel: the units go back on the shelf, restockedQty stays 0", `Cancel column: ${JSON.stringify(czCancel.ok)} ${(await itemOf(cz.order.id)).restockedQty}`);

      // 12h. The two admin refund forms size their restock inputs from the COLUMN, not from the legacy credit-note
      //      annotation (which no new note carries, so a page reading it offered units the booking then refused). The
      //      pages are server components behind the admin login, so this reads their source: the line the form is built
      //      from must subtract restockedQty of the loaded items, and the legacy reader must be gone from invoicing.ts.
      const { readFileSync } = await import("node:fs");
      const retourenSrc = readFileSync(path.resolve("src/app/admin/retouren/page.tsx"), "utf8");
      const bestellingenSrc = readFileSync(path.resolve("src/app/admin/bestellingen/page.tsx"), "utf8");
      const ordersQuerySrc = readFileSync(path.resolve("src/app/admin/_lib/orders-query.ts"), "utf8");
      check(
        /restockedQty: true/.test(retourenSrc) && /quantity: Math\.max\(0, i\.quantity - i\.restockedQty\)/.test(retourenSrc) && !/restockedFromNotes|linesJson:\s*true/.test(retourenSrc)
          && /restockedOfItems\(o\.items\)/.test(bestellingenSrc) && /quantity: Math\.max\(0, i\.quantity - \(restocked\.get\(i\.partId\) \?\? 0\)\)/.test(bestellingenSrc) && !/restockedFromNotes/.test(bestellingenSrc)
          && !/linesJson:\s*true/.test(ordersQuerySrc) && !("restockedFromNotes" in inv),
        "Admin pages: /admin/retouren and /admin/bestellingen size the restock inputs from OrderItem.restockedQty (retouren selects the column and subtracts it per line; bestellingen sums it with restockedOfItems over the loaded items), neither reads a note's linesJson, and the legacy reader restockedFromNotes no longer exists",
        `Admin pages read the column: retouren ${/i\.restockedQty/.test(retourenSrc)} / ${!/restockedFromNotes/.test(retourenSrc)}, bestellingen ${/restockedOfItems\(o\.items\)/.test(bestellingenSrc)} / ${!/restockedFromNotes/.test(bestellingenSrc)}, orders-query selects linesJson ${/linesJson:\s*true/.test(ordersQuerySrc)}, invoicing exports restockedFromNotes ${"restockedFromNotes" in inv}`,
      );
    }
  } finally {
    await cleanup().catch((e) => console.error("cleanup failed", e));
    await prisma.$disconnect();
    slack.close();
    for (const dir of probeDirs) rmSync(dir, { recursive: true, force: true });
    console.log(log.join("\n"));
    const failures = log.filter((l) => l.startsWith("❌")).length;
    console.log(`\n${log.length - failures}/${log.length} checks passed`);
    if (failures > 0) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
