/**
 * Owner operations: order desk, reconciliation, returns, scheduled jobs, catalogue
 * entry, economics, retention, CLI.
 *
 * Runs against a REAL Postgres (never mocked). A local HTTP server stands in for Slack and
 * another for Resend (via RESEND_BASE_URL), so the owner notices and customer mails the
 * flows really send are captured and inspected; the Stripe client talks to
 * scripts/lib/fake-stripe.ts. The admin server actions and the cron/return route
 * handlers are called as plain functions with real FormData / Request objects.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/qa-admin.ts
 */
import http from "node:http";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const log: string[] = [];
const check = (cond: boolean, ok: string, bad: string) => { const l = cond ? `✅ ${ok}` : `❌ ${bad}`; log.push(l); if (process.env.QA_VERBOSE) console.log(l); };

const DOMAIN = "qa-admin.test";
const SKU_PREFIX = "QA-ADM-";
const ROOT = path.resolve(__dirname, "..");

type Captured = { to: string[]; subject: string; html: string };

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  // ── Stand-ins, before anything that reads the environment is imported ───
  const slackBodies: string[] = [];
  const slack = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { slackBodies.push(body); res.statusCode = 200; res.end("ok"); });
  });
  await new Promise<void>((r) => slack.listen(0, "127.0.0.1", r));
  const mails: Captured[] = [];
  const resendFake = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const m = JSON.parse(body);
        mails.push({ to: Array.isArray(m.to) ? m.to : [m.to], subject: String(m.subject), html: String(m.html ?? "") });
      } catch { /* ignore */ }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `mail_${mails.length}` }));
    });
  });
  await new Promise<void>((r) => resendFake.listen(0, "127.0.0.1", r));

  process.env.SLACK_WEBHOOK_URL = `http://127.0.0.1:${(slack.address() as AddressInfo).port}/hook`;
  delete process.env.DISCORD_WEBHOOK_URL;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_BASE_URL = `http://127.0.0.1:${(resendFake.address() as AddressInfo).port}`;
  process.env.ORDER_NOTIFY_EMAIL = `owner@${DOMAIN}`;
  process.env.CRON_SECRET = "qa-admin-cron-secret-0123456789";
  process.env.DEMO_MODE = "true";
  Object.assign(process.env, {
    COMPANY_NAME: "WasFix Test B.V.", COMPANY_STREET: "Teststraat 1", COMPANY_POSTAL_CODE: "1011 AB", COMPANY_CITY: "Amsterdam",
    COMPANY_KVK: "90000001", COMPANY_VAT: "NL900000010B01", COMPANY_IBAN: "NL02ABNA0123456789",
  });

  const { PrismaClient, Prisma } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const inv = await import("../src/lib/invoicing");
  const st = await import("../src/lib/order-status");
  const csv = await import("../src/lib/export-csv");
  const { startFakeStripe } = await import("./lib/fake-stripe");
  const stripeLib = await import("../src/lib/stripe");
  const q = await import("../src/app/admin/_lib/orders-query");
  const eco = await import("../src/app/admin/_lib/economics");
  const stock = await import("../src/app/admin/_lib/stock");
  const ccsv = await import("../src/app/admin/_lib/catalog-csv");
  const ordAct = await import("../src/app/admin/bestellingen/actions");
  const rmaAct = await import("../src/app/admin/retouren/actions");
  const catAct = await import("../src/app/admin/_lib/catalog-actions");
  const impAct = await import("../src/app/admin/onderdelen/import-actions");
  const retention = await import("../src/lib/retention");
  const { NextRequest } = await import("next/server");
  const retourRoute = await import("../src/app/api/retour/route");
  const fake = await startFakeStripe();
  stripeLib._setStripeForTests(fake.client());

  const fd = (o: Record<string, string | undefined>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) if (v !== undefined) f.set(k, v);
    return f;
  };
  const settle = () => new Promise((r) => setTimeout(r, 200));
  const slackTexts = () => slackBodies.map((b) => String(JSON.parse(b).text));

  const cleanup = async () => {
    const orders = await prisma.order.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { id: true } });
    const ids = orders.map((o) => o.id);
    await prisma.rmaRequest.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await prisma.usageCounter.deleteMany({ where: { OR: [{ scope: "payment-reminder", key: { in: ids.flatMap((i) => [`${i}:due`, `${i}:last`, `${i}:due:fail`, `${i}:last:fail`]) } }, { key: { startsWith: "ip:qa-admin" } }, { scope: "qa-admin" }] } });
    await prisma.creditNote.deleteMany({ where: { invoice: { orderId: { in: ids } } } });
    await prisma.creditNote.deleteMany({ where: { number: { startsWith: "CN-29" } } });
    await prisma.invoice.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { id: { in: ids } } });
    await prisma.diagnosisFeedback.deleteMany({ where: { comment: { startsWith: "qa-admin" } } });
    await prisma.diagnosis.deleteMany({ where: { sessionId: { startsWith: "qa-admin" } } });
    await prisma.diagnosis.deleteMany({ where: { id: { startsWith: "qa-admin" } } });
    await prisma.part.deleteMany({ where: { sku: { startsWith: SKU_PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    const years = await prisma.creditNoteSequence.findMany();
    for (const { year } of years) {
      if (year >= 2900) { await prisma.creditNoteSequence.delete({ where: { year } }); continue; }
      const rows = await prisma.creditNote.findMany({ where: { year }, select: { number: true } });
      const max = rows.reduce((m, r) => Math.max(m, Number(r.number.slice(-5))), 0);
      await prisma.creditNoteSequence.update({ where: { year }, data: { last: max } });
    }
  };

  try {
    await cleanup();

    // ═══ 1. CSV writer and parser ═══════════════════════════════════════════
    {
      const out = csv.toCsv(["a", "b"], [["=1+1", "+cmd"], ["-x", "@y"], [-34.45, 12], ["a;b", 'say "hi"\nnow'], [null, undefined]]);
      check(out.startsWith("﻿") && out.includes("\r\n") && !out.includes("\n\n"), "CSV: UTF-8 BOM, ';' separator and CRLF rows", "CSV: BOM/CRLF missing");
      check(out.includes("'=1+1;'+cmd\r\n") && out.includes("'-x;'@y\r\n"), "CSV injection: text cells starting with = + - @ get an apostrophe", `CSV injection not guarded: ${JSON.stringify(out)}`);
      check(out.includes("\r\n-34,45;12\r\n"), "CSV: numbers are written with a decimal comma and negative numbers are NOT prefixed", `CSV number cell wrong: ${JSON.stringify(out)}`);
      const back = csv.parseCsv(out);
      check(back.header.join() === "a,b" && back.rows[0][0] === "=1+1" && back.rows[3][0] === "a;b" && back.rows[3][1] === 'say "hi"\nnow', "CSV: parse(write(x)) returns the original cells, including quotes and a newline inside a cell", `CSV roundtrip wrong: ${JSON.stringify(back.rows)}`);
      check(csv.parseCsv("a,b\n1,2\n").delimiter === "," && csv.parseCsv("a\tb\n1\t2").delimiter === "\t" && csv.parseCsv("a;b\n1;2").delimiter === ";", "CSV: delimiter is detected (; , tab)", "CSV: delimiter detection wrong");
      const money: Array<[string, number | null]> = [["28,50", 28.5], ["28.50", 28.5], ["1.234,50", 1234.5], ["1,234.50", 1234.5], ["EUR 28,50", 28.5], ["€ 7", 7], ["0,5", 0.5], ["28,555", null], ["1.234", null], ["abc", null], ["", null], ["1,2,3", null], ["-3,00", -3]];
      const bad = money.filter(([s, v]) => csv.parseMoney(s) !== v).map(([s]) => s);
      check(bad.length === 0, `CSV money: ${money.length} notations parse as expected (comma, dot, thousands, EUR prefix; ambiguous and 3-decimal refused)`, `CSV money wrong for: ${bad.join(" | ")}`);
    }

    // ═══ Fixtures ═══════════════════════════════════════════════════════════
    let n = 0;
    const user = await prisma.user.create({ data: { email: `buyer@${DOMAIN}`, name: "QA Buyer" } });
    const mkPart = async (stockN: number, price = 10.15, extra: Record<string, unknown> = {}) =>
      prisma.part.create({ data: { sku: `${SKU_PREFIX}${Date.now()}-${++n}`, name: `QA onderdeel ${n}`, brand: "QA", category: "OTHER", priceEur: price, stock: stockN, ...extra } });
    async function mkOrder(opts: { status: string; method?: "STRIPE" | "BANK_TRANSFER"; qty?: number; price?: number; invoice?: boolean; stock?: number; shipping?: number; discount?: number; dueInDays?: number; email?: string; name?: string; partExtra?: Record<string, unknown>; createdAt?: Date; pi?: string }) {
      const qty = opts.qty ?? 3;
      const part = await mkPart(opts.stock ?? 50, opts.price ?? 10.15, opts.partExtra);
      const goods = inv.money(part.priceEur * qty);
      const shipping = opts.shipping ?? 0;
      const discount = opts.discount ?? 0;
      const total = inv.money(goods - discount + shipping);
      const vat = inv.splitVatInclusive(total);
      const method = opts.method ?? (opts.status === "OPENSTAAND" ? "BANK_TRANSFER" : "STRIPE");
      const order = await prisma.order.create({
        data: {
          userId: user.id,
          email: opts.email ?? `buyer${++n}@${DOMAIN}`,
          status: opts.status,
          paymentMethod: method,
          subtotalEur: goods, discountEur: discount, shippingEur: shipping, totalEur: total, vatRate: vat.vatRate, vatEur: vat.vatEur,
          accessToken: inv.newAccessToken(),
          shippingAddress: JSON.stringify({ name: opts.name ?? "Piet Jansen", street: "Teststraat", houseNumber: "1", postalCode: "1011 AB", city: "Amsterdam" }),
          phone: "0612345678",
          customerNote: "Bel aan bij de buren",
          paidAt: ["PAID", "SHIPPED", "DELIVERED"].includes(opts.status) ? new Date() : null,
          dueAt: opts.dueInDays !== undefined ? new Date(Date.now() + opts.dueInDays * 86_400_000) : method === "BANK_TRANSFER" ? new Date(Date.now() + 14 * 86_400_000) : null,
          stripePaymentIntentId: opts.pi ?? null,
          ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
          items: { create: [{ partId: part.id, quantity: qty, unitPrice: part.priceEur }] },
        },
      });
      if (st.holdsStock(opts.status)) await prisma.part.update({ where: { id: part.id }, data: { stock: { decrement: qty } } });
      if (opts.invoice ?? opts.status !== "PENDING") await inv.issueInvoiceForOrder(order.id);
      const stockNow = async () => (await prisma.part.findUniqueOrThrow({ where: { id: part.id } })).stock;
      return { order, part, qty, total, stockStart: opts.stock ?? 50, stockNow };
    }
    const row = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
    const invoiceOf = (id: string) => prisma.invoice.findUniqueOrThrow({ where: { orderId: id } });

    // ═══ 2. A2-04: the paid order that disappeared after 100 orders ═════════
    {
      const user2 = user.id;
      const base = {
        userId: user2, subtotalEur: 10, discountEur: 0, shippingEur: 0, totalEur: 10, vatRate: 0.21, vatEur: 1.74, shippingAddress: "{}", paymentMethod: "STRIPE",
      };
      const now = Date.now();
      await prisma.order.createMany({
        data: Array.from({ length: 101 }, (_, i) => ({ ...base, email: `done${i}@${DOMAIN}`, status: "DELIVERED", createdAt: new Date(now - (i + 5) * 60_000) })),
      });
      const target = await mkOrder({ status: "PAID", qty: 1 });
      // The page's query as it was (verbatim from the old page.tsx):
      const oldList = await prisma.order.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 100 });
      check(!oldList.some((o) => o.id === target.order.id), "BEFORE (old query, verbatim): with 101 delivered orders the PAID order that must be shipped is NOT in the 100 rows the page renders", "Repro of A2-04 failed: the old query still returned the paid order (not enough delivered orders in the database?)");
      const ship = await q.listOrders({ view: "te-verzenden" });
      check(ship.rows.some((o) => o.id === target.order.id), "AFTER: the 'te verzenden' view lists that paid order", "AFTER: the paid order is missing from the te-verzenden view");
      const counts = await q.orderCounts();
      const [paidN, deliveredN] = await Promise.all([prisma.order.count({ where: { status: "PAID" } }), prisma.order.count({ where: { status: "DELIVERED" } })]);
      check(counts["te-verzenden"] === paidN && counts.afgerond === deliveredN && deliveredN >= 101, `Counts: te verzenden ${counts["te-verzenden"]} and afgerond ${counts.afgerond} come from the database, not from the visible rows`, `Counts wrong: ${JSON.stringify(counts)}`);
      const p1 = await q.listOrders({ view: "afgerond", page: 1 });
      const last = await q.listOrders({ view: "afgerond", page: p1.pages });
      const p2 = await q.listOrders({ view: "afgerond", page: 2 });
      check(p1.rows.length === 25 && p1.pages === Math.ceil(deliveredN / 25) && last.rows.length > 0 && !p2.rows.some((r) => p1.rows.some((x) => x.id === r.id)), `Pagination: ${deliveredN} delivered orders in ${p1.pages} pages of 25, the last page is reachable and pages do not overlap`, `Pagination wrong: ${p1.rows.length} rows, ${p1.pages} pages`);
      const all = await q.listOrders({ view: "alles" });
      check(all.total === counts.alles, "Alles view: total equals the number of orders", `Alles total ${all.total} vs ${counts.alles}`);
      check(ship.rows.every((o) => o.status === "PAID"), "Te verzenden view contains only PAID orders", "Te verzenden view contains other statuses");
      // Reviewer: ?page=<huge> and a NUL byte in ?q= answered 500 (skip beyond 64 bits; Postgres 22021).
      let hostileErr = "";
      let beyond: Awaited<ReturnType<typeof q.listOrders>> | null = null;
      try {
        await q.listOrders({ view: "alles", page: 99999999999999999999 });
        await q.listOrders({ view: "alles", page: Number.NaN });
        await q.listOrders({ view: "alles", q: "ab\u0000cd" });
        beyond = await q.listOrders({ view: "afgerond", page: 1_000_000 });
      } catch (err) { hostileErr = String(err).slice(0, 200); }
      check(hostileErr === "" && beyond !== null && beyond.page === beyond.pages && beyond.rows.length > 0, `Order desk survives ?page=1e20, NaN and a NUL byte in the search; a page beyond the last shows the last page (${beyond?.page}/${beyond?.pages})`, `Hostile order-desk input: ${hostileErr || JSON.stringify(beyond && { page: beyond.page, pages: beyond.pages })}`);
      // FIFO: oldest paid order first.
      const old = await mkOrder({ status: "PAID", qty: 1, createdAt: new Date(now - 30 * 86_400_000) });
      const ship2 = await q.listOrders({ view: "te-verzenden" });
      check(ship2.rows.findIndex((o) => o.id === old.order.id) < ship2.rows.findIndex((o) => o.id === target.order.id), "Te verzenden: oldest paid order first", "Te verzenden order is not oldest-first");
      await prisma.order.deleteMany({ where: { email: { startsWith: "done" }, AND: { email: { endsWith: `@${DOMAIN}` } } } });
    }

    // ═══ 3. Reconciliation: the bank statement line ═════════════════════════
    {
      const a = await mkOrder({ status: "OPENSTAAND", qty: 1, price: 34.45, email: `jansen@${DOMAIN}`, name: "J. Jansen" });
      const b = await mkOrder({ status: "OPENSTAAND", qty: 1, price: 34.45, email: `pietersen@${DOMAIN}`, name: "K. Pietersen" });
      const c = await mkOrder({ status: "OPENSTAAND", qty: 1, price: 12.1, email: `devries@${DOMAIN}`, name: "M. de Vries" });
      const invA = await invoiceOf(a.order.id);
      const invB = await invoiceOf(b.order.id);
      const line = `${invA.number} EUR 34,45`;
      const one = await q.listOrders({ q: line });
      check(one.mode === "search" && one.total === 1 && one.rows[0].id === a.order.id, `Bank line "${line}": ONE search finds exactly the order (two open invoices have the same amount 34,45)`, `Bank line search gave ${one.total} rows, mode ${one.mode}`);
      const byAmount = await q.listOrders({ q: "34,45" });
      check(byAmount.total >= 2 && [a, b].every((x) => byAmount.rows.some((r) => r.id === x.order.id)), "Search by amount alone lists every order with that total", `Amount search gave ${byAmount.total}`);
      const wrongAmount = await q.listOrders({ q: `${invA.number} EUR 30,00` });
      check(wrongAmount.mode === "search-loose" && wrongAmount.rows.some((r) => r.id === a.order.id), "A short payment (right reference, wrong amount) is still shown, as a loose match, not as 'nothing found'", `Wrong-amount search: mode ${wrongAmount.mode}, rows ${wrongAmount.total}`);
      const bySuffix = await q.listOrders({ q: st.orderRef(b.order.id) });
      const byEmail = await q.listOrders({ q: `DEVRIES@${DOMAIN}` });
      const byName = await q.listOrders({ q: "pietersen" });
      check(bySuffix.rows.some((r) => r.id === b.order.id) && byEmail.rows.some((r) => r.id === c.order.id) && byName.rows.some((r) => r.id === b.order.id), "Search: order number (#REF), e-mail (any case) and name all find the order", "Search by ref/e-mail/name failed");
      await prisma.order.update({ where: { id: a.order.id }, data: { status: "SHIPPED", trackingCode: "3SQAADM123456" } });
      const byTrack = await q.listOrders({ q: "3sqaadm1234" });
      check(byTrack.rows.some((r) => r.id === a.order.id), "Search: tracking code (partial, any case) across all statuses", "Tracking search failed");
      await prisma.order.update({ where: { id: a.order.id }, data: { status: "OPENSTAAND", trackingCode: null } });
      // Open invoices by due date, overdue first.
      await prisma.order.update({ where: { id: c.order.id }, data: { dueAt: new Date(Date.now() - 3 * 86_400_000) } });
      await prisma.order.update({ where: { id: b.order.id }, data: { dueAt: new Date(Date.now() + 2 * 86_400_000) } });
      const open = await q.listOrders({ view: "te-betalen" });
      const dues = open.rows.map((r) => r.dueAt?.getTime() ?? Infinity);
      check(dues.every((d, i) => i === 0 || dues[i - 1] <= d) && open.rows[0].dueAt !== null && open.rows[0].dueAt.getTime() < Date.now(), "Te betalen: sorted by due date, the overdue invoice leads", `Te betalen order wrong: ${dues}`);
      const cnt = await q.orderCounts();
      check(cnt.overdue >= 1, `Overdue count (${cnt.overdue}) includes the invoice that is 3 days late`, "Overdue count is 0");

      // markPaidAction: the amount is REQUIRED and must equal the total.
      let r = await ordAct.markPaidAction(null, fd({ orderId: a.order.id }));
      check(!r.ok && /bedrag/i.test(r.error ?? "") && (await row(a.order.id)).status === "OPENSTAAND", "Mark paid without an amount: refused with a message, nothing changed (no one-click)", `Mark paid without amount: ${JSON.stringify(r)}`);
      r = await ordAct.markPaidAction(null, fd({ orderId: a.order.id, received: "34,44" }));
      check(!r.ok && /34[.,]44/.test(r.error ?? "") && /34[.,]45/.test(r.error ?? "") && (await row(a.order.id)).status === "OPENSTAAND", `Mark paid with one cent too little: the domain error is shown ("${r.error}") and nothing changed`, `Mark paid 34,44: ${JSON.stringify(r)}`);
      r = await ordAct.markPaidAction(null, fd({ orderId: a.order.id, received: "tweeëndertig" }));
      check(!r.ok && (await row(a.order.id)).status === "OPENSTAAND", "Mark paid with a non-number: refused", `Mark paid garbage: ${JSON.stringify(r)}`);
      mails.length = 0;
      const stockBefore = await a.stockNow();
      r = await ordAct.markPaidAction(null, fd({ orderId: a.order.id, received: "34,45" }));
      await settle();
      check(r.ok && (await row(a.order.id)).status === "PAID" && (await row(a.order.id)).paidAt !== null && (await a.stockNow()) === stockBefore, `Mark paid with the exact amount: PAID, no second stock movement ("${r.message}")`, `Mark paid 34,45: ${JSON.stringify(r)}`);
      check(mails.some((m) => m.to.includes((a.order.email)) && /betaling/i.test(m.subject)), "Mark paid: the customer got the 'betaling ontvangen' mail", `Mark paid: no customer mail, got ${mails.map((m) => m.subject)}`);
      const again = await Promise.all([ordAct.markPaidAction(null, fd({ orderId: a.order.id, received: "34,45" })), ordAct.markPaidAction(null, fd({ orderId: a.order.id, received: "34,45" }))]);
      check(again.every((x) => x.ok) && (await a.stockNow()) === stockBefore, "Mark paid twice at once (double click): still PAID once, stock unchanged", `Double mark paid: ${JSON.stringify(again)}`);

      // Late wire on a cancelled order WITHOUT a credit note is booked; with one, it is not revived.
      const late = await mkOrder({ status: "OPENSTAAND", qty: 2, price: 10, email: `late@${DOMAIN}` });
      await inv.cancelOrder(late.order.id, { reason: "te laat", actor: "system" });
      const lr = await ordAct.markPaidAction(null, fd({ orderId: late.order.id, received: "20,00" }));
      check(!lr.ok && (await row(late.order.id)).status === "CANCELLED", "Late wire on a cancelled order whose invoice was credited: NOT revived (D4), the owner is told", `Late wire: ${JSON.stringify(lr)}`);
    }

    // ═══ 4. Order desk actions: ship, deliver, cancel, refund ═══════════════
    {
      // Ship
      const o = await mkOrder({ status: "PAID", qty: 2 });
      mails.length = 0;
      let r = await ordAct.markShippedAction(null, fd({ orderId: o.order.id, carrier: "POSTNL" }));
      check(!r.ok && (await row(o.order.id)).status === "PAID", "Ship without a tracking code: refused", `Ship without code: ${JSON.stringify(r)}`);
      r = await ordAct.markShippedAction(null, fd({ orderId: o.order.id, carrier: "OTHER", trackingCode: "ABC12345" }));
      check(!r.ok && (await row(o.order.id)).status === "PAID", "Ship with 'andere vervoerder' but no name: refused", `Ship OTHER without name: ${JSON.stringify(r)}`);
      r = await ordAct.markShippedAction(null, fd({ orderId: o.order.id, carrier: "FEDEX3", trackingCode: "ABC12345" }));
      check(!r.ok, "Ship with an unknown carrier value: refused by the schema", `Ship unknown carrier: ${JSON.stringify(r)}`);
      const [s1, s2] = await Promise.all([
        ordAct.markShippedAction(null, fd({ orderId: o.order.id, carrier: "POSTNL", trackingCode: "3SQAADM0001" })),
        ordAct.markShippedAction(null, fd({ orderId: o.order.id, carrier: "POSTNL", trackingCode: "3SQAADM0001" })),
      ]);
      await settle();
      const shipped = await row(o.order.id);
      const shipMails = mails.filter((m) => m.to.includes(o.order.email) && /verzonden|onderweg/i.test(m.subject));
      check(s1.ok && s2.ok && shipped.status === "SHIPPED" && shipped.trackingCode === "3SQAADM0001" && shipped.carrier === "POSTNL" && shipped.shippedAt !== null && shipMails.length === 1, "Ship double click: SHIPPED once with carrier and tracking code, exactly ONE customer mail", `Ship double click: ${JSON.stringify([s1, s2])} status ${shipped.status}, mails ${shipMails.length}`);
      check(shipMails[0]?.html.includes("3SQAADM0001") === true, "Shipped mail carries the tracking code", "Shipped mail lacks the tracking code");
      // Cancel is refused once shipped
      const c = await ordAct.cancelOrderAction(null, fd({ orderId: o.order.id, reason: "toch niet", confirm: "on" }));
      check(!c.ok && (await row(o.order.id)).status === "SHIPPED", `Cancel on a SHIPPED order: refused ("${c.error}")`, `Cancel shipped: ${JSON.stringify(c)}`);
      const d1 = await ordAct.markDeliveredAction(null, fd({ orderId: o.order.id }));
      const d2 = await ordAct.markDeliveredAction(null, fd({ orderId: o.order.id }));
      check(d1.ok && d2.ok && (await row(o.order.id)).status === "DELIVERED" && (await row(o.order.id)).deliveredAt !== null, "Deliver: DELIVERED with deliveredAt; repeating it is harmless", `Deliver: ${JSON.stringify([d1, d2])}`);
      const dp = await mkOrder({ status: "PAID" });
      const dr = await ordAct.markDeliveredAction(null, fd({ orderId: dp.order.id }));
      check(!dr.ok && (await row(dp.order.id)).status === "PAID", "Deliver on an order that was never shipped: refused", `Deliver PAID: ${JSON.stringify(dr)}`);
      const bad = await ordAct.markShippedAction(null, fd({ orderId: "x'; DROP TABLE \"Order\";--", carrier: "DHL", trackingCode: "ABCDEF123" }));
      check(!bad.ok, "Ship with a hostile order id: refused by validation", `Hostile id: ${JSON.stringify(bad)}`);
    }
    {
      // Cancel: bank-transfer unpaid
      const o = await mkOrder({ status: "OPENSTAAND", qty: 2 });
      const before = await o.stockNow();
      let r = await ordAct.cancelOrderAction(null, fd({ orderId: o.order.id, reason: "klant belde" }));
      check(!r.ok && (await row(o.order.id)).status === "OPENSTAAND", "Cancel without the confirmation tick: refused", `Cancel w/o confirm: ${JSON.stringify(r)}`);
      mails.length = 0;
      r = await ordAct.cancelOrderAction(null, fd({ orderId: o.order.id, reason: "klant belde", confirm: "on" }));
      await settle();
      const notes = await inv.getCreditNotesForOrder(o.order.id);
      check(r.ok && (await row(o.order.id)).status === "CANCELLED" && (await o.stockNow()) === before + o.qty && notes.length === 1 && /CN-/.test(r.message ?? ""), `Cancel OPENSTAAND: restocked, credit note issued and named in the result ("${r.message}")`, `Cancel OPENSTAAND: ${JSON.stringify(r)}`);
      check(mails.some((m) => m.to.includes(o.order.email) && /geannuleerd/i.test(m.subject)), "Cancel: the customer was mailed", "Cancel: no customer mail");
      const r2 = await ordAct.cancelOrderAction(null, fd({ orderId: o.order.id, reason: "klant belde", confirm: "on" }));
      check(r2.ok && /al geannuleerd/.test(r2.message ?? "") && (await o.stockNow()) === before + o.qty && (await inv.getCreditNotesForOrder(o.order.id)).length === 1, "Cancel twice: second call changes nothing (no second restock or note)", `Cancel twice: ${JSON.stringify(r2)}`);
    }
    {
      // Cancel a PAID Stripe order: refund through Stripe FIRST, then cancel with the refund id.
      const o = await mkOrder({ status: "PAID", qty: 2, price: 20, method: "STRIPE", pi: "pi_qa_cancel_1" });
      const before = await o.stockNow();
      fake.state.refunds.length = 0;
      const [a, b] = await Promise.all([
        ordAct.cancelOrderAction(null, fd({ orderId: o.order.id, reason: "kapot bij ons", confirm: "on" })),
        ordAct.cancelOrderAction(null, fd({ orderId: o.order.id, reason: "kapot bij ons", confirm: "on" })),
      ]);
      const reqs = fake.requestsTo("POST", "/v1/refunds");
      const notes = await inv.getCreditNotesForOrder(o.order.id);
      check(
        a.ok && b.ok && reqs.length >= 1 && reqs.every((r) => r.idempotencyKey === `cancel-${o.order.id}` && r.body.payment_intent === "pi_qa_cancel_1" && r.body.amount === "4000") && fake.state.refunds.length === 1 && notes.length === 1 && notes[0].stripeRefundId === fake.state.refunds[0].id && (await o.stockNow()) === before + o.qty && (await row(o.order.id)).refundedEur === 40,
        `Cancel PAID Stripe order x2 at once: ONE Stripe refund of 40,00 on the payment intent (idempotency key per order), credit note carries ${notes[0]?.stripeRefundId}, stock back`,
        `Cancel PAID Stripe: ${JSON.stringify([a, b])}, refunds ${fake.state.refunds.length}, requests ${reqs.length}, notes ${notes.length}`,
      );
      // Stripe refuses: the order is NOT cancelled.
      const o2 = await mkOrder({ status: "PAID", qty: 1, price: 20, method: "STRIPE", pi: "pi_qa_cancel_2" });
      // One failing answer = one failed refund call (measured: the client does not retry this 500).
      fake.fail("POST", "/v1/refunds", 500, 1);
      const f = await ordAct.cancelOrderAction(null, fd({ orderId: o2.order.id, reason: "reden x", confirm: "on" }));
      check(!f.ok && /niet geannuleerd/.test(f.error ?? "") && (await row(o2.order.id)).status === "PAID" && (await inv.getCreditNotesForOrder(o2.order.id)).length === 0, `Stripe refund fails: the order stays PAID and untouched ("${f.error}")`, `Stripe failure: ${JSON.stringify(f)}`);
      // Bank-transfer paid order: no Stripe call, owner told to wire the money.
      const o3 = await mkOrder({ status: "PAID", qty: 1, price: 20, method: "BANK_TRANSFER" });
      const calls = fake.requestsTo("POST", "/v1/refunds").length;
      const bt = await ordAct.cancelOrderAction(null, fd({ orderId: o3.order.id, reason: "reden x", confirm: "on" }));
      check(bt.ok && fake.requestsTo("POST", "/v1/refunds").length === calls && /per bank terug/.test(bt.message ?? ""), `Cancel PAID bank-transfer order: no Stripe call, the message tells the owner to wire it back ("${bt.message}")`, `Cancel bank PAID: ${JSON.stringify(bt)}`);
    }
    {
      // Refund (record): Stripe order, partial, idempotent, conflict, restock
      const o = await mkOrder({ status: "DELIVERED", qty: 2, price: 20, method: "STRIPE", pi: "pi_qa_refund_1" });
      const before = await o.stockNow();
      fake.state.refunds.length = 0;
      const key = "qa-key-0001-abcd";
      const form = () => fd({ orderId: o.order.id, amount: "15,00", reason: "krasje", idempotencyKey: key, expectedRefundedEur: "0", [`restock_${o.part.id}`]: "1" });
      const [a, b] = await Promise.all([ordAct.recordRefundAction(null, form()), ordAct.recordRefundAction(null, form())]);
      const notes = await inv.getCreditNotesForOrder(o.order.id);
      const r1 = await row(o.order.id);
      check(a.ok && fake.state.refunds.length === 1 && notes.length === 1 && r1.refundedEur === 15 && (await o.stockNow()) === before + 1 && fake.state.refunds[0].amount === 1500, `Refund double submit (same form key): ONE Stripe refund, ONE credit note ${notes[0]?.number}, refundedEur 15, 1 unit restocked`, `Refund double submit: ${JSON.stringify([a, b])}, refunds ${fake.state.refunds.length}, notes ${notes.length}, refunded ${r1.refundedEur}`);
      const stale = await ordAct.recordRefundAction(null, fd({ orderId: o.order.id, amount: "5,00", reason: "nog iets", idempotencyKey: "qa-key-0002-abcd", expectedRefundedEur: "0" }));
      check(!stale.ok && /ververs/i.test(stale.error ?? "") && (await inv.getCreditNotesForOrder(o.order.id)).length === 1, `Refund with a stale page (expectedRefundedEur 0 but 15 booked): refused with 'ververs de pagina' ("${stale.error}")`, `Stale refund: ${JSON.stringify(stale)}`);
      check(fake.state.refunds.length === 1, `Stale tab: Stripe was NOT called (${fake.state.refunds.length} refund at Stripe, expected 1; before the fix the stale submit refunded 5,00 at Stripe and the books refused it)`, `Stale tab: ${fake.state.refunds.length} refunds at Stripe but 1 credit note: money moved that nobody booked or was told about`);
      const replayStale = await ordAct.recordRefundAction(null, form());
      check(replayStale.ok && /al geboekt/.test(replayStale.message ?? "") && fake.state.refunds.length === 1 && (await inv.getCreditNotesForOrder(o.order.id)).length === 1 && (await o.stockNow()) === before + 1, "Re-submitting the FIRST form after it was booked (its expectedRefundedEur is now stale): answered as a replay, no second Stripe refund, no second credit note, stock restocked once", `Replay of a booked refund: ${JSON.stringify(replayStale)} refunds ${fake.state.refunds.length}`);
      const tooMuch = await ordAct.recordRefundAction(null, fd({ orderId: o.order.id, amount: "999,00", reason: "veel", idempotencyKey: "qa-key-0003-abcd", expectedRefundedEur: "15" }));
      check(!tooMuch.ok && (await row(o.order.id)).refundedEur === 15 && fake.state.refunds.length === 1, "Refund above what is left: refused BEFORE Stripe is called (before: Stripe was asked for 999,00 and the books then refused it)", `Refund too much: ${JSON.stringify(tooMuch)} refunds at Stripe ${fake.state.refunds.length}`);
      const cancelledPaid = await mkOrder({ status: "CANCELLED", qty: 1, price: 20, method: "STRIPE", pi: "pi_qa_cancelled_1", invoice: false });
      const onCancelled = await ordAct.recordRefundAction(null, fd({ orderId: cancelledPaid.order.id, amount: "5,00", reason: "te laat", idempotencyKey: "qa-key-cancelled-1", expectedRefundedEur: "0" }));
      check(!onCancelled.ok && fake.state.refunds.length === 1, "Refund on a cancelled order: refused before Stripe is called", `Refund on cancelled: ${JSON.stringify(onCancelled)} refunds ${fake.state.refunds.length}`);
      const refreshedForm = await ordAct.recordRefundAction(null, fd({ orderId: o.order.id, amount: "5,00", reason: "nog iets", idempotencyKey: "qa-key-0004-abcd", expectedRefundedEur: "15" }));
      check(refreshedForm.ok && fake.state.refunds.length === 2 && fake.state.refunds[1].amount === 500 && (await inv.getCreditNotesForOrder(o.order.id)).length === 2 && (await row(o.order.id)).refundedEur === 20, "After refreshing the page (right expectedRefundedEur, new key) the second refund goes through: Stripe 15 + 5, books 15 + 5", `Refresh and retry: ${JSON.stringify(refreshedForm)} refunds ${fake.state.refunds.length}`);
      // The window the pre-check cannot close: another refund commits AFTER the check, while Stripe is being called.
      const orr = await mkOrder({ status: "DELIVERED", qty: 2, price: 20, method: "STRIPE", pi: "pi_qa_race_1" });
      let fired = false;
      fake.hook("POST", "/v1/refunds", async () => {
        if (fired) return;
        fired = true;
        await inv.recordRefund(orr.order.id, { amountEur: 3, idempotencyKey: "qa-race-competitor", notifyCustomer: false });
      });
      const slackFrom = slackBodies.length;
      const raced = await ordAct.recordRefundAction(null, fd({ orderId: orr.order.id, amount: "5,00", reason: "race", idempotencyKey: "qa-key-race-0001", expectedRefundedEur: "0" }));
      await settle();
      const raceRefund = fake.state.refunds[fake.state.refunds.length - 1];
      const raceTexts = slackBodies.slice(slackFrom).map((b) => String(JSON.parse(b).text));
      check(fired && !raced.ok && (raced.error ?? "").includes(raceRefund.id) && /NIET opnieuw/.test(raced.error ?? "") && !/niets teruggestort/.test(raced.error ?? "") && raceTexts.some((t) => /niet geboekt/.test(t) && t.includes(raceRefund.id)) && raceTexts.every((t) => !/@qa-admin\.test/.test(t)), `Money moved at Stripe, then the books refused (concurrent refund): the admin is told the Stripe refund id and not to retry, and the owner is notified ("${raced.error?.slice(0, 80)}...")`, `Post-Stripe conflict: ${JSON.stringify(raced)} owner ${JSON.stringify(raceTexts)}`);
      // Bank-transfer order refund: no Stripe, credit note, idempotent on key
      const ob = await mkOrder({ status: "DELIVERED", qty: 1, price: 30, method: "BANK_TRANSFER" });
      const calls = fake.requestsTo("POST", "/v1/refunds").length;
      const bf = () => fd({ orderId: ob.order.id, amount: "10,00", reason: "coulance", idempotencyKey: "qa-key-bank-0001", expectedRefundedEur: "0" });
      const bank1 = await ordAct.recordRefundAction(null, bf());
      const bank2 = await ordAct.recordRefundAction(null, bf());
      check(bank1.ok && bank2.ok && fake.requestsTo("POST", "/v1/refunds").length === calls && (await inv.getCreditNotesForOrder(ob.order.id)).length === 1 && (await row(ob.order.id)).refundedEur === 10 && /per bank terug/.test(bank1.message ?? ""), "Refund on a bank-transfer order: credit note only, no Stripe call, a double submit books ONE note, the owner is told to wire it", `Bank refund: ${JSON.stringify([bank1, bank2])}`);
    }
    await settle();
    check(slackTexts().every((t) => !/@qa-admin\.test/.test(t) && !/Jansen|Pietersen|Teststraat/.test(t)), "Owner notices carry no customer e-mail, name or address", `PII in an owner notice: ${slackTexts().find((t) => /@qa-admin\.test|Jansen|Teststraat/.test(t))}`);

    // ═══ 5. Returns: intake (A2-06) and handling (A2-07) ════════════════════
    {
      const o = await mkOrder({ status: "DELIVERED", qty: 2, price: 20, method: "BANK_TRANSFER", email: `retour@${DOMAIN}` });
      await prisma.order.update({ where: { id: o.order.id }, data: { deliveredAt: new Date(Date.now() - 5 * 86_400_000) } });
      const ref = st.orderRef(o.order.id);
      let ip = 0;
      const post = async (body: unknown) => {
        const res = await retourRoute.POST(new NextRequest("http://localhost/api/retour", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": `10.0.0.${++ip}` }, body: JSON.stringify(body) }));
        return { status: res.status, json: (await res.json()) as { rmaNumber?: string; message?: string; error?: string } };
      };
      const good = { name: "Piet Jansen", reason: "DEFECT", notes: "Het onderdeel is kapot aangekomen." };

      const ghost = await post({ ...good, orderId: "WF-2026-001234", email: `nobody@${DOMAIN}` });
      const ghostRow = await prisma.rmaRequest.findUnique({ where: { rmaNumber: ghost.json.rmaNumber ?? "" } });
      check(ghost.status === 200 && ghostRow !== null && ghostRow.linkedOrderId === null, "BEFORE/AFTER A2-06: a made-up order number (the old placeholder WF-2026-001234) is still accepted, but stored as NOT linked", `Ghost RMA: ${ghost.status} linked ${ghostRow?.linkedOrderId}`);
      const okLinked = await post({ ...good, orderId: `#${ref}`, email: `RETOUR@${DOMAIN.toUpperCase()}` });
      const linkedRow = await prisma.rmaRequest.findUniqueOrThrow({ where: { rmaNumber: okLinked.json.rmaNumber ?? "" } });
      check(okLinked.status === 200 && linkedRow.linkedOrderId === o.order.id, `Return with the short order number (#${ref}) and the order's e-mail in another case: linked to the order`, `Linked RMA: ${okLinked.status} ${linkedRow.linkedOrderId}`);
      const invNo = (await invoiceOf(o.order.id)).number;
      const byInvoice = await post({ ...good, orderId: invNo, email: `retour@${DOMAIN}`, notes: "Tweede aanvraag, andere tekst hier." });
      const invRow = await prisma.rmaRequest.findUniqueOrThrow({ where: { rmaNumber: byInvoice.json.rmaNumber ?? "" } });
      check(invRow.linkedOrderId === o.order.id, `Return by invoice number (${invNo}) is linked too`, `Invoice-number RMA linked ${invRow.linkedOrderId}`);
      const stranger = await post({ ...good, orderId: ref, email: `stranger@${DOMAIN}`, notes: "Ik ken het nummer maar niet het adres." });
      const strRow = await prisma.rmaRequest.findUniqueOrThrow({ where: { rmaNumber: stranger.json.rmaNumber ?? "" } });
      check(stranger.status === 200 && strRow.linkedOrderId === null && stranger.json.message === okLinked.json.message, "A real order number with someone else's e-mail: same answer as a link, but NOT linked (no proof it is theirs; no oracle for order numbers)", `Stranger: ${stranger.status} linked ${strRow.linkedOrderId}`);
      const token = (await row(o.order.id)).accessToken;
      const viaToken = await post({ ...good, orderId: o.order.id, email: `other@${DOMAIN}`, token, notes: "Via de link in de e-mail." });
      const tokRow = await prisma.rmaRequest.findUniqueOrThrow({ where: { rmaNumber: viaToken.json.rmaNumber ?? "" } });
      check(tokRow.linkedOrderId === o.order.id, "The order link's access token proves the order: linked even with a different typed e-mail", `Token RMA linked ${tokRow.linkedOrderId}`);
      const wrongToken = await post({ ...good, orderId: o.order.id, email: `other2@${DOMAIN}`, token: "0".repeat(48), notes: "Verkeerde token hier." });
      const wtRow = await prisma.rmaRequest.findUniqueOrThrow({ where: { rmaNumber: wrongToken.json.rmaNumber ?? "" } });
      check(wtRow.linkedOrderId === null, "A wrong token does not link", `Wrong token linked ${wtRow.linkedOrderId}`);
      const dup = await post({ ...good, orderId: `#${ref}`, email: `retour@${DOMAIN}` });
      check(dup.json.rmaNumber === okLinked.json.rmaNumber && (await prisma.rmaRequest.count({ where: { email: `retour@${DOMAIN}`, orderId: `#${ref}` } })) === 1, "Double submit: the same RMA number comes back, one row", `Duplicate RMA: ${dup.json.rmaNumber} vs ${okLinked.json.rmaNumber}`);
      const invalid = await post({ orderId: "x", name: "P", email: "nope", reason: "HACK", notes: "kort" });
      const empty = await post({});
      check(invalid.status === 400 && empty.status === 400, "Intake is validated with zod: bad email/reason/short notes and an empty body are 400", `Validation: ${invalid.status} / ${empty.status}`);
      await settle();
      const rmaNotices = slackTexts().filter((t) => /retour-aanvraag/i.test(t));
      check(rmaNotices.length >= 3 && rmaNotices.some((t) => /NIET gekoppeld/.test(t)) && rmaNotices.some((t) => new RegExp(`#${ref}`).test(t)) && rmaNotices.every((t) => !/@|Jansen|kapot/.test(t)), `Owner is notified of each return (${rmaNotices.length} notices), the unlinked ones flagged, with no name/e-mail/notes`, `RMA notices: ${JSON.stringify(rmaNotices)}`);
      check(mails.some((m) => m.to.includes(`retour@${DOMAIN}`) && /Retour-aanvraag ontvangen/.test(m.subject) && !/24 uur|verzendlabel/i.test(m.html)), "Customer acknowledgement is sent and no longer promises a label or an answer within 24 hours", "RMA acknowledgement missing or still contains the 24-hour/label promise");
      const ackTo = mails.filter((m) => /Retour-aanvraag ontvangen/.test(m.subject)).flatMap((m) => m.to);
      check(ackTo.length >= 1 && ackTo.every((a) => a === `retour@${DOMAIN}`), `Acknowledgement mails go only to the e-mail of an order the request proved (to: ${[...new Set(ackTo)].join(", ")}); an invented order number, a stranger's e-mail and an e-mail typed next to a valid token get none`, `Acknowledgement sent to an address that proved nothing: ${[...new Set(ackTo)]}`);

      // A DIFFERENT return for the same order and e-mail must be stored, not answered with the first RMA number.
      const o5 = await mkOrder({ status: "DELIVERED", qty: 1, price: 20, email: `multi@${DOMAIN}` });
      const ref5 = st.orderRef(o5.order.id);
      const partA = { name: "Piet Jansen", reason: "DEFECT", notes: "Onderdeel A is kapot aangekomen." };
      const partB = { name: "Piet Jansen", reason: "WRONG_PART", notes: "Onderdeel B is het verkeerde model." };
      const m1 = await post({ ...partA, orderId: ref5, email: `multi@${DOMAIN}` });
      const m2 = await post({ ...partB, orderId: ref5, email: `multi@${DOMAIN}` });
      const m1again = await post({ ...partA, orderId: ref5, email: `multi@${DOMAIN}` });
      const multiRows = await prisma.rmaRequest.findMany({ where: { email: `multi@${DOMAIN}` }, orderBy: { createdAt: "asc" } });
      check(m1.json.rmaNumber !== m2.json.rmaNumber && multiRows.length === 2 && multiRows[1].reason === "WRONG_PART" && multiRows[1].notes === partB.notes && m1again.json.rmaNumber === m1.json.rmaNumber, "BEFORE/AFTER reviewer: a second, different return for the same order is STORED with its own RMA number (before: answered 'ontvangen' and dropped); only the identical resend is de-duplicated", `Second return: ${m1.json.rmaNumber} / ${m2.json.rmaNumber} / ${m1again.json.rmaNumber}, ${multiRows.length} rows`);
      // Database-backed caps (the in-memory per-IP limit does not survive several server instances).
      for (let i = 0; i < 3; i++) await post({ ...partA, orderId: ref5, email: `multi@${DOMAIN}`, notes: `Nog een aanvraag, nummer ${i}, met eigen tekst.` });
      const capped = await post({ ...partA, orderId: ref5, email: `multi@${DOMAIN}`, notes: "Zesde aanvraag van vandaag, andere tekst." });
      check(capped.status === 429 && (await prisma.rmaRequest.count({ where: { email: `multi@${DOMAIN}` } })) === 5, "More than 5 requests per e-mail address per day are refused with 429 (a DB count, so it holds across server instances)", `Per-email cap: ${capped.status}`);
      const hourAgo = new Date(Date.now() - 3_600_000);
      const unlinkedBefore = await prisma.rmaRequest.count({ where: { linkedOrderId: null, createdAt: { gte: hourAgo } } });
      const pingsNow = () => slackBodies.map((b) => String(JSON.parse(b).text)).filter((t) => /NIET gekoppeld/.test(t)).length;
      await settle();
      const pingsBefore = pingsNow();
      for (let i = 0; i < 12; i++) await post({ ...partA, orderId: `NOPE${i}0000`, email: `flood${i}@${DOMAIN}`, notes: `Flood-aanvraag ${i}, met eigen tekst.` });
      await settle();
      const expectedPings = Math.max(0, 10 - unlinkedBefore);
      check((await prisma.rmaRequest.count({ where: { email: { startsWith: "flood" } } })) === 12 && pingsNow() - pingsBefore === expectedPings && expectedPings < 12, `Unlinked requests ping the owner at most 10 per hour (${pingsNow() - pingsBefore} pings for 12 requests, ${unlinkedBefore} already that hour); all 12 are still stored`, `Unlinked ping cap: ${pingsNow() - pingsBefore} pings, expected ${expectedPings}`);

      // The state machine, with real effects.
      const rma = linkedRow;
      mails.length = 0;
      let r = await rmaAct.refundRmaAction(null, fd({ id: rma.id, amount: "10,00", expectedRefundedEur: "0" }));
      check(!r.ok && (await prisma.rmaRequest.findUniqueOrThrow({ where: { id: rma.id } })).status === "RECEIVED", "BEFORE/AFTER A2-07: RECEIVED -> REFUNDED directly is refused (the old buttons allowed it and changed only a label)", `Direct refund: ${JSON.stringify(r)}`);
      r = await rmaAct.approveRmaAction(null, fd({ id: rma.id, labelUrl: "http://evil.example/label" }));
      check(!r.ok, "Approve with a non-https label link: refused", `Approve http label: ${JSON.stringify(r)}`);
      const [ap1, ap2] = await Promise.all([rmaAct.approveRmaAction(null, fd({ id: rma.id })), rmaAct.approveRmaAction(null, fd({ id: rma.id }))]);
      await settle();
      const approved = mails.filter((m) => m.to.includes(`retour@${DOMAIN}`) && /goedgekeurd/i.test(m.subject));
      check([ap1, ap2].filter((x) => x.ok).length === 1 && approved.length === 1, "Approve double click: one wins, ONE mail", `Approve race: ${JSON.stringify([ap1, ap2])} mails ${approved.length}`);
      check(approved[0]?.html.includes("Teststraat 1") && approved[0].html.includes("1011 AB Amsterdam") && approved[0].html.includes(rma.rmaNumber) && /uiterlijk/.test(approved[0].html), "Approval mail contains the return address from COMPANY, the RMA number and a deadline", `Approval mail content: ${approved[0]?.html.slice(0, 300)}`);
      r = await rmaAct.returnReceivedAction(null, fd({ id: rma.id }));
      check(r.ok && (await prisma.rmaRequest.findUniqueOrThrow({ where: { id: rma.id } })).status === "RETURN_RECEIVED", "Mark received: APPROVED -> RETURN_RECEIVED", `Received: ${JSON.stringify(r)}`);
      const stockBefore = await o.stockNow();
      mails.length = 0;
      const rf = () => fd({ id: rma.id, amount: "40,00", expectedRefundedEur: "0", [`restock_${o.part.id}`]: "2" });
      const [rf1, rf2] = await Promise.all([rmaAct.refundRmaAction(null, rf()), rmaAct.refundRmaAction(null, rf())]);
      await settle();
      const after = await prisma.rmaRequest.findUniqueOrThrow({ where: { id: rma.id } });
      const notes = await inv.getCreditNotesForOrder(o.order.id);
      check(rf1.ok && after.status === "REFUNDED" && after.refundEur === 40 && after.resolvedAt !== null && notes.length === 1 && (await row(o.order.id)).refundedEur === 40 && (await o.stockNow()) === stockBefore + 2, `Refund RMA (x2 at once): REFUNDED with refundEur and resolvedAt, ONE credit note (${notes[0]?.number}), order refundedEur 40, 2 units restocked`, `RMA refund: ${JSON.stringify([rf1, rf2])} status ${after.status}, notes ${notes.length}`);
      check(mails.some((m) => m.to.includes(o.order.email) && /terugbetaling|creditnota/i.test(m.subject + m.html)), "Refund e-mails the customer (credit note number)", `Refund mail missing: ${mails.map((m) => m.subject)}`);
      const unlinked = ghostRow!;
      const rr = await rmaAct.refundRmaAction(null, fd({ id: unlinked.id, amount: "1,00", expectedRefundedEur: "0" }));
      check(!rr.ok && /gekoppeld/.test(rr.error ?? ""), "Refund on an unlinked return: refused until the owner links an order", `Unlinked refund: ${JSON.stringify(rr)}`);
      const rej = await rmaAct.rejectRmaAction(null, fd({ id: unlinked.id, reason: "Geen bestelling gevonden bij dit nummer." }));
      const rejRow = await prisma.rmaRequest.findUniqueOrThrow({ where: { id: unlinked.id } });
      await settle();
      check(rej.ok && rejRow.status === "REJECTED" && rejRow.resolvedAt !== null && mails.some((m) => m.to.includes(`nobody@${DOMAIN}`) && /niet goedgekeurd/.test(m.subject) && m.html.includes("Geen bestelling gevonden")), "Reject: REJECTED, resolvedAt set, the customer gets the reason", `Reject: ${JSON.stringify(rej)} ${rejRow.status}`);
      const rej2 = await rmaAct.approveRmaAction(null, fd({ id: unlinked.id }));
      check(!rej2.ok, "A rejected return cannot be approved afterwards", `Approve after reject: ${JSON.stringify(rej2)}`);
      const lk = await rmaAct.linkRmaAction(null, fd({ id: strRow.id, reference: ref }));
      check(lk.ok && (await prisma.rmaRequest.findUniqueOrThrow({ where: { id: strRow.id } })).linkedOrderId === o.order.id, "Manual link: the owner can link an unmatched return after checking it", `Link: ${JSON.stringify(lk)}`);
      const short = await rmaAct.linkRmaAction(null, fd({ id: wtRow.id, reference: o.order.id.slice(0, 4) }));
      check(!short.ok && /minstens 8 tekens/.test(short.error ?? "") && (await prisma.rmaRequest.findUniqueOrThrow({ where: { id: wtRow.id } })).linkedOrderId === null, "BEFORE/AFTER reviewer: a 4-character reference no longer links an arbitrary order (every cuid starts with 'c'); 8 characters are required", `4-char link: ${JSON.stringify(short)}`);
      const ambBase = { userId: user.id, subtotalEur: 10, discountEur: 0, shippingEur: 0, totalEur: 10, vatRate: 0.21, vatEur: 1.74, shippingAddress: "{}", paymentMethod: "STRIPE", status: "DELIVERED" };
      await prisma.order.createMany({ data: [{ ...ambBase, id: "zzqaamb1a", email: `amb1@${DOMAIN}` }, { ...ambBase, id: "zzqaamb1b", email: `amb2@${DOMAIN}` }] });
      const amb = await rmaAct.linkRmaAction(null, fd({ id: wtRow.id, reference: "ZZQAAMB1" }));
      check(!amb.ok && /meerdere/.test(amb.error ?? "") && (await prisma.rmaRequest.findUniqueOrThrow({ where: { id: wtRow.id } })).linkedOrderId === null, "Manual link: a reference that fits two orders is refused instead of linking the first", `Ambiguous link: ${JSON.stringify(amb)}`);
      const lk2 = await rmaAct.linkRmaAction(null, fd({ id: wtRow.id, reference: ref }));
      const lk3 = await rmaAct.linkRmaAction(null, fd({ id: wtRow.id, reference: "ZZQAAMB1A" }));
      check(lk2.ok && !lk3.ok && (await prisma.rmaRequest.findUniqueOrThrow({ where: { id: wtRow.id } })).linkedOrderId === o.order.id, "Manual link: an 8-character reference links; an already linked return is not silently re-linked", `Link 8 chars: ${JSON.stringify([lk2, lk3])}`);

      // Reviewer: RETURN_RECEIVED was a dead end once the order was refunded from the order desk.
      const o6 = await mkOrder({ status: "DELIVERED", qty: 2, price: 20, method: "BANK_TRANSFER", email: `dead@${DOMAIN}` });
      const mkRma = (orderId: string | null, status: string, extra: Record<string, unknown> = {}) =>
        prisma.rmaRequest.create({ data: { rmaNumber: `RMA-QA-${Date.now().toString(36)}-${++n}`, orderId: "x", linkedOrderId: orderId, name: "Dode Punt", email: `dead@${DOMAIN}`, reason: "DEFECT", notes: "test van het dode punt", status, ...extra } });
      const rmaRej = await mkRma(o6.order.id, "RETURN_RECEIVED");
      const rejRR = await rmaAct.rejectRmaAction(null, fd({ id: rmaRej.id, reason: "Beschadigd door gebruik, geen garantie." }));
      check(rejRR.ok && (await prisma.rmaRequest.findUniqueOrThrow({ where: { id: rmaRej.id } })).status === "REJECTED", "A return whose parcel arrived can still be rejected (it used to be stuck at RETURN_RECEIVED)", `Reject at RETURN_RECEIVED: ${JSON.stringify(rejRR)}`);
      const rmaDead = await mkRma(o6.order.id, "RETURN_RECEIVED");
      const closeEarly = await rmaAct.closeRmaAction(null, fd({ id: rmaDead.id, note: "poging zonder terugbetaling" }));
      check(!closeEarly.ok && (await prisma.rmaRequest.findUniqueOrThrow({ where: { id: rmaDead.id } })).status === "RETURN_RECEIVED", "Closing without a refund is refused while nothing was refunded on the order (it is not a back door around the refund)", `Close without refund: ${JSON.stringify(closeEarly)}`);
      const deskRefund = await ordAct.recordRefundAction(null, fd({ orderId: o6.order.id, amount: "40,00", reason: "coulance", idempotencyKey: "qa-key-dead-0001", expectedRefundedEur: "0" }));
      const stuck = await rmaAct.refundRmaAction(null, fd({ id: rmaDead.id, amount: "1,00", expectedRefundedEur: "40" }));
      check(deskRefund.ok && !stuck.ok && (await prisma.rmaRequest.findUniqueOrThrow({ where: { id: rmaDead.id } })).status === "RETURN_RECEIVED", "REPRO: refunded from the order desk, the RMA cannot be refunded again (nothing left)", `Dead end repro: ${JSON.stringify([deskRefund, stuck])}`);
      const closedDead = await rmaAct.closeRmaAction(null, fd({ id: rmaDead.id, note: "Terugbetaald via de bestelling." }));
      const deadAfter = await prisma.rmaRequest.findUniqueOrThrow({ where: { id: rmaDead.id } });
      const closeTwice = await rmaAct.closeRmaAction(null, fd({ id: rmaDead.id, note: "nogmaals proberen" }));
      check(closedDead.ok && deadAfter.status === "REFUNDED" && deadAfter.refundEur === 40 && deadAfter.resolvedAt !== null && (await inv.getCreditNotesForOrder(o6.order.id)).length === 1 && !closeTwice.ok, "AFTER: 'sluit zonder nieuwe terugbetaling' closes it (REFUNDED, refundEur 40, resolvedAt), books nothing (still ONE credit note), and cannot be repeated", `Close dead end: ${JSON.stringify([closedDead, closeTwice])} ${deadAfter.status}`);
      // The label-only buttons under /admin/aanvragen can still set REFUNDED without any refund; this screen must not call that "al terugbetaald".
      const o7 = await mkOrder({ status: "DELIVERED", qty: 1, price: 20, method: "STRIPE", pi: "pi_qa_old_buttons", email: `oldbtn@${DOMAIN}` });
      const rmaOld = await mkRma(o7.order.id, "REFUNDED");
      const refundsBefore = fake.state.refunds.length;
      const oldRes = await rmaAct.refundRmaAction(null, fd({ id: rmaOld.id, amount: "5,00", expectedRefundedEur: "0" }));
      check(!oldRes.ok && /geen terugbetaling of creditnota geboekt/.test(oldRes.error ?? "") && !/^Deze retour is al terugbetaald/.test(oldRes.error ?? "") && fake.state.refunds.length === refundsBefore && (await inv.getCreditNotesForOrder(o7.order.id)).length === 0, "A return set to REFUNDED by the old label-only buttons is not reported as 'al terugbetaald': the owner is told nothing was booked", `Old-button state: ${JSON.stringify(oldRes)}`);
      // No real address -> no approval (child process with the address unset).
      const probeFile = path.join(tmpdir(), `qa-admin-probe-${process.pid}.ts`);
      writeFileSync(probeFile, `import { realReturnAddress } from "${ROOT}/src/app/admin/_lib/rma";\nconsole.log("ADDR=" + JSON.stringify(realReturnAddress()));\n`);
      const probe = spawnSync("npx", ["tsx", probeFile], { cwd: ROOT, encoding: "utf8", env: { ...process.env, COMPANY_STREET: "", COMPANY_POSTAL_CODE: "", COMPANY_CITY: "" } });
      const probeOk = spawnSync("npx", ["tsx", probeFile], { cwd: ROOT, encoding: "utf8", env: { ...process.env } });
      unlinkSync(probeFile);
      check(/ADDR=null/.test(probe.stdout) && /ADDR=\[.*Teststraat 1.*1011 AB Amsterdam/.test(probeOk.stdout), "Without a configured company address the return address is null (approval is blocked, the placeholder is never mailed); with one it is the real address", `Address probe: ${probe.stdout} ${probe.stderr.slice(0, 200)} / ${probeOk.stdout}`);
    }

    // ═══ 6. Scheduled jobs ═════════════════════════════════════════════════
    {
      const ordersRoute = await import("../src/app/api/cron/orders/route");
      const retRoute = await import("../src/app/api/cron/retention/route");
      const subsRoute = await import("../src/app/api/cron/stripe-subscriptions/route");
      const recRoute = await import("../src/app/api/cron/stripe-reconcile/route");
      const authMod = await import("../src/app/api/cron/_lib/auth");
      const call = async (route: { GET: (r: Request) => Promise<Response> }, auth?: string) => {
        const res = await route.GET(new Request("http://localhost/api/cron/x", { headers: auth ? { authorization: auth } : {} }));
        return { status: res.status, json: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
      };
      const secret = process.env.CRON_SECRET!;

      // Guard
      const routes = { orders: ordersRoute, retention: retRoute, "stripe-subscriptions": subsRoute, "stripe-reconcile": recRoute };
      let guardOk = true;
      for (const [name, route] of Object.entries(routes)) {
        const none = await call(route);
        const wrong = await call(route, "Bearer nope");
        const prefix = await call(route, `Bearer ${secret.slice(0, -1)}`);
        const basic = await call(route, `Basic ${secret}`);
        const bare = await call(route, secret);
        if (![none, wrong, prefix, basic, bare].every((x) => x.status === 401)) { guardOk = false; log.push(`❌ Cron ${name}: unauthenticated calls not all 401: ${[none, wrong, prefix, basic, bare].map((x) => x.status)}`); }
      }
      if (guardOk) check(true, "Cron guard: all 4 routes answer 401 to no header, a wrong secret, a prefix of the secret, Basic auth and a bare secret", "");
      check(authMod.refuseUnlessCron(new Request("http://x/", { headers: { authorization: `Bearer ${secret}` } }), null)?.status === 503, "Cron guard: with CRON_SECRET unset even the 'right' header is refused (503)", "Cron guard: accepted with no secret configured");
      const cronProbe = path.join(tmpdir(), `qa-admin-cron-${process.pid}.ts`);
      writeFileSync(cronProbe, `import { GET } from "${ROOT}/src/app/api/cron/orders/route";\nGET(new Request("http://x/", { headers: { authorization: "Bearer anything" } })).then((r) => { console.log("STATUS=" + r.status); process.exit(0); });\n`);
      const noSecret = spawnSync("npx", ["tsx", cronProbe], { cwd: ROOT, encoding: "utf8", env: { ...process.env, CRON_SECRET: "" } });
      unlinkSync(cronProbe);
      check(/STATUS=503/.test(noSecret.stdout), "Cron route imported with CRON_SECRET unset: refuses everything (503)", `No-secret probe: ${noSecret.stdout.slice(-200)} ${noSecret.stderr.slice(-200)}`);
      const ok = await call(ordersRoute, `Bearer ${secret}`);
      check(ok.status === 200 && ok.json.ok === true && typeof ok.json.expiry?.cancelled === "number" && typeof ok.json.reminders === "object", `Cron orders with the secret: 200 and JSON counts (${JSON.stringify({ expiry: ok.json.expiry, abandoned: ok.json.abandonedStripe })})`, `Cron orders ok-call: ${JSON.stringify(ok)}`);
      const sub = await call(subsRoute, `Bearer ${secret}`);
      const rec = await call(recRoute, `Bearer ${secret}`);
      check(sub.status === 200 && sub.json.ok && rec.status === 200 && rec.json.ok && rec.json.result?.checked === 0, "Cron stripe-subscriptions and stripe-reconcile are wired: 200 with their counts", `Stripe crons: ${JSON.stringify([sub, rec])}`);

      // A2-09: expiry with ZERO traffic (no checkout request in this process)
      const expired = await mkOrder({ status: "OPENSTAAND", qty: 3, dueInDays: -9, email: `expired@${DOMAIN}` });
      const justDue = await mkOrder({ status: "OPENSTAAND", qty: 1, dueInDays: -1, email: `due1@${DOMAIN}` });
      const nearEnd = await mkOrder({ status: "OPENSTAAND", qty: 1, dueInDays: -6, email: `due6@${DOMAIN}` });
      const future = await mkOrder({ status: "OPENSTAAND", qty: 1, dueInDays: 5, email: `future@${DOMAIN}` });
      const before = await expired.stockNow();
      mails.length = 0;
      slackBodies.length = 0;
      const run1 = await call(ordersRoute, `Bearer ${secret}`);
      await settle();
      const e = await row(expired.order.id);
      check(e.status === "CANCELLED" && (await expired.stockNow()) === before + 3 && (await inv.getCreditNotesForOrder(expired.order.id)).length === 1, "BEFORE/AFTER A2-09: an OPENSTAAND order 9 days past due is cancelled by the cron call alone (no checkout traffic): stock back, credit note issued", `Expiry cron: status ${e.status}, run ${JSON.stringify(run1.json)}`);
      check(mails.some((m) => m.to.includes(`expired@${DOMAIN}`) && /geannuleerd/i.test(m.subject)), "Expiry: the customer is told", "Expiry: no cancellation mail");
      check(slackTexts().some((t) => /Onbetaalde bestellingen opgeruimd/.test(t)), "Expiry: the owner gets a summary", `Expiry: no owner summary: ${slackTexts()}`);
      const remDue = mails.filter((m) => m.to.includes(`due1@${DOMAIN}`) && /herinnering/i.test(m.subject));
      const remLast = mails.filter((m) => m.to.includes(`due6@${DOMAIN}`) && /laatste herinnering/i.test(m.subject));
      const remFuture = mails.filter((m) => m.to.includes(`future@${DOMAIN}`));
      check(remDue.length === 1 && /vervalt vandaag|Betalingsherinnering|Herinnering/.test(remDue[0].subject) && remLast.length === 1 && remFuture.length === 0, "Reminders: due yesterday -> the 'due' reminder; 6 days past due -> the 'last' reminder; not yet due -> nothing", `Reminders: due ${remDue.length}, last ${remLast.length}, future ${remFuture.length}`);
      check(remDue[0]?.html.includes((await invoiceOf(justDue.order.id)).number) && remDue[0].html.includes("NL02ABNA0123456789"), "Reminder mail names the invoice number (the wire reference) and the IBAN of the invoice", "Reminder mail lacks invoice number/IBAN");
      mails.length = 0;
      // Reviewer: every hourly run met the unique index for each already-reminded order and logged a prisma:error.
      const noise: string[] = [];
      const origErr = console.error, origWrite = process.stderr.write.bind(process.stderr);
      console.error = (...a: unknown[]) => { noise.push(a.map(String).join(" ")); };
      (process.stderr as unknown as { write: (c: unknown, ...r: unknown[]) => boolean }).write = (c: unknown, ...r: unknown[]) => { noise.push(String(c)); return (origWrite as unknown as (c: unknown, ...r: unknown[]) => boolean)(c, ...r); };
      // Prisma writes its error log from the engine, outside process.stderr, so the log lines cannot be captured here;
      // count the inserts instead: a run over already-reminded orders must not try to insert a marker at all.
      const { prisma: appPrisma } = await import("../src/lib/prisma");
      const realCreate = appPrisma.usageCounter.create.bind(appPrisma.usageCounter);
      let markerInserts = 0;
      (appPrisma.usageCounter as unknown as { create: unknown }).create = (...a: Parameters<typeof realCreate>) => { markerInserts++; return realCreate(...a); };
      const run2 = await call(ordersRoute, `Bearer ${secret}`);
      (appPrisma.usageCounter as unknown as { create: unknown }).create = realCreate;
      console.error = origErr;
      (process.stderr as unknown as { write: unknown }).write = origWrite;
      check(markerInserts === 0 && run2.json.reminders.alreadySent >= 2 && noise.filter((l) => /Unique constraint|P2002/i.test(l)).length === 0, `An hourly run over already-reminded orders (alreadySent ${run2.json.reminders.alreadySent}) tries no marker insert, so it provokes no unique-constraint error in the log (it looks before it inserts)`, `Reminder run inserted ${markerInserts} markers for orders that were already reminded (each one is a unique-violation in the Prisma log)`);
      const run3 = await call(ordersRoute, `Bearer ${secret}`);
      await settle();
      check(mails.filter((m) => /herinnering/i.test(m.subject)).length === 0 && run2.json.reminders.alreadySent >= 2, `Reminders are idempotent: two more runs sent 0 mails (alreadySent ${run2.json.reminders.alreadySent})`, `Reminders repeated: ${mails.map((m) => m.subject)}`);
      const parallel = await mkOrder({ status: "OPENSTAAND", qty: 1, dueInDays: -2, email: `par@${DOMAIN}` });
      mails.length = 0;
      await Promise.all([call(ordersRoute, `Bearer ${secret}`), call(ordersRoute, `Bearer ${secret}`), call(ordersRoute, `Bearer ${secret}`)]);
      await settle();
      check(mails.filter((m) => m.to.includes(`par@${DOMAIN}`)).length === 1, "Three cron runs at the same moment: the reminder is still sent exactly once", `Parallel reminders: ${mails.filter((m) => m.to.includes(`par@${DOMAIN}`)).length}`);
      void run3; void future; void nearEnd;
      const markers = await prisma.usageCounter.count({ where: { scope: "payment-reminder", key: { in: [`${justDue.order.id}:due`, `${nearEnd.order.id}:last`] } } });
      check(markers === 2, "Reminder markers are recorded in the database", `Reminder markers: ${markers}`);
      const paidMail = await call(ordersRoute, `Bearer ${secret}`);
      void paidMail;

      // A2-05/A5-20: retention, on rows we backdate ourselves
      const oldTime = new Date(Date.now() - 10 * 86_400_000);
      await prisma.usageCounter.createMany({ data: [
        { scope: "qa-admin", key: "ip:qa-admin-old", count: 2, windowEnd: new Date(Date.now() + 20 * 86_400_000) },
        { scope: "qa-admin", key: "ip:qa-admin-fresh", count: 1, windowEnd: new Date(Date.now() + 20 * 86_400_000) },
        { scope: "qa-admin", key: "user:qa-admin-expired", count: 1, windowEnd: new Date(Date.now() - 30 * 86_400_000) },
        { scope: "qa-admin", key: "user:qa-admin-live", count: 1, windowEnd: new Date(Date.now() + 5 * 86_400_000) },
      ] });
      await prisma.$executeRaw`UPDATE "UsageCounter" SET "updatedAt" = ${oldTime} WHERE "key" = 'ip:qa-admin-old'`;
      await prisma.usageCounter.createMany({ data: [
        { scope: "qa-admin", key: "ip:qa-admin-6d", count: 1, windowEnd: new Date(Date.now() + 20 * 86_400_000) },
        { scope: "qa-admin", key: "ip:qa-admin-8d", count: 1, windowEnd: new Date(Date.now() + 20 * 86_400_000) },
      ] });
      await prisma.$executeRaw`UPDATE "UsageCounter" SET "updatedAt" = ${new Date(Date.now() - 6 * 86_400_000)} WHERE "key" = 'ip:qa-admin-6d'`;
      await prisma.$executeRaw`UPDATE "UsageCounter" SET "updatedAt" = ${new Date(Date.now() - 8 * 86_400_000)} WHERE "key" = 'ip:qa-admin-8d'`;
      const thirteenMonths = new Date(Date.now() - 400 * 86_400_000);
      await prisma.diagnosis.createMany({ data: [
        { id: "qa-admin-diag-old", userId: user.id, sessionId: "qa-admin-s1", brand: "Bosch", symptoms: "mijn naam is Piet en ik woon in Delft", messages: '[{"role":"user","content":"Piet"}]', result: '{"errorCode":"E18"}', createdAt: thirteenMonths },
        { id: "qa-admin-diag-guest", userId: null, sessionId: "qa-admin-s2", brand: "Miele", symptoms: "lekt", messages: '[{"role":"user","content":"lekt"}]', result: '{"errorCode":"F11"}', createdAt: thirteenMonths },
        { id: "qa-admin-diag-new", userId: user.id, sessionId: "qa-admin-s3", brand: "AEG", symptoms: "trilt", messages: '[{"role":"user","content":"trilt"}]', result: '{"errorCode":"E20"}' },
        // Reviewer: /api/diagnose itself mints "anon-<timestamp>" for callers without a sessionId, and any caller may send one.
        // The old marker test (sessionId NOT LIKE 'anon-%') skipped such rows for ever.
        { id: "qa-admin-diag-anon1", userId: user.id, sessionId: "anon-1700000000000", brand: "Bosch", symptoms: "lekt bij Piet in Delft", messages: '[{"role":"user","content":"lekt"}]', result: '{"errorCode":"E18"}', createdAt: thirteenMonths },
        { id: "qa-admin-diag-anon2", userId: null, sessionId: "anon-1700000000001", brand: "Siemens", symptoms: "trilt", messages: '[{"role":"user","content":"trilt"}]', createdAt: thirteenMonths },
        // The 12-month boundary, 5 days either side: a mutation of DIAGNOSIS_MONTHS to 1, 11 or 13 changes one of these two.
        { id: "qa-admin-diag-360d", userId: user.id, sessionId: "qa-admin-s4", brand: "Beko", symptoms: "piept", messages: '[{"role":"user","content":"piept"}]', createdAt: new Date(Date.now() - 360 * 86_400_000) },
        { id: "qa-admin-diag-370d", userId: user.id, sessionId: "qa-admin-s5", brand: "Candy", symptoms: "stinkt", messages: '[{"role":"user","content":"stinkt"}]', createdAt: new Date(Date.now() - 370 * 86_400_000) },
      ] });
      await prisma.diagnosisFeedback.createMany({ data: [
        { diagnosisId: "qa-admin-diag-old", sessionId: "qa-admin-s1", rating: "down", comment: "qa-admin old", createdAt: thirteenMonths },
        { diagnosisId: "qa-admin-diag-new", sessionId: "qa-admin-s3", rating: "up", comment: "qa-admin new" },
      ] });
      const reminderBefore = await prisma.usageCounter.count({ where: { scope: "payment-reminder" } });
      const ret1 = await call(retRoute, `Bearer ${secret}`);
      const exists = async (key: string) => (await prisma.usageCounter.count({ where: { key } })) > 0;
      check(!(await exists("ip:qa-admin-old")) && (await exists("ip:qa-admin-fresh")) && !(await exists("user:qa-admin-expired")) && (await exists("user:qa-admin-live")), "Retention: the 10-day-old ip: counter and the long-expired counter are deleted; the fresh ip counter and the live counter stay", `Retention counters: ${JSON.stringify(ret1.json)}`);
      check((await prisma.usageCounter.count({ where: { scope: "payment-reminder" } })) === reminderBefore, "Retention never deletes the payment-reminder markers", "Retention deleted reminder markers");
      const dOld = await prisma.diagnosis.findUniqueOrThrow({ where: { id: "qa-admin-diag-old" } });
      const dGuest = await prisma.diagnosis.findUniqueOrThrow({ where: { id: "qa-admin-diag-guest" } });
      const dNew = await prisma.diagnosis.findUniqueOrThrow({ where: { id: "qa-admin-diag-new" } });
      check(dOld.userId === null && dOld.symptoms === "" && dOld.messages === "[]" && dOld.sessionId === "anon-qa-admin-diag-old" && dOld.brand === "Bosch" && dOld.result === '{"errorCode":"E18"}' && dGuest.sessionId.startsWith("anon-") && dGuest.symptoms === "", "Retention: a 13-month-old diagnosis loses user, session and typed text but keeps brand and structured result (also for guests)", `Diagnosis anonymisation: ${JSON.stringify(dOld)}`);
      check(dNew.userId === user.id && dNew.symptoms === "trilt" && dNew.sessionId === "qa-admin-s3", "Retention: a recent diagnosis is untouched", `Recent diagnosis changed: ${JSON.stringify(dNew)}`);
      const [dA1, dA2, d360, d370] = await Promise.all(["anon1", "anon2", "360d", "370d"].map((k) => prisma.diagnosis.findUniqueOrThrow({ where: { id: `qa-admin-diag-${k}` } })));
      check(dA1.userId === null && dA1.symptoms === "" && dA1.messages === "[]" && dA1.sessionId === "anon-qa-admin-diag-anon1" && dA2.symptoms === "" && dA2.sessionId === "anon-qa-admin-diag-anon2", "BEFORE/AFTER reviewer: old diagnoses whose sessionId already starts with 'anon-' (minted by /api/diagnose) ARE anonymised (before: skipped, userId and free text kept for ever)", `anon- collision: ${JSON.stringify([dA1, dA2])}`);
      check(d360.userId === user.id && d360.symptoms === "piept" && d370.userId === null && d370.symptoms === "" && retention.DIAGNOSIS_MONTHS === 12, "Retention boundary: a diagnosis 360 days old is kept, one 370 days old is anonymised (12 months, tested 5 days either side)", `Retention boundary: 360d ${JSON.stringify(d360)} 370d ${JSON.stringify(d370)}`);
      const [fbOld, fbNew] = await Promise.all([prisma.diagnosisFeedback.findFirstOrThrow({ where: { comment: "qa-admin old" } }), prisma.diagnosisFeedback.findFirstOrThrow({ where: { comment: "qa-admin new" } })]);
      check(fbOld.sessionId === null && fbOld.rating === "down" && fbNew.sessionId === "qa-admin-s3", "Retention clears DiagnosisFeedback.sessionId of old feedback (same identifier) and leaves recent feedback alone", `Feedback: ${JSON.stringify([fbOld, fbNew])}`);
      check((await exists("ip:qa-admin-6d")) && !(await exists("ip:qa-admin-8d")) && retention.IP_COUNTER_DAYS === 7, "Retention IP window: an ip: counter idle for 6 days stays, one idle for 8 days is deleted (7 days, tested 1 day either side)", "IP window boundary wrong");
      const ret2 = await call(retRoute, `Bearer ${secret}`);
      check(ret2.json.diagnosesAnonymised === 0 && ret2.json.ipCountersDeleted === 0, "Retention is idempotent: a second run does nothing", `Retention rerun: ${JSON.stringify(ret2.json)}`);
    }

    // ═══ 7. Catalogue entry: prices with cents, stock by delta, CSV ═════════
    {
      // Static: the shared Field no longer validates against step=1 (the real-browser check is a separate Playwright run, see the report).
      const forms = readFileSync(path.join(ROOT, "src/app/monteur/_lib/forms.tsx"), "utf8");
      // Was: type=number defaults to step="any". Replaced by the stronger rule (a number field WITHOUT an integer step is a decimal text input),
      // because step="any" is exactly what let an en-US browser read "89,50" as 8950; see section 12 for the rendered markup.
      check(/function isAmountField/.test(forms) && /type === "decimal"/.test(forms) && !/step \?\? "any"/.test(forms), "Forms: amounts are decimal text inputs (type=decimal, or type=number without an integer step); no step=any number input is rendered any more", "Forms: Field still renders a step=any number input or lacks the decimal handling");

      const dbCats = (await prisma.part.findMany({ distinct: ["category"], select: { category: true } })).map((c) => c.category);
      const constants = await import("../src/app/admin/_lib/catalog-constants");
      const missingCats = dbCats.filter((c) => !(constants.PART_CATEGORIES as readonly string[]).includes(c));
      check(missingCats.length === 0, `Categories: every category used in the database (${dbCats.length}) is offered by the part editor (it used to miss BOARD, HEATER, NTC, SEAL: a price edit re-filed such a part under Pompen)`, `Editor lacks categories: ${missingCats}`);
      const p = await mkPart(10, 20, { costEur: 12, costSource: "ESTIMATE", supplier: "Oud" });
      // A customer buys 2 while the owner has the edit dialog open with stock=10 rendered.
      await prisma.part.update({ where: { id: p.id }, data: { stock: { decrement: 2 } } });
      const edit = (o: Record<string, string>) => fd({ id: p.id, sku: p.sku, name: "QA onderdeel bewerkt", brand: "QA", category: "OTHER", priceEur: "28,50", costEur: "12,25", costSource: "QUOTE", stock: "10", description: "", imageUrl: "", supplier: "Oud", ...o });
      let r = await catAct.savePart(null, edit({}));
      const after = await prisma.part.findUniqueOrThrow({ where: { id: p.id } });
      check(r.ok && after.priceEur === 28.5 && after.costEur === 12.25 && after.costSource === "QUOTE" && after.stock === 8, "BEFORE/AFTER critic: a price-only edit with the stale form value stock=10 leaves the real stock (8) alone, and price 28,50 / cost 12,25 / source QUOTE are saved", `savePart: ${JSON.stringify(r)} price ${after.priceEur} stock ${after.stock}`);
      r = await catAct.savePart(null, edit({ priceEur: "28.50", costEur: "" , costSource: "QUOTE" }));
      check(!r.ok && /offerte/i.test(r.error ?? ""), "A QUOTE source without a cost price is refused", `QUOTE w/o cost: ${JSON.stringify(r)}`);
      r = await catAct.savePart(null, edit({ costEur: "twaalf" }));
      check(!r.ok && /inkoopprijs/i.test(r.error ?? "") && (await prisma.part.findUniqueOrThrow({ where: { id: p.id } })).costEur === 12.25, "An unreadable cost does not silently clear the stored cost", `Bad cost: ${JSON.stringify(r)}`);
      r = await catAct.savePart(null, edit({ priceEur: "1.234,50", costEur: "", costSource: "ESTIMATE" }));
      const cleared = await prisma.part.findUniqueOrThrow({ where: { id: p.id } });
      check(r.ok && cleared.priceEur === 1234.5 && cleared.costEur === null && cleared.costSource === "ESTIMATE", "Price in Dutch thousands notation (1.234,50) saves; an empty cost clears it on purpose", `Dutch price: ${JSON.stringify(r)} ${cleared.priceEur} ${cleared.costEur}`);
      const nsku = `${SKU_PREFIX}NEW-${Date.now()}`;
      r = await catAct.savePart(null, fd({ sku: nsku, name: "Nieuw QA onderdeel", brand: "QA", category: "PUMP", priceEur: "9,95", costEur: "", costSource: "ESTIMATE", stock: "7" }));
      const created = await prisma.part.findUnique({ where: { sku: nsku } });
      check(r.ok && created?.priceEur === 9.95 && created.stock === 7 && created.costSource === "ESTIMATE", "A new part takes its opening stock from the form", `New part: ${JSON.stringify(r)}`);

      // adjustStock: deltas under concurrency
      const q2 = await mkPart(100, 5);
      const ops = [...Array.from({ length: 20 }, () => stock.adjustStock({ partId: q2.id, delta: 3, reason: "ONTVANGEN", actor: "qa" })), ...Array.from({ length: 10 }, () => stock.adjustStock({ partId: q2.id, delta: -2, reason: "CORRECTIE", actor: "qa" })), prisma.part.update({ where: { id: q2.id }, data: { stock: { decrement: 5 } } })];
      await Promise.all(ops);
      check((await prisma.part.findUniqueOrThrow({ where: { id: q2.id } })).stock === 100 + 60 - 20 - 5, "Stock delta: 20x +3, 10x -2 and a simultaneous order of 5 all count (final 135), nothing is overwritten", `Stock delta final ${(await prisma.part.findUniqueOrThrow({ where: { id: q2.id } })).stock}`);
      const neg = await stock.adjustStock({ partId: q2.id, delta: -1000, reason: "CORRECTIE", actor: "qa" });
      const recv = await stock.adjustStock({ partId: q2.id, delta: -1, reason: "ONTVANGEN", actor: "qa" });
      const zero = await stock.adjustStock({ partId: q2.id, delta: 0, reason: "CORRECTIE", actor: "qa" });
      check(!neg.ok && !recv.ok && !zero.ok && (await prisma.part.findUniqueOrThrow({ where: { id: q2.id } })).stock === 135, "Stock delta: below zero, negative 'goederen ontvangen' and a zero delta are refused", `Stock guards: ${JSON.stringify([neg, recv, zero])}`);
      const act = await catAct.adjustStockAction(null, fd({ id: q2.id, delta: "12", reason: "ONTVANGEN", note: "levering" }));
      check(act.ok && (await prisma.part.findUniqueOrThrow({ where: { id: q2.id } })).stock === 147, "adjustStockAction (goederen ontvangen +12)", `adjustStockAction: ${JSON.stringify(act)}`);
      const act2 = await catAct.adjustStockAction(null, fd({ id: q2.id, delta: "1.5", reason: "CORRECTIE" }));
      check(!act2.ok, "adjustStockAction refuses a fractional amount", `Fractional: ${JSON.stringify(act2)}`);

      // CSV export
      const exp = await ccsv.exportPartsCsv();
      const parsed = csv.parseCsv(exp);
      check(parsed.header.join(";") === ccsv.PART_CSV_COLUMNS.join(";") && parsed.rows.length === (await prisma.part.count()) && parsed.delimiter === ";" && exp.startsWith("﻿"), `CSV export: ${parsed.rows.length} parts, columns ${parsed.header.join(";")}`, `CSV export header/rows wrong: ${parsed.header}`);
      const tricky = await mkPart(1, 9.5, { name: "=HYPERLINK(\"http://x\")" });
      check((await ccsv.exportPartsCsv()).includes(`'=HYPERLINK(""http://x"")`), "CSV export: a part name that looks like a formula is exported with the apostrophe guard", "CSV export: formula injection not guarded");
      await prisma.part.delete({ where: { id: tricky.id } });

      // CSV import
      const s1 = await mkPart(10, 20, { costEur: 10, costSource: "ESTIMATE", supplier: "A" });
      const s2 = await mkPart(5, 30, { costEur: 15, costSource: "ESTIMATE" });
      const untouched = await mkPart(77, 40, { costEur: 20, costSource: "ESTIMATE" });
      const header = "sku;name;brand;category;price;cost;costSource;stock;supplier";
      const file1 = [header, `${s1.sku};;;;24,95;12,5;QUOTE;12;Leverancier X`, `${s2.sku};;;;;;;5;`, `${SKU_PREFIX}CSVNEW-1;Nieuw uit CSV;QA;PUMP;19,99;;;3;`].join("\r\n");
      const prev = await ccsv.planPartsImport(file1);
      check(!prev.fatal && prev.counts.create === 1 && prev.counts.update === 1 && prev.counts.unchanged === 1 && prev.counts.error === 0 && prev.counts.stockChanges === 1, `Import preview: 1 new, 1 changed, 1 unchanged (empty cells leave values as they are), 1 stock change`, `Import preview: ${JSON.stringify(prev.counts)} ${prev.fatal}`);
      check(JSON.stringify(await prisma.part.findUniqueOrThrow({ where: { id: s1.id } })) === JSON.stringify(s1), "Import preview writes nothing", "Preview changed the database");
      const refused = await ccsv.applyPartsImport(file1, { token: prev.token, allowCreate: false, actor: "qa" });
      check(!refused.ok && /nieuwe onderdelen/.test(refused.error) && (await prisma.part.count({ where: { sku: `${SKU_PREFIX}CSVNEW-1` } })) === 0 && (await prisma.part.findUniqueOrThrow({ where: { id: s1.id } })).priceEur === 20, "Import never creates parts silently: without the explicit confirmation nothing is created or changed", `Create refusal: ${JSON.stringify(refused)}`);
      const done = await ccsv.applyPartsImport(file1, { token: prev.token, allowCreate: true, actor: "qa" });
      const a1 = await prisma.part.findUniqueOrThrow({ where: { id: s1.id } });
      const a2 = await prisma.part.findUniqueOrThrow({ where: { id: s2.id } });
      const au = await prisma.part.findUniqueOrThrow({ where: { id: untouched.id } });
      const nw = await prisma.part.findUnique({ where: { sku: `${SKU_PREFIX}CSVNEW-1` } });
      check(done.ok && done.created === 1 && done.updated === 1 && a1.priceEur === 24.95 && a1.costEur === 12.5 && a1.costSource === "QUOTE" && a1.stock === 12 && a1.supplier === "Leverancier X" && a1.name === s1.name && a2.stock === 5 && a2.priceEur === 30 && nw?.stock === 3 && nw.priceEur === 19.99, "Import apply: values from the file are written, blank cells keep the old value, the new part is created", `Import apply: ${JSON.stringify(done)} s1 ${JSON.stringify(a1)}`);
      check(JSON.stringify(au) === JSON.stringify(untouched), "Import: a part that is not in the file is not touched (stock, price, everything)", "Import touched a part outside the file");
      const idem = await ccsv.planPartsImport(file1);
      check(idem.counts.create === 0 && idem.counts.update === 0 && idem.counts.unchanged === 3, "Re-importing the same file changes nothing", `Re-import plan: ${JSON.stringify(idem.counts)}`);
      const exported = await ccsv.exportPartsCsv();
      const roundtrip = await ccsv.planPartsImport(exported);
      check(!roundtrip.fatal && roundtrip.counts.error === 0 && roundtrip.counts.create === 0 && roundtrip.counts.update === 0, "Export then import is a no-op for the whole catalogue (the file the owner edits in Excel is accepted as written)", `Roundtrip plan: ${JSON.stringify(roundtrip.counts)} ${roundtrip.fatal} ${roundtrip.rows.find((x) => x.errors.length)?.errors}`);

      // Errors and atomicity
      const bad = [header, `${s1.sku};;;;1,00;;;99;`, `${s2.sku};;;;abc;;;;`, `${s2.sku};;;;2,00;;;;`, `not a sku;;;;;;;;`, `${SKU_PREFIX}CSVNEW-2;X;QA;PUMP;5;3;;1;`, `${SKU_PREFIX}CSVNEW-3;;QA;;5;;;1;`, `${s1.sku.toLowerCase()};;;;;4;;;`].join("\n");
      const badPlan = await ccsv.planPartsImport(bad);
      const errs = badPlan.rows.filter((x) => x.action === "error");
      check(badPlan.counts.error >= 5 && errs.some((x) => x.line === 3 && /price/.test(x.errors.join())) && errs.some((x) => x.line === 4 && /eerder/.test(x.errors.join())) && errs.some((x) => x.line === 5 && /sku/.test(x.errors.join())) && errs.some((x) => x.line === 6 && /name|costSource/.test(x.errors.join())) && errs.some((x) => x.line === 8 && /costSource/.test(x.errors.join())), `Import: per-row errors with line numbers (${badPlan.counts.error}): bad price, duplicate sku, bad sku, short name/cost without source, changed cost without costSource`, `Import errors: ${JSON.stringify(errs.map((x) => [x.line, x.errors]))}`);
      const stockBefore = (await prisma.part.findUniqueOrThrow({ where: { id: s1.id } })).stock;
      const atomic = await ccsv.applyPartsImport(bad, { token: badPlan.token, allowCreate: true, actor: "qa" });
      check(!atomic.ok && (await prisma.part.findUniqueOrThrow({ where: { id: s1.id } })).stock === stockBefore && (await prisma.part.count({ where: { sku: { startsWith: `${SKU_PREFIX}CSVNEW-2` } } })) === 0, "Import is all or nothing: one bad row and the valid rows are not applied either", `Atomic import: ${JSON.stringify(atomic)}`);
      const withActive = await ccsv.planPartsImport("sku;name;active\nQA-X;y;ja");
      const withUnknown = await ccsv.planPartsImport("sku;price;kleur\nQA-X;1;rood");
      check(/active/.test(withActive.fatal ?? "") && /bestaat nog niet/.test(withActive.fatal ?? "") && /kleur/.test(withUnknown.fatal ?? ""), "Import: an 'active' column or any unknown column is refused with an explanation (not ignored)", `Unknown columns: ${withActive.fatal} | ${withUnknown.fatal}`);
      const noSku = await ccsv.planPartsImport("name;price\nx;1");
      const huge = await ccsv.planPartsImport(`sku\n${Array.from({ length: 2001 }, (_, i) => `QA-${i}`).join("\n")}`);
      check(/sku/.test(noSku.fatal ?? "") && /2000/.test(huge.fatal ?? ""), "Import: missing sku column and more than 2000 rows are refused", `Limits: ${noSku.fatal} | ${huge.fatal}`);
      // Stale preview: an order took stock between preview and apply.
      const ff = [header, `${s2.sku};;;;;;;50;`].join("\n");
      const pv = await ccsv.planPartsImport(ff);
      await prisma.part.update({ where: { id: s2.id }, data: { stock: { decrement: 1 } } });
      const stale = await ccsv.applyPartsImport(ff, { token: pv.token, allowCreate: false, actor: "qa" });
      check(!stale.ok && /gewijzigd sinds het voorbeeld/.test(stale.error) && (await prisma.part.findUniqueOrThrow({ where: { id: s2.id } })).stock === 4, "Import: if the database changed after the preview (an order took a unit), the apply is refused and nothing is written", `Stale import: ${JSON.stringify(stale)}`);
      const pv2 = await ccsv.planPartsImport(ff);
      const fresh = await ccsv.applyPartsImport(ff, { token: pv2.token, allowCreate: false, actor: "qa" });
      check(fresh.ok && (await prisma.part.findUniqueOrThrow({ where: { id: s2.id } })).stock === 50, "Import: after a fresh preview the same file applies", `Fresh import: ${JSON.stringify(fresh)}`);
      // via the server actions
      const fileObj = new File([file1.replace(/CSVNEW-1/g, "CSVNEW-9")], "parts.csv", { type: "text/csv" });
      const pa = await impAct.previewImportAction(null, fd({}));
      const pf = new FormData(); pf.set("file", fileObj);
      const pb = await impAct.previewImportAction(null, pf);
      check(!pa.ok && pb.ok && pb.preview?.counts.create === 1, "Import actions: preview without a file is refused; with a file it returns the plan", `Import actions: ${JSON.stringify([pa.error, pb.preview?.counts])}`);
      const ap = new FormData(); ap.set("csv", pb.preview!.csv); ap.set("token", pb.preview!.token);
      const apRefused = await impAct.applyImportAction(null, ap);
      ap.set("allowCreate", "on");
      const apOk = await impAct.applyImportAction(null, ap);
      check(!apRefused.ok && apOk.ok && (await prisma.part.count({ where: { sku: `${SKU_PREFIX}CSVNEW-9` } })) === 1, "Import actions: apply needs the explicit 'maak nieuwe onderdelen aan' confirmation", `Apply actions: ${JSON.stringify([apRefused, apOk])}`);
      // Reviewer: Dutch Excel saves a plain "CSV" as Windows-1252; read as UTF-8 "Müller" became "M�ller" and was applied as a name change.
      const cp1252 = Buffer.from(`${header}\n${s2.sku};;;;;;;;Müller Onderdelen\n`, "latin1");
      const decoded = ccsv.decodeCsvBytes(cp1252);
      const decodedUtf8 = ccsv.decodeCsvBytes(Buffer.from(`${header}\n${s2.sku};;;;;;;;Müller Onderdelen\n`, "utf8"));
      const damagedPlan = await ccsv.planPartsImport(`${header}\n${s2.sku};;;;;;;;M�ller Onderdelen`);
      check(decoded.encoding === "windows-1252" && decoded.text.includes("Müller") && decodedUtf8.encoding === "utf-8" && decodedUtf8.text.includes("Müller") && damagedPlan.counts.error === 1 && /beschadigd/.test(damagedPlan.rows.find((x) => x.action === "error")?.errors.join() ?? ""), "CSV encoding: a Windows-1252 file is decoded correctly, a UTF-8 file stays UTF-8, and a cell that already holds U+FFFD is refused with a hint", `CSV encoding: ${JSON.stringify([decoded.encoding, decoded.text.slice(-30), decodedUtf8.encoding, damagedPlan.counts])}`);
      const cpForm = new FormData(); cpForm.set("file", new File([cp1252], "excel.csv", { type: "text/csv" }));
      const cpPrev = await impAct.previewImportAction(null, cpForm);
      check(cpPrev.ok && /Windows-1252/.test(cpPrev.preview?.notice ?? "") && (cpPrev.preview?.rows ?? []).some((x) => x.changes.some((c) => c.includes("Müller Onderdelen"))), "Import action: an Excel-ANSI file is previewed with the right characters and a notice that it was read as Windows-1252", `Import cp1252 preview: ${JSON.stringify(cpPrev).slice(0, 300)}`);

      // Reviewer: Part.stock is what can still be SOLD (reserved units are already off it); the pick list compared it with the quantity to pick.
      const pk = await mkOrder({ status: "PAID", qty: 3, stock: 3, invoice: false });
      const pkOpen = await mkOrder({ status: "OPENSTAAND", qty: 2, stock: 5, invoice: false });
      const pl = await q.pickList();
      const prow = pl.skus.find((x) => x.sku === pk.part.sku);
      const reserved = await q.reservedByPart([pk.part.id, pkOpen.part.id]);
      check(prow?.stock === 0 && prow.onShelf === 3 && prow.quantity === 3 && !(prow.onShelf < prow.quantity) && reserved.get(pk.part.id) === 3 && reserved.get(pkOpen.part.id) === 2, "Pick list: Part.stock 0 with 3 reserved for the order to pick is NOT a shortage (on the shelf: 3); reserved units count PAID and OPENSTAAND orders", `Pick list: ${JSON.stringify(prow)} reserved ${JSON.stringify([...reserved])}`);

      // revalidateCatalog is called after every catalogue write (static check; the call itself is a no-op outside Next)
      const src = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
      const calls = ["src/app/admin/_lib/catalog-actions.ts", "src/app/admin/onderdelen/import-actions.ts", "src/app/admin/bestellingen/actions.ts", "src/app/admin/_lib/refund.ts"].map((f) => /revalidateCatalog\(\)/.test(src(f)));
      check(calls.every(Boolean), "revalidateCatalog() is called in the part editor, the CSV import, the order actions and the refund helper", `revalidateCatalog missing in: ${calls}`);
    }

    // ═══ 8. Economics honesty (A3-19, A6-18) ═══════════════════════════════
    {
      // Margin: only QUOTE counts as confirmed.
      const m0 = await eco.shopMargin();
      const quote = await mkOrder({ status: "PAID", qty: 2, price: 121, partExtra: { costEur: 60, costSource: "QUOTE" }, invoice: false });
      const est = await mkOrder({ status: "SHIPPED", qty: 1, price: 121, partExtra: { costEur: 20, costSource: "ESTIMATE" }, invoice: false });
      const unk = await mkOrder({ status: "DELIVERED", qty: 1, price: 121, invoice: false });
      void unk;
      const m1 = await eco.shopMargin();
      const dConf = inv.money(m1.confirmed.marginEur - m0.confirmed.marginEur);
      const dEst = inv.money(m1.estimated.marginEur - m0.estimated.marginEur);
      // QUOTE order: 2 x 121 incl VAT = 242 -> 200 ex VAT, cost 120 -> margin 80. ESTIMATE: 100 - 20 = 80 (kept separate).
      check(dConf === 80 && dEst === 80 && m1.unknownLines - m0.unknownLines === 1, `Margin: the QUOTE order adds 80,00 to the confirmed margin only; the ESTIMATE order adds 80,00 to the 'schatting' figure only; a part without cost counts nowhere`, `Margin split wrong: confirmed +${dConf}, estimated +${dEst}, unknown +${m1.unknownLines - m0.unknownLines}`);
      // The old tile summed Order.costEur: prove it is no longer read anywhere in the admin.
      const adminPage = readFileSync(path.join(ROOT, "src/app/admin/page.tsx"), "utf8");
      const econ = readFileSync(path.join(ROOT, "src/app/admin/_lib/economics.ts"), "utf8");
      check(!/_sum:\s*\{[^}]*costEur|_sum\.costEur/.test(adminPage + econ), "Admin dashboard and economics code do not sum Order.costEur", "Order.costEur is still summed in the admin");
      // Discount spread: a 15% discount order is not reported at full price.
      const disc = inv.computeOrderMargin({ items: [{ unitPriceEur: 121, quantity: 1, costEur: 50, costSource: "QUOTE" }], discountEur: 18.15 });
      check(disc.confirmed.revenueExVatEur === 85 && disc.confirmed.marginEur === 35, "Margin of a discounted order uses the discounted revenue (121 - 15% = 102,85 incl. = 85,00 ex btw)", `Discount margin: ${JSON.stringify(disc.confirmed)}`);

      // Per-SKU contribution, worked by hand: 28,50 incl -> 23,55 ex; cost 12; fee 0,29; shipping 5,95 incl -> 4,92 ex, carrier 6,50 -> -1,58
      const c = eco.skuContribution({ sku: "X", name: "x", priceEur: 28.5, costEur: 12, costSource: "QUOTE" });
      check(c.priceExVatEur === 23.55 && c.paymentFeeEur === 0.29 && c.shippingNetEur === -1.58 && c.contributionEur === 9.68 && !c.negative && c.basis === "QUOTE", `Contribution of 28,50 with cost 12: 23,55 - 12 - 0,29 - 1,58 = ${c.contributionEur}`, `Contribution wrong: ${JSON.stringify(c)}`);
      const neg2 = eco.skuContribution({ sku: "X", name: "x", priceEur: 28.5, costEur: 25, costSource: "ESTIMATE" });
      const free = eco.skuContribution({ sku: "X", name: "x", priceEur: 60, costEur: 30, costSource: "QUOTE" });
      const unknown = eco.skuContribution({ sku: "X", name: "x", priceEur: 60, costEur: null, costSource: null });
      const disc15 = eco.skuContribution({ sku: "X", name: "x", priceEur: 55, costEur: 30, costSource: "QUOTE" }, 0.15);
      check(neg2.negative && neg2.basis === "ESTIMATE" && free.shippingNetEur === -6.5 && unknown.contributionEur === null && !unknown.negative && disc15.shippingNetEur === Math.round((SHIP(55 * 0.85) / 1.21 - 6.5) * 100) / 100, "Contribution: a loss is flagged, free shipping above 50 costs us the carrier, unknown cost gives no figure, the plan discount can push a part under the free-shipping line", `Contribution cases: ${JSON.stringify({ neg2, free, unknown, disc15 })}`);
      function SHIP(gross: number) { return gross >= 50 ? 0 : 5.95; }
      const table = await eco.skuContributionTable();
      check(table.length === (await prisma.part.count()) && table.every((r) => r.atMaxDiscount.contributionEur === null || r.base.contributionEur === null || r.atMaxDiscount.contributionEur <= r.base.contributionEur + 0.5), "Per-SKU table has one row per part", "Per-SKU table incomplete");
      const prices = [0, 1, 2, 3].map((q2i) => eco.planMonthlyExVat((["FREE", "PARTICULIER", "MONTEUR_PRO", "BEDRIJF"] as const)[q2i]));
      check(prices[0] === 0 && prices[1] === 4.12 && prices[2] === 29 && prices[3] === 199, "MRR prices ex btw: consumer plan stripped of 21%, business plans as advertised", `Plan prices ex VAT: ${prices}`);
      const s0 = await eco.subscriptionStats();
      await prisma.user.createMany({ data: [
        { email: `sub1@${DOMAIN}`, plan: "MONTEUR_PRO", stripeSubStatus: "active" },
        { email: `sub2@${DOMAIN}`, plan: "PARTICULIER", stripeSubStatus: "active" },
        { email: `sub3@${DOMAIN}`, plan: "BEDRIJF", stripeSubStatus: "trialing" },
        { email: `sub4@${DOMAIN}`, plan: "MONTEUR_PRO", stripeSubStatus: "past_due" },
        { email: `sub5@${DOMAIN}`, plan: "MONTEUR_PRO", stripeSubStatus: "canceled" },
      ] });
      const s1x = await eco.subscriptionStats();
      check(s1x.active - s0.active === 2 && s1x.trialing - s0.trialing === 1 && s1x.pastDue - s0.pastDue === 1 && inv.money(s1x.mrrExVatEur - s0.mrrExVatEur) === inv.money(29 + 4.12), "Subscription stats: active/trialing/past_due counted from stored statuses, MRR counts only the active ones (29 + 4,12)", `Subscription stats: ${JSON.stringify([s0, s1x])}`);

      // Orders per day (Amsterdam days)
      const d0 = await eco.ordersPerDay(14);
      await mkOrder({ status: "PAID", qty: 1, invoice: false });
      await mkOrder({ status: "PENDING", qty: 1, invoice: false });
      await mkOrder({ status: "PAID", qty: 1, invoice: false, createdAt: new Date(Date.now() - 36 * 3_600_000) });
      const d1 = await eco.ordersPerDay(14);
      const today0 = d0[d0.length - 1], today1 = d1[d1.length - 1];
      check(d1.length === 14 && today1.created - today0.created === 2 && today1.paid - today0.paid === 1 && d1.reduce((s, d) => s + d.created, 0) - d0.reduce((s, d) => s + d.created, 0) === 3, "Orders per day: 14 zero-filled days from the database, created and paid counted separately", `Orders per day: ${JSON.stringify([today0, today1])}`);

      // The definitions, not a re-run of the same query: add one order of each status and look at the DELTAS.
      const c0 = await q.orderCounts();
      const k0 = await eco.openCounts();
      await mkOrder({ status: "PAID", invoice: false, createdAt: new Date(Date.now() - 3 * 86_400_000) });
      await mkOrder({ status: "OPENSTAAND", invoice: false, dueInDays: -1 });
      await mkOrder({ status: "OPENSTAAND", invoice: false, dueInDays: 5 });
      await mkOrder({ status: "SHIPPED", invoice: false });
      await mkOrder({ status: "DELIVERED", invoice: false });
      await mkOrder({ status: "PENDING", invoice: false });
      await mkOrder({ status: "CANCELLED", invoice: false });
      const c1 = await q.orderCounts();
      const k1 = await eco.openCounts();
      const delta = (a: number, b: number) => b - a;
      check(delta(c0["te-verzenden"], c1["te-verzenden"]) === 1 && delta(c0["te-betalen"], c1["te-betalen"]) === 2 && delta(c0.onderweg, c1.onderweg) === 1 && delta(c0.afgerond, c1.afgerond) === 1 && delta(c0.stripe, c1.stripe) === 1 && delta(c0.geannuleerd, c1.geannuleerd) === 1 && delta(c0.alles, c1.alles) === 7 && delta(c0.overdue, c1.overdue) === 1 && delta(c0.shipLate, c1.shipLate) === 1, "Order-desk counts by definition: one order of each status moves exactly its own view (PAID = te verzenden, OPENSTAAND = te betalen, PENDING = wacht op Stripe), overdue and late-to-ship by their rule", `View count deltas: ${JSON.stringify(c1)} vs ${JSON.stringify(c0)}`);
      check(delta(k0.toShip, k1.toShip) === 1 && delta(k0.unpaidInvoices, k1.unpaidInvoices) === 2 && delta(k0.overdueInvoices, k1.overdueInvoices) === 1, "Dashboard open counts by definition: te verzenden = PAID only, openstaande facturen = OPENSTAAND (2 added), achterstallig = past due date (1 added)", `Dashboard deltas: ${JSON.stringify(k1)} vs ${JSON.stringify(k0)}`);

      // Open counts
      const oc = await eco.openCounts();
      check(oc.toShip === (await prisma.order.count({ where: { status: "PAID" } })) && oc.openRma === (await prisma.rmaRequest.count({ where: { status: { in: ["RECEIVED", "APPROVED", "RETURN_RECEIVED"] } } })), `Dashboard counts come from the database (te verzenden ${oc.toShip}, open RMA ${oc.openRma}, aanvragen ${oc.pendingApplications}, reviews ${oc.pendingReviews})`, `Open counts wrong: ${JSON.stringify(oc)}`);
    }

    // ═══ 9. The ledger: invoices CSV reconciles with SQL (critic: VAT) ══════
    {
      // A cancelled-after-paid order (invoice + credit note), a partial refund, an unpaid invoice.
      const a = await mkOrder({ status: "PAID", qty: 2, price: 15.15 });
      await inv.cancelOrder(a.order.id, { reason: "ledger test", actor: "admin" });
      const b = await mkOrder({ status: "DELIVERED", qty: 3, price: 12.34 });
      await inv.recordRefund(b.order.id, { amountEur: 10.01, idempotencyKey: "qa-ledger-1", reason: "deel" });
      await mkOrder({ status: "OPENSTAAND", qty: 1, price: 77.77 });
      const year = inv.amsterdamYear(new Date());
      const { from, to } = eco.periodDates(year, 0);
      const rows = await eco.ledgerRows(from, to);
      const [sql] = await prisma.$queryRaw<{ inv_total: number; inv_vat: number; cn_total: number; cn_vat: number; n_inv: number; n_cn: number }[]>`
        SELECT (SELECT COALESCE(SUM("totalEur"),0) FROM "Invoice" WHERE "year" = ${year})::float8 AS inv_total,
               (SELECT COALESCE(SUM("vatEur"),0) FROM "Invoice" WHERE "year" = ${year})::float8 AS inv_vat,
               (SELECT COALESCE(SUM("totalEur"),0) FROM "CreditNote" WHERE "year" = ${year})::float8 AS cn_total,
               (SELECT COALESCE(SUM("vatEur"),0) FROM "CreditNote" WHERE "year" = ${year})::float8 AS cn_vat,
               (SELECT COUNT(*) FROM "Invoice" WHERE "year" = ${year})::int AS n_inv,
               (SELECT COUNT(*) FROM "CreditNote" WHERE "year" = ${year})::int AS n_cn`;
      const sumTotal = inv.money(rows.reduce((s, r) => s + r.totalEur, 0));
      const sumVat = inv.money(rows.reduce((s, r) => s + r.vatEur, 0));
      check(rows.filter((r) => r.kind === "FACTUUR").length === sql.n_inv && rows.filter((r) => r.kind === "CREDITNOTA").length === sql.n_cn, `Ledger: ${sql.n_inv} invoices and ${sql.n_cn} credit notes in the CSV rows = the row counts in Invoice and CreditNote for ${year}`, "Ledger row counts differ from SQL");
      check(sumTotal === inv.money(sql.inv_total - sql.cn_total) && sumVat === inv.money(sql.inv_vat - sql.cn_vat), `Ledger RECONCILES: sum(total) ${sumTotal} = SELECT sum(Invoice.totalEur) - sum(CreditNote.totalEur) = ${inv.money(sql.inv_total - sql.cn_total)}; sum(vat) ${sumVat} = ${inv.money(sql.inv_vat - sql.cn_vat)}`, `Ledger does NOT reconcile: csv ${sumTotal}/${sumVat} vs sql ${inv.money(sql.inv_total - sql.cn_total)}/${inv.money(sql.inv_vat - sql.cn_vat)}`);
      check(rows.filter((r) => r.kind === "CREDITNOTA").every((r) => r.totalEur < 0 && r.vatEur <= 0 && r.netEur < 0 && r.refersTo.length > 0), "Ledger: credit notes are negative and refer to their invoice number", "Ledger: credit notes not negative");
      check(rows.every((r) => inv.money(r.netEur + r.vatEur) === r.totalEur), "Ledger: net + VAT = total on every row", "Ledger: net + vat != total on a row");
      const quarters = await eco.vatByQuarter(year);
      check(quarters.length === 4 && inv.money(quarters.reduce((s, x) => s + x.vatPayableEur, 0)) === sumVat && inv.money(quarters.reduce((s, x) => s + x.grossEur, 0)) === sumTotal, "Quarter VAT overview adds up to the same figures as the ledger and SQL (invoiced VAT minus credited VAT)", `Quarter overview: ${quarters.map((x) => x.vatPayableEur)} vs ${sumVat}`);
      const csvText = csv.toCsv(["type", "nummer", "datum", "bestelling", "netto", "btw", "totaal", "status", "verwijst_naar"], rows.map((r) => [r.kind, r.number, r.date, r.orderRef, r.netEur, r.vatEur, r.totalEur, r.status, r.refersTo]));
      const reparsed = csv.parseCsv(csvText);
      const csvSum = inv.money(reparsed.rows.reduce((s, r) => s + (csv.parseMoney(r[6]) ?? NaN), 0));
      check(csvSum === sumTotal && reparsed.rows.every((r) => !r[6].startsWith("'")), "Ledger CSV text: the 'totaal' column, read back, sums to the same figure and negative amounts are not mangled by the injection guard", `Ledger CSV sum ${csvSum} vs ${sumTotal}`);
      // Amsterdam clock: 2998-12-31 23:30 UTC is already 2999-01-01 in Amsterdam.
      const odd = await mkOrder({ status: "PAID", qty: 1, price: 50, invoice: false });
      const oddInvoice = await prisma.invoice.create({
        data: { number: "2999-00001", year: 2999, orderId: odd.order.id, issuedAt: new Date("2998-12-31T23:30:00Z"), subtotalEur: 50, vatRate: 0.21, vatEur: 8.68, totalEur: 50, sellerJson: "{}", buyerJson: "{}", linesJson: "[]" },
      });
      await prisma.creditNote.create({
        data: { number: "CN-2999-00001", year: 2999, invoiceId: oddInvoice.id, issuedAt: new Date("2999-03-31T22:30:00Z"), reason: "boundary", subtotalEur: 20, vatRate: 0.21, vatEur: 3.47, totalEur: 23.47, sellerJson: "{}", buyerJson: "{}", linesJson: "[]" },
      });
      const q2999 = await eco.vatByQuarter(2999);
      const q2998 = await eco.vatByQuarter(2998);
      // The credit note at 22:30 UTC on 31 March is 00:30 on 1 April in Amsterdam (DST): it belongs to Q2.
      check(q2999[0].invoices === 1 && q2999[0].invoicedVatEur === 8.68 && q2999[0].creditNotes === 0 && q2999[1].creditNotes === 1 && q2999[1].creditedVatEur === 3.47 && q2998.every((x) => x.invoices === 0), "Amsterdam clock: an invoice at 23:30 UTC on 31 Dec lands in Q1 of the NEXT year and a credit note at 22:30 UTC on 31 March lands in Q2 (summer time)", `Amsterdam boundary: ${JSON.stringify([q2999[0], q2999[1], q2998.map((x) => x.invoices)])}`);
      const edge = await eco.ledgerRows("2999-01-01", "2999-01-01");
      check(edge.length === 1 && edge[0].number === "2999-00001" && edge[0].date === "2999-01-01", "Ledger date filter uses the Amsterdam date as well", `Ledger edge: ${JSON.stringify(edge)}`);
    }

    // ═══ 10. CLI without Clerk ═════════════════════════════════════════════
    {
      const o = await mkOrder({ status: "OPENSTAAND", qty: 1, price: 34.45, email: `cli@${DOMAIN}` });
      const number = (await invoiceOf(o.order.id)).number;
      // spawnSync blocks this process, so the fake Slack/Resend servers cannot answer: the child runs without those channels.
      const childEnv = { ...process.env, SLACK_WEBHOOK_URL: "", RESEND_API_KEY: "", ORDER_NOTIFY_EMAIL: "" };
      const run = (...args: string[]) => spawnSync("npx", ["tsx", "scripts/orders.ts", ...args], { cwd: ROOT, encoding: "utf8", env: childEnv });
      const list = run("list");
      check(list.status === 0 && list.stdout.includes(st.orderRef(o.order.id)) && list.stdout.includes(number), `CLI list shows the open order (#${st.orderRef(o.order.id)}, ${number})`, `CLI list: ${list.stdout.slice(0, 300)} ${list.stderr.slice(0, 200)}`);
      const wrong = run("paid", number, "34,44");
      check(wrong.status === 1 && /komt niet overeen/.test(wrong.stderr) && (await row(o.order.id)).status === "OPENSTAAND", `CLI paid with one cent off: exit 1, the domain error is printed, nothing changed ("${wrong.stderr.trim()}")`, `CLI wrong amount: ${wrong.status} ${wrong.stderr} ${wrong.stdout}`);
      const none = run("paid", number);
      check(none.status === 1 && (await row(o.order.id)).status === "OPENSTAAND", "CLI paid without an amount: refused", `CLI no amount: ${none.status}`);
      const right = run("paid", number, "34,45");
      check(right.status === 0 && (await row(o.order.id)).status === "PAID", "CLI paid with the exact amount: order is PAID", `CLI right amount: ${right.status} ${right.stderr} ${right.stdout}`);
      // The full id: two orders created within a few milliseconds of each other can share the 8-character order number (seen in this very suite).
      const ship = run("ship", o.order.id, "dhl", "JVGL0000QA1");
      check(ship.status === 0 && (await row(o.order.id)).status === "SHIPPED", "CLI ship marks the order shipped", `CLI ship: ${ship.status} ${ship.stderr}`);
      const amb = run("paid", "zzzzzzzz", "1,00");
      check(amb.status === 1 && /Geen bestelling/.test(amb.stderr), "CLI: unknown reference is an error", `CLI unknown: ${amb.stderr}`);
    }

    // ═══ 11. Analytics page: nothing invented ═══════════════════════════════
    {
      // Comments may mention what was removed; only code counts.
      const client = readFileSync(path.join(ROOT, "src/app/admin/analytics/client.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      check(!/1247|4231|426\.78|DEMO\b|\+12%|\+18%|NEXT_PUBLIC_POSTHOG_KEY/.test(client), "Analytics: the hard-coded visitors/revenue numbers, the fixed deltas and the PostHog-key check are gone from the page", "Analytics page still contains invented numbers or the PostHog flag");
      check(/analytics-notice/.test(client) && !/posthogConnected/.test(client), "Analytics: the 'not connected' notice is unconditional", "Analytics notice depends on a flag");
    }

    // ═══ 12. Amount fields, pages that used to show invented numbers ═══════
    {
      // Behaviour, not a regex over the source: render the shared Field the way the monteur work-order form uses it.
      const React = await import("react");
      const { renderToStaticMarkup } = await import("react-dom/server");
      const { Field } = await import("../src/app/monteur/_lib/forms");
      const html = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(Field, { label: "Prijs", name: "priceEur", ...props } as never));
      const bare = html({ type: "number" }); // workorder-forms.tsx: <Field name="priceEur" type="number" />
      const whole = html({ type: "number", step: "1", min: "0" });
      const dec = html({ type: "decimal" });
      check(!/type="number"/.test(bare) && /type="text"/.test(bare) && /inputMode="decimal"/.test(bare) && /pattern="/.test(bare) && /type="number"/.test(whole) && /step="1"/.test(whole) && !/inputMode/.test(whole) && /type="text"/.test(dec), "BEFORE/AFTER reviewer: the work-order price Field (type=number, no step) now renders a decimal TEXT input, so an en-US browser cannot read '89,50' as 8950; whole-number fields with step=1 stay type=number", `Field markup: bare ${bare} | whole ${whole}`);

      const aiq = readFileSync(path.join(ROOT, "src/app/admin/ai-quality/page.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      check(!/2147|87\.4|\b612\b|28\.5|topAccurate|topMismatches|PostHog/.test(aiq) && /prisma\.diagnosisFeedback/.test(aiq), "AI-kwaliteit page: the invented 2.147 diagnoses / 87,4% accuracy / per-code tables are gone; the figures come from Diagnosis and DiagnosisFeedback", "AI-kwaliteit page still contains invented numbers");

      // ── Optional browser run: QA_BASE_URL=http://localhost:3203 (dev server in demo mode, so every visitor is the superadmin) ──
      const base = process.env.QA_BASE_URL;
      if (base) {
        // Playwright is installed globally on this machine, not in the project: no types, so keep it loose.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pw = (await import("/opt/node22/lib/node_modules/playwright/index.js" as string)).default as any;
        const browser = await pw.chromium.launch();
        try {
          const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "en-US" });
          const page = await ctx.newPage();
          const consoleErrors: string[] = [];
          // The CSP report-only notice is the app's own header policy, not a page error.
          page.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error" && !/favicon|Failed to load resource|report-only policy/.test(m.text())) consoleErrors.push(`${page.url()} ${m.text().slice(0, 120)}`); });
          page.on("pageerror", (e: unknown) => consoleErrors.push(`${page.url()} ${String(e).slice(0, 120)}`));
          const pages = ["/admin", "/admin/bestellingen", "/admin/bestellingen/pick", "/admin/retouren", "/admin/onderdelen", "/admin/economie", "/admin/analytics", "/admin/analytics/connect-gsc", "/admin/gebruikers", "/admin/gidsen", "/admin/foutcodes", "/admin/ai-quality"];
          // First pass only compiles the pages (a dev server answers a cold route while it is still building it); the second pass is measured.
          for (const url of pages) await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
          consoleErrors.length = 0;
          const wide: string[] = [];
          for (const url of pages) {
            const res = await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
            const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
            if (!res || res.status() !== 200 || w.sw > w.cw) wide.push(`${url} status ${res?.status()} scrollWidth ${w.sw}/${w.cw}`);
          }
          check(wide.length === 0, `Browser 375 px: ${pages.length} admin pages load and none scrolls sideways (including gebruikers, gidsen, foutcodes, connect-gsc, ai-quality)`, `Browser 375 px overflow: ${wide.join(" | ")}`);
          check(consoleErrors.length === 0, "Browser: no console or page errors on those admin pages (second, warm pass)", `Console errors: ${consoleErrors.slice(0, 3).join(" | ")}`);
          const hostile = [];
          for (const url of ["/admin/bestellingen?page=99999999999999999999", "/admin/bestellingen?q=ab%00cd", "/admin/bestellingen?view=alles&page=-5"]) hostile.push((await page.goto(`${base}${url}`))?.status());
          check(hostile.every((c) => c === 200), `Browser: hostile order-desk URLs answer 200 (${hostile.join(", ")})`, `Hostile URLs: ${hostile}`);

          // en-US Chromium: type '89,50' with the keyboard into the monteur work-order price and into the admin part price.
          const typed = async (url: string, trigger: RegExp, field: string, text: string) => {
            await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
            // The dialog trigger only works after hydration: click until the dialog is open.
            for (let attempt = 0; attempt < 5 && (await page.locator("dialog[open]").count()) === 0; attempt++) {
              await page.getByRole("button", { name: trigger }).first().click();
              await page.waitForTimeout(400);
            }
            const input = page.locator(`dialog[open] input[name="${field}"]`).first();
            await input.pressSequentially(text);
            return input.evaluate((el: HTMLInputElement) => ({ type: el.type, value: el.value, valid: el.checkValidity() }));
          };
          const wo = await typed("/monteur/werkorders", /werkorder/i, "priceEur", "89,50").catch((e) => ({ type: "error", value: String(e).slice(0, 100), valid: false }));
          const part = await typed("/admin/onderdelen", /nieuw onderdeel/i, "priceEur", "89,50").catch((e) => ({ type: "error", value: String(e).slice(0, 100), valid: false }));
          check(wo.type === "text" && wo.value === "89,50" && wo.valid && part.type === "text" && part.value === "89,50" && part.valid, "Browser en-US: typing '89,50' in the monteur work-order price and the admin part price keeps the text '89,50' and is valid (before: the work-order field read it as 8950)", `en-US comma: work order ${JSON.stringify(wo)} part ${JSON.stringify(part)}`);

          const idx = async (qs: string) => (await (await fetch(`${base}/retour/start${qs}`)).text());
          const withTok = await idx("?order=abc12345&t=SECRETTOKEN123");
          const without = await idx("?order=abc12345");
          const robots = (h: string) => /<meta name="robots" content="[^"]*noindex/.test(h);
          check(robots(withTok) && !robots(without), "/retour/start?t=<token> sends noindex (D2); without a token the page stays indexable", `retour/start robots: with token ${robots(withTok)}, without ${robots(without)}`);
          await ctx.close();
        } finally {
          await browser.close();
        }
      }
    }

    // ── Report ──────────────────────────────────────────────────────────────
    console.log(log.join("\n"));
    const failed = log.filter((l) => l.startsWith("❌")).length;
    console.log(`\n${log.length - failed}/${log.length} checks passed`);
    process.exitCode = failed > 0 ? 1 : 0;
  } finally {
    await cleanup().catch((e) => console.error("cleanup failed", e));
    stripeLib._setStripeForTests(null);
    await fake.close();
    await prisma.$disconnect();
    slack.close();
    resendFake.close();
  }
}

main().catch((err) => {
  console.error(log.join("\n"));
  console.error("qa-admin crashed:", err);
  process.exit(1);
});
