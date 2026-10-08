/**
 * Stripe: webhook, subscriptions, refunds, dunning, erasure, readiness.
 *
 * Drives the REAL route handlers (webhook, subscribe, portal, account/delete)
 * and the real libraries against a real Postgres, with a local fake Stripe
 * (scripts/lib/fake-stripe.ts), a fake Resend (RESEND_BASE_URL) and a fake
 * Slack standing in for the three outside services. No network, no keys.
 *
 * Several scenarios run in separate processes because the environment decides
 * behaviour at import time:
 *   main            development mode, Stripe configured (most checks)
 *   prod            NODE_ENV=production + DEMO_MODE=true (as wasfix.nl runs), Stripe
 *                   configured, company details set: erasure and the subscribe guard
 *   prod-nostripe   NODE_ENV=production + DEMO_MODE=true, NO Stripe keys
 *   prod-nocompany  NODE_ENV=production, Stripe configured, no company details
 *   nosecret        Stripe key but no STRIPE_WEBHOOK_SECRET
 *
 * Usage: DATABASE_URL=postgresql://... npx tsx scripts/qa-stripe.ts
 *        QA_STRIPE_SCENARIO=prod DATABASE_URL=... NODE_ENV=production npx tsx scripts/qa-stripe.ts   (one scenario)
 * Set QA_STRIPE_VERBOSE=1 to see the application's own log lines.
 */
import http from "node:http";
import path from "node:path";
import Module from "node:module";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { PrismaClient } from "@prisma/client";
import type { NextRequest as NextRequestType } from "next/server";
import { startFakeStripe, makeEvent, type FakeStripe, type Json } from "./lib/fake-stripe";

const SCENARIO = process.env.QA_STRIPE_SCENARIO ?? "";
const repo = path.resolve(__dirname, "..");
const DOMAIN = "qa-stripe.test";
const SKU_PREFIX = "QA-STR-";
const WH_SECRET = "whsec_qa_stripe_secret_0123456789";
const APP = "https://qa.wasfix.example";
const PRICES = { PARTICULIER: "price_qa_particulier", MONTEUR_PRO: "price_qa_monteur", BEDRIJF: "price_qa_bedrijf" } as const;

const lines: string[] = [];
let failures = 0;
const check = (cond: boolean, ok: string, bad: string) => {
  if (!cond) failures += 1;
  lines.push(cond ? `✅ ${ok}` : `❌ ${bad}`);
};

/** Event types for which a check proved a real effect (not just "answered 200"); asserted complete at the end of the main scenario. */
const proved = new Set<string>();
const checkEvent = (types: string[], cond: boolean, ok: string, bad: string) => {
  if (cond) types.forEach((t) => proved.add(t));
  check(cond, ok, bad);
};

function listen(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });
}

const cents = (eur: number) => Math.round(eur * 100);
const nowSec = () => Math.floor(Date.now() / 1000);

async function runScenario(scenario: string) {
  // ── Outside services ───────────────────────────────────────────────────
  const slackBodies: string[] = [];
  const slackState = { fail: false };
  const slack = await listen((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      slackBodies.push(body);
      res.statusCode = slackState.fail ? 500 : 200;
      res.end("ok");
    });
  });
  const mails: Array<{ to: string; subject: string; html: string; text: string }> = [];
  const resend = await listen((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const m = JSON.parse(body);
        mails.push({ to: Array.isArray(m.to) ? m.to.join(",") : String(m.to), subject: String(m.subject), html: String(m.html), text: String(m.text ?? "") });
      } catch {
        /* ignore */
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: `em_${mails.length}` }));
    });
  });
  const fake: FakeStripe = await startFakeStripe();

  process.env.SLACK_WEBHOOK_URL = slack.url;
  delete process.env.DISCORD_WEBHOOK_URL;
  delete process.env.ORDER_NOTIFY_EMAIL;
  process.env.RESEND_API_KEY = "re_qa_fake_key";
  process.env.RESEND_BASE_URL = resend.url;
  process.env.NEXT_PUBLIC_APP_URL = APP;
  const withStripe = scenario !== "prod-nostripe";
  if (withStripe) {
    process.env.STRIPE_SECRET_KEY = "sk_test_fakefakefakefake";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_fakefakefakefake";
    process.env.STRIPE_PRICE_PARTICULIER = PRICES.PARTICULIER;
    process.env.STRIPE_PRICE_MONTEUR = PRICES.MONTEUR_PRO;
    if (scenario === "main") process.env.STRIPE_PRICE_BEDRIJF = PRICES.BEDRIJF;
    else delete process.env.STRIPE_PRICE_BEDRIJF; // prod scenarios: a plan without a price must refuse, not grant
    if (scenario === "nosecret") delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = WH_SECRET;
  } else {
    for (const k of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_PRICE_PARTICULIER", "STRIPE_PRICE_MONTEUR", "STRIPE_PRICE_BEDRIJF"]) delete process.env[k];
  }

  // ── Patch module loading: no server-only, a signed-in user, a counted revalidateTag ──
  let currentUser: { id: string; email: string; name: string; role: string; plan: string } | null = null;
  let revalidateCalls = 0;
  const M = Module as unknown as { _load: (...a: unknown[]) => unknown; _resolveFilename: (...a: unknown[]) => string };
  const origLoad = M._load;
  const authPath = path.join(repo, "src/lib/auth.ts");
  M._load = function patched(this: unknown, ...args: unknown[]) {
    const [request, parent, isMain] = args as [string, unknown, boolean];
    if (request === "server-only") return {};
    if (request === "next/cache") {
      const real = origLoad.apply(this, args) as Record<string, unknown>;
      return { ...real, revalidateTag: () => { revalidateCalls += 1; } };
    }
    let resolved: string | undefined;
    try {
      resolved = M._resolveFilename(request, parent, isMain);
    } catch {
      /* not resolvable here */
    }
    if (resolved === authPath) {
      const real = origLoad.apply(this, args) as Record<string, unknown>;
      return { ...real, getCurrentUser: async () => currentUser };
    }
    return origLoad.apply(this, args);
  };

  // Quiet the application's own log lines (they include expected errors).
  if (!process.env.QA_STRIPE_VERBOSE) {
    for (const k of ["log", "info", "warn", "error", "debug"] as const) (console as unknown as Record<string, () => void>)[k] = () => undefined;
  }

  const { NextRequest } = (await import("next/server")) as { NextRequest: typeof NextRequestType };
  const { prisma } = (await import("../src/lib/prisma")) as { prisma: PrismaClient };
  const stripeLib = await import("../src/lib/stripe");
  const inv = await import("../src/lib/invoicing");
  const sub = await import("../src/lib/subscription");
  const events = await import("../src/lib/stripe-events");
  const readiness = await import("../src/lib/stripe-readiness");
  const plans = await import("../src/lib/plans");
  const notify = await import("../src/lib/notify");
  const lease = await import("../src/app/api/stripe/_lib/lease");
  const subsLib = await import("../src/app/api/stripe/_lib/subscriptions");
  const webhook = await import("../src/app/api/stripe/webhook/route");
  const subscribeRoute = await import("../src/app/api/stripe/subscribe/route");
  const portalRoute = await import("../src/app/api/stripe/portal/route");
  const deleteRoute = await import("../src/app/api/account/delete/route");
  const { env } = await import("../src/lib/env");
  const { isDemoMode } = await import("../src/lib/demo-mode");
  if (withStripe) stripeLib._setStripeForTests(fake.client());

  // ── Fixtures ───────────────────────────────────────────────────────────
  // Every user this run creates. An erased account keeps an anonymised address
  // (deleted-<id>@anon.wasfix.nl), so matching on the test domain alone left one
  // such row behind per erasure test, run after run.
  const createdUserIds = new Set<string>();
  const cleanup = async () => {
    const byDomain = await prisma.user.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { id: true } });
    const orders = await prisma.order.findMany({
      where: { OR: [{ email: { endsWith: `@${DOMAIN}` } }, { items: { some: { part: { sku: { startsWith: SKU_PREFIX } } } } }, { userId: { in: [...createdUserIds] } }] },
      select: { id: true, userId: true },
    });
    const userIds = [...new Set([...byDomain.map((u) => u.id), ...orders.map((o) => o.userId), ...createdUserIds])];
    const ids = orders.map((o) => o.id);
    await prisma.creditNote.deleteMany({ where: { invoice: { orderId: { in: ids } } } });
    await prisma.invoice.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { id: { in: ids } } });
    await prisma.part.deleteMany({ where: { sku: { startsWith: SKU_PREFIX } } });
    await prisma.referral.deleteMany({ where: { referrerId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.stripeEvent.deleteMany({
      where: {
        OR: [
          { stripeEventId: { startsWith: "evt_fake_" } },
          { stripeEventId: { startsWith: "evt_qa_" } },
          // markers (see lease.ts) of the orders this run created
          ...ids.flatMap((id) => [{ stripeEventId: `mail:order-paid:${id}` }, { stripeEventId: { startsWith: `reconcile-rejected:${id}:` } }]),
        ],
      },
    });
    // Test database: rewind the series to the highest number that still exists, as if the test documents had never been issued.
    for (const { year } of await prisma.creditNoteSequence.findMany()) {
      const rows = await prisma.creditNote.findMany({ where: { year }, select: { number: true } });
      await prisma.creditNoteSequence.update({ where: { year }, data: { last: rows.reduce((m, r) => Math.max(m, Number(r.number.slice(-5))), 0) } });
    }
    for (const { year } of await prisma.invoiceSequence.findMany()) {
      const rows = await prisma.invoice.findMany({ where: { year }, select: { number: true } });
      await prisma.invoiceSequence.update({ where: { year }, data: { last: rows.reduce((m, r) => Math.max(m, Number(r.number.slice(-5))), 0) } });
    }
  };

  let n = 0;
  let evCount = 0;
  const evId = () => `evt_qa_${Date.now().toString(36)}_${++evCount}`;
  const mkUser = async (extra: Record<string, unknown> = {}) => {
    const i = ++n;
    const created = await prisma.user.create({ data: { email: `u${Date.now().toString(36)}${i}@${DOMAIN}`, name: "QA Klant", ...extra } });
    createdUserIds.add(created.id);
    return created;
  };
  const signIn = (u: { id: string; email: string; plan?: string; role?: string } | null) => {
    currentUser = u ? { id: u.id, email: u.email, name: "QA Klant", role: u.role ?? "CONSUMER", plan: u.plan ?? "FREE" } : null;
  };
  const mkPart = (stock: number, price = 10.15) =>
    prisma.part.create({ data: { sku: `${SKU_PREFIX}${Date.now().toString(36)}-${++n}`, name: `QA onderdeel ${n}`, brand: "QA", category: "OTHER", priceEur: price, stock } });

  async function mkOrder(o: { status?: string; qty?: number; price?: number; stock?: number; part?: { id: string; priceEur: number }; userId?: string; stripePaymentId?: string | null; pi?: string | null; createdAt?: Date; shipping?: number } = {}) {
    const qty = o.qty ?? 2;
    const part = o.part ?? (await mkPart(o.stock ?? 5, o.price ?? 10.15));
    const goods = inv.money(part.priceEur * qty);
    const shipping = o.shipping ?? 5.95;
    const total = inv.money(goods + shipping);
    const vat = inv.splitVatInclusive(total);
    const userId = o.userId ?? (await mkUser()).id;
    const order = await prisma.order.create({
      data: {
        userId,
        email: `buyer${++n}@${DOMAIN}`,
        status: o.status ?? "PENDING",
        paymentMethod: "STRIPE",
        subtotalEur: goods,
        shippingEur: shipping,
        totalEur: total,
        vatRate: vat.vatRate,
        vatEur: vat.vatEur,
        accessToken: inv.newAccessToken(),
        stripePaymentId: o.stripePaymentId === undefined ? null : o.stripePaymentId,
        stripePaymentIntentId: o.pi ?? null,
        createdAt: o.createdAt,
        shippingAddress: JSON.stringify({ name: "Piet Jansen", street: "Teststraat", houseNumber: "1", postalCode: "1011 AB", city: "Amsterdam" }),
        items: { create: [{ partId: part.id, quantity: qty, unitPrice: part.priceEur }] },
      },
    });
    return { order, part, qty, total, stockNow: async () => (await prisma.part.findUniqueOrThrow({ where: { id: part.id } })).stock };
  }
  const orderOf = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
  const userOf = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });
  const invoiceCount = (orderId: string) => prisma.invoice.count({ where: { orderId } });
  const slackText = (from: number) => slackBodies.slice(from).join("\n");
  const mailsTo = (to: string) => mails.filter((m) => m.to === to);

  const sessionFor = (order: { id: string; totalEur: number }, o: Json = {}): Json => ({
    id: `cs_test_qa_${order.id}`,
    object: "checkout.session",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    amount_total: cents(order.totalEur),
    currency: "eur",
    payment_intent: `pi_qa_${order.id}`,
    customer: null,
    metadata: { orderId: order.id },
    ...o,
  });

  async function deliver(event: Json, o: { secret?: string; timestamp?: number; noSig?: boolean; header?: string } = {}) {
    const { body, header } = fake.signedEvent(o.secret ?? WH_SECRET, event, o.timestamp);
    const req = new NextRequest("http://localhost/api/stripe/webhook", {
      method: "POST",
      body,
      headers: o.noSig ? { "content-type": "application/json" } : { "content-type": "application/json", "stripe-signature": o.header ?? header },
    });
    const res = await webhook.POST(req);
    const text = await res.text();
    let json: Json = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* plain text answer */
    }
    return { status: res.status, json, text };
  }
  const post = (route: { POST: (req: NextRequestType) => Promise<Response> }, url: string, body: unknown) =>
    route.POST(new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${(++n % 250) + 1}` } }));

  const prices = () => {
    for (const plan of plans.BILLABLE_PLANS) {
      const cfg = plans.PLANS[plan];
      fake.state.prices[PRICES[plan as keyof typeof PRICES]] = {
        id: PRICES[plan as keyof typeof PRICES],
        object: "price",
        active: true,
        unit_amount: cfg.priceCents,
        currency: "eur",
        recurring: { interval: "month", interval_count: 1 },
        tax_behavior: sub.expectedTaxBehavior(cfg),
      };
    }
  };
  const resetFake = () => {
    fake.reset();
    prices();
  };
  prices();
  const T = `[${scenario}]`;

  await cleanup();
  try {
    if (scenario === "main") await mainScenario();
    else if (scenario === "prod") await prodScenario();
    else if (scenario === "prod-nostripe") await noStripeScenario();
    else if (scenario === "prod-nocompany") await noCompanyScenario();
    else if (scenario === "nosecret") await noSecretScenario();
  } finally {
    await cleanup().catch((e) => lines.push(`⚠️ cleanup failed: ${e instanceof Error ? e.message : e}`));
    await prisma.$disconnect();
    await fake.close();
    slack.server.close();
    resend.server.close();
  }

  // ═══════════════════════════════════════════════════════════════════════
  async function mainScenario() {
    // ── 0. Event list ───────────────────────────────────────────────────
    const required = ["checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed", "charge.refunded", "charge.dispute.created"];
    check(required.every((t) => (events.HANDLED_STRIPE_EVENTS as readonly string[]).includes(t)), `Events: the list covers all ${required.length} required types`, "Events: a required type is missing from HANDLED_STRIPE_EVENTS");
    check(events.missingWebhookEvents([...events.HANDLED_STRIPE_EVENTS]).length === 0 && events.missingWebhookEvents(["*"]).length === 0 && events.missingWebhookEvents(["invoice.paid"]).length === events.HANDLED_STRIPE_EVENTS.length - 1, "Events: missingWebhookEvents reports exactly what an endpoint lacks ('*' covers all)", "Events: missingWebhookEvents is wrong");
    // Every listed type has a case in the dispatcher: a minimal valid event must be acknowledged, never answered with the "no handler" error.
    {
      const empty: Record<string, Json> = {
        "customer.subscription.created": { id: "sub_qa_none", customer: "cus_qa_none", metadata: {}, status: "active", items: { data: [] } },
        "customer.subscription.updated": { id: "sub_qa_none", customer: "cus_qa_none", metadata: {}, status: "active", items: { data: [] } },
        "customer.subscription.deleted": { id: "sub_qa_none", customer: "cus_qa_none", metadata: {}, status: "canceled", items: { data: [] } },
        "invoice.paid": { id: "in_qa", customer: "cus_qa_none", subscription: null },
        "invoice.payment_failed": { id: "in_qa", customer: "cus_qa_none", subscription: null },
        "charge.refunded": { id: "ch_qa_none", payment_intent: null },
        "charge.dispute.created": { id: "dp_qa_none", amount: 100, currency: "eur", reason: "general", payment_intent: null, evidence_details: { due_by: nowSec() + 86400 } },
      };
      const bad: string[] = [];
      for (const type of events.HANDLED_STRIPE_EVENTS) {
        const obj = empty[type] ?? { id: "cs_test_qa_empty", object: "checkout.session", mode: "payment", metadata: {}, payment_status: "unpaid" };
        const r = await deliver(makeEvent(type, obj, { id: evId() }));
        if (r.status !== 200) bad.push(`${type}:${r.status}`);
      }
      check(bad.length === 0, `Dispatcher: all ${events.HANDLED_STRIPE_EVENTS.length} listed event types are acknowledged for a minimal payload (no "no handler" error; the real effect of each type is proved by its own check, see the last check of this scenario)`, `Dispatcher: unhandled or failing types ${bad.join(", ")}`);
    }

    // ── 1. Signature, replay window, unknown types ──────────────────────
    {
      const ev = makeEvent("checkout.session.completed", { id: "cs_x", metadata: {}, mode: "payment", payment_status: "unpaid" }, { id: evId() });
      const noSig = await deliver(ev, { noSig: true });
      const wrong = await deliver(ev, { secret: "whsec_someone_else" });
      const old = await deliver(ev, { timestamp: nowSec() - 3600 });
      const rows = await prisma.stripeEvent.count({ where: { stripeEventId: ev.id } });
      check(noSig.status === 400 && wrong.status === 400 && old.status === 400 && rows === 0, "Signature: missing, wrong-secret and one-hour-old (replayed) signatures are refused (400) and leave no claim", `Signature: noSig ${noSig.status}, wrong ${wrong.status}, old ${old.status}, rows ${rows}`);
      const unknown = await deliver(makeEvent("payment_method.attached", { id: "pm_x" }, { id: evId() }));
      check(unknown.status === 200 && unknown.json.ignored === true, "Unknown event type: acknowledged with 200 and flagged as ignored", `Unknown type answered ${unknown.status} ${unknown.text}`);
    }

    // ── 2. A paid order ─────────────────────────────────────────────────
    const o1 = await mkOrder({ qty: 2, stock: 5 });
    const buyer1 = o1.order.email;
    {
      const mark = slackBodies.length;
      const before = revalidateCalls;
      const ev = makeEvent("checkout.session.completed", sessionFor(o1.order), { id: evId() });
      const r = await deliver(ev);
      const row = await orderOf(o1.order.id);
      const evRow = await prisma.stripeEvent.findUniqueOrThrow({ where: { stripeEventId: ev.id } });
      checkEvent(["checkout.session.completed"], r.status === 200 && row.status === "PAID" && row.paidAt !== null && row.stripePaymentId === `cs_test_qa_${o1.order.id}`, "Paid order: PENDING -> PAID with paidAt and the session id", `Paid order wrong: ${r.status} ${row.status}`);
      check(row.stripePaymentIntentId === `pi_qa_${o1.order.id}`, "Paid order: the payment intent is stored (refunds and disputes find the order by it)", `Payment intent not stored: ${row.stripePaymentIntentId}`);
      check((await o1.stockNow()) === 3 && (await invoiceCount(o1.order.id)) === 1, "Paid order: stock 5 -> 3 and one invoice", `Stock/invoice wrong: ${await o1.stockNow()} / ${await invoiceCount(o1.order.id)}`);
      check(evRow.completedAt !== null && evRow.attempts === 1 && evRow.lastError === null, "Lease: the event is completed after success (attempts 1, no error)", `Lease row wrong: ${JSON.stringify(evRow)}`);
      check(revalidateCalls > before, "Catalogue cache: revalidateCatalog() is called after the stock changed", "Catalogue cache: not revalidated after a stock change");
      const mail = mailsTo(buyer1);
      const invoice = await inv.getInvoiceForOrder(o1.order.id);
      check(mail.length === 1 && mail[0].html.includes(`t=${row.accessToken}`) && !!invoice && mail[0].html.includes(invoice.number), "Confirmation: exactly one mail to the buyer, with the invoice number and the guest link", `Confirmation mail wrong: ${mail.length} mails`);
      const s = slackText(mark);
      check(/Betaling ontvangen/.test(s) && s.includes(o1.order.id.slice(0, 8).toUpperCase()) && !s.includes(buyer1) && !s.includes("Piet"), "Owner: told about the payment with the order number, no customer data", `Owner message wrong: ${s.slice(0, 200)}`);

      // duplicate delivery of the same event
      const mailsBefore = mails.length;
      const dup = await deliver(ev);
      check(dup.status === 200 && dup.json.alreadyProcessed === true && (await o1.stockNow()) === 3 && (await invoiceCount(o1.order.id)) === 1 && mails.length === mailsBefore, "Duplicate: a completed event is a no-op (no stock, invoice or mail)", `Duplicate not a no-op: ${dup.status} ${dup.text}`);
      // the same payment announced by a different event
      const again = await deliver(makeEvent("checkout.session.async_payment_succeeded", sessionFor(o1.order), { id: evId() }));
      check(again.status === 200 && (await o1.stockNow()) === 3 && (await invoiceCount(o1.order.id)) === 1 && mails.length === mailsBefore, "Same payment, other event: still one decrement, one invoice, one mail", `Second event for one payment booked twice: stock ${await o1.stockNow()}, mails +${mails.length - mailsBefore}`);
    }

    // ── 3. Payments that must not be booked ─────────────────────────────
    {
      const o = await mkOrder({ qty: 1, stock: 5 });
      const mark = slackBodies.length;
      const r = await deliver(makeEvent("checkout.session.completed", sessionFor(o.order, { amount_total: 1, currency: "usd" }), { id: evId() }));
      const row = await orderOf(o.order.id);
      check(r.status === 200 && row.status === "PENDING" && (await invoiceCount(o.order.id)) === 0 && (await o.stockNow()) === 5 && /niet overeen/.test(slackText(mark)), "Amount/currency: 1 cent in USD for a €16 order is not booked, no invoice, owner told, still acknowledged (200)", `Wrong amount booked or 500: ${r.status} ${row.status}`);
      const mark2 = slackBodies.length;
      const r2 = await deliver(makeEvent("checkout.session.completed", sessionFor(o.order, { currency: "usd" }), { id: evId() }));
      check(r2.status === 200 && (await orderOf(o.order.id)).status === "PENDING" && /niet overeen/.test(slackText(mark2)), "Currency: the right amount in USD is refused too", `USD booked: ${r2.status}`);
    }
    {
      const o = await mkOrder({ qty: 1, stock: 5, status: "CANCELLED" });
      const mark = slackBodies.length;
      const r = await deliver(makeEvent("checkout.session.completed", sessionFor(o.order), { id: evId() }));
      check(r.status === 200 && (await orderOf(o.order.id)).status === "CANCELLED" && (await invoiceCount(o.order.id)) === 0 && /geannuleerde bestelling/.test(slackText(mark)), "Cancelled order paid: no invoice, stays CANCELLED, owner told to refund, acknowledged", `Cancelled order mishandled: ${r.status}`);
    }
    {
      const mark = slackBodies.length;
      const r = await deliver(makeEvent("checkout.session.completed", { id: "cs_test_qa_ghost", object: "checkout.session", mode: "payment", status: "complete", payment_status: "paid", amount_total: 1000, currency: "eur", metadata: { orderId: "no-such-order" } }, { id: evId() }));
      check(r.status === 200 && /onbekende bestelling/.test(slackText(mark)), "Unknown order id: acknowledged (no endless 500 retries) and the owner is told", `Unknown order answered ${r.status}`);
    }
    {
      const o = await mkOrder({ qty: 1, stock: 5, status: "PAID", stripePaymentId: "cs_test_qa_first", pi: "pi_qa_first" });
      const mark = slackBodies.length;
      const r = await deliver(makeEvent("checkout.session.completed", sessionFor(o.order, { id: "cs_test_qa_second", payment_intent: "pi_qa_second" }), { id: evId() }));
      check(r.status === 200 && /Dubbele betaling/.test(slackText(mark)) && (await invoiceCount(o.order.id)) === 0, "Double charge: a second, different payment for a paid order alerts the owner and books nothing", `Double charge not flagged: ${r.status}`);
    }
    {
      // Same Checkout session, but a different payment intent than the one that paid the order.
      const o = await mkOrder({ qty: 1, stock: 5, status: "PAID", stripePaymentId: "cs_test_qa_same_session", pi: "pi_qa_same_first" });
      const mark = slackBodies.length;
      const r = await deliver(makeEvent("checkout.session.completed", sessionFor(o.order, { id: "cs_test_qa_same_session", payment_intent: "pi_qa_same_other" }), { id: evId() }));
      check(r.status === 200 && /Dubbele betaling/.test(slackText(mark)) && (await invoiceCount(o.order.id)) === 0 && (await orderOf(o.order.id)).stripePaymentIntentId === "pi_qa_same_first", "Double charge (same session, other payment intent): flagged, nothing booked, the stored payment intent is not overwritten", `Other payment intent on a paid order not flagged: ${r.status} ${slackText(mark).slice(0, 120)}`);
    }
    {
      const part = await mkPart(1);
      const a = await mkOrder({ part, qty: 1 });
      const b = await mkOrder({ part, qty: 1 });
      const mark = slackBodies.length;
      await deliver(makeEvent("checkout.session.completed", sessionFor(a.order), { id: evId() }));
      const mid = slackText(mark);
      await deliver(makeEvent("checkout.session.completed", sessionFor(b.order), { id: evId() }));
      const s = slackText(mark);
      const stock = (await prisma.part.findUniqueOrThrow({ where: { id: part.id } })).stock;
      check(mid.indexOf("Verkocht zonder voorraad") === -1 && s.includes("Verkocht zonder voorraad") && s.includes(part.sku) && stock === -1 && (await orderOf(b.order.id)).status === "PAID", "Oversell: the second buyer of the last unit is booked (money taken), stock -1, and the owner is told with the SKU", `Oversell silent: stock ${stock}, message ${s.slice(0, 200)}`);
    }
    {
      const o = await mkOrder({ qty: 1, stock: 5 });
      const r1 = await deliver(makeEvent("checkout.session.completed", sessionFor(o.order, { payment_status: "unpaid" }), { id: evId() }));
      const mid = await orderOf(o.order.id);
      const stockMid = await o.stockNow();
      const r2 = await deliver(makeEvent("checkout.session.async_payment_succeeded", sessionFor(o.order), { id: evId() }));
      checkEvent(["checkout.session.async_payment_succeeded"], r1.status === 200 && mid.status === "PENDING" && stockMid === 5 && r2.status === 200 && (await orderOf(o.order.id)).status === "PAID" && (await o.stockNow()) === 4, "Delayed payment: 'completed' while unpaid books nothing; async_payment_succeeded books it", `Delayed payment wrong: r1 ${r1.status} ${mid.status}, stock ${await o.stockNow()}, r2 ${r2.status} ${r2.text} -> ${(await orderOf(o.order.id)).status}`);
    }

    // ── 4. The lease ────────────────────────────────────────────────────
    {
      // A function that claimed the event and was killed: unfinished row, claimed 5 minutes ago.
      const o = await mkOrder({ qty: 1, stock: 5 });
      const ev = makeEvent("checkout.session.completed", sessionFor(o.order), { id: evId() });
      await prisma.stripeEvent.create({ data: { stripeEventId: ev.id, type: ev.type, claimedAt: new Date(Date.now() - 5 * 60_000), attempts: 1 } });
      const r = await deliver(ev);
      const row = await prisma.stripeEvent.findUniqueOrThrow({ where: { stripeEventId: ev.id } });
      check(r.status === 200 && !r.json.alreadyProcessed && (await orderOf(o.order.id)).status === "PAID" && row.completedAt !== null && row.attempts === 2, "Lease: an event left unfinished by a killed function is taken over and the paid order is fulfilled (attempts 2)", `Lease takeover failed: ${r.status} ${r.text} order ${(await orderOf(o.order.id)).status}`);
    }
    {
      const o = await mkOrder({ qty: 1, stock: 5 });
      const ev = makeEvent("checkout.session.completed", sessionFor(o.order), { id: evId() });
      await prisma.stripeEvent.create({ data: { stripeEventId: ev.id, type: ev.type, claimedAt: new Date(), attempts: 1 } });
      const r = await deliver(ev);
      check(r.status === 409 && (await orderOf(o.order.id)).status === "PENDING", "Lease: an event another delivery is working on right now is not run twice (409, Stripe retries later)", `Live lease not respected: ${r.status}`);
    }
    {
      // A transient failure hands the lease back so the retry runs at once.
      const o = await mkOrder({ qty: 1, stock: 5, stripePaymentId: `cs_test_qa_exp_${n}` });
      const sid = o.order.stripePaymentId!;
      fake.state.sessions[sid] = { id: sid, object: "checkout.session", status: "expired", payment_status: "unpaid", metadata: { orderId: o.order.id } };
      const ev = makeEvent("checkout.session.expired", { id: sid, object: "checkout.session", metadata: { orderId: o.order.id } }, { id: evId() });
      fake.fail("GET", "/v1/checkout/sessions/", 500, 1); // one failed call; stripe-node retries are off in the fake client
      const r1 = await deliver(ev);
      const mid = await prisma.stripeEvent.findUniqueOrThrow({ where: { stripeEventId: ev.id } });
      const r2 = await deliver(ev);
      const end = await prisma.stripeEvent.findUniqueOrThrow({ where: { stripeEventId: ev.id } });
      check(r1.status === 500 && mid.completedAt === null && mid.lastError !== null && r2.status === 200 && end.completedAt !== null && end.attempts === 2 && (await orderOf(o.order.id)).status === "CANCELLED", "Lease: a failing handler answers 500, keeps the event (error recorded), and Stripe's retry completes it (attempts 2)", `Retry flow wrong: ${r1.status}/${r2.status} completed ${end.completedAt} attempts ${end.attempts}`);
    }
    {
      const o = await mkOrder({ qty: 1, stock: 5 });
      const ev = makeEvent("checkout.session.completed", sessionFor(o.order), { id: evId() });
      const rs = await Promise.all([1, 2, 3, 4, 5].map(() => deliver(ev)));
      const ok = rs.filter((r) => r.status === 200 && !r.json.alreadyProcessed).length;
      check(ok === 1 && (await o.stockNow()) === 4 && (await invoiceCount(o.order.id)) === 1 && mailsTo(o.order.email).length === 1, `Concurrency: five simultaneous deliveries of one event process it once (${rs.map((r) => r.status).join(",")}), one decrement, one invoice, one mail`, `Concurrent deliveries misbooked: ${rs.map((r) => r.status)}, stock ${await o.stockNow()}, mails ${mailsTo(o.order.email).length}`);
    }

    // ── 4b. One confirmation per payment, however the events arrive ─────
    {
      // Four DIFFERENT events for one payment at the same moment (the event id differs, so the event lease cannot help).
      const failedRounds: string[] = [];
      for (let round = 0; round < 8; round++) {
        const o = await mkOrder({ qty: 1, stock: 5 });
        const slackMark = slackBodies.length;
        const mailMark = mails.length;
        const evs = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.completed", "checkout.session.async_payment_succeeded"].map((type) => makeEvent(type, sessionFor(o.order), { id: evId() }));
        const first = await Promise.all(evs.map((e) => deliver(e)));
        // an event that met a sibling in the middle of sending fails; Stripe retries it
        const retried = await Promise.all(evs.filter((_, i) => first[i].status !== 200).map((e) => deliver(e)));
        const pings = slackBodies.slice(slackMark).filter((b) => /Betaling ontvangen/.test(b)).length;
        const toBuyer = mails.slice(mailMark).filter((m) => m.to === o.order.email).length;
        const allOk = first.every((r) => r.status === 200 || r.status === 500) && retried.every((r) => r.status === 200);
        if (!allOk || toBuyer !== 1 || pings !== 1 || (await invoiceCount(o.order.id)) !== 1 || (await o.stockNow()) !== 4 || (await orderOf(o.order.id)).status !== "PAID") {
          failedRounds.push(`round ${round}: statuses ${first.map((r) => r.status).join(",")}->${retried.map((r) => r.status).join(",")} mails ${toBuyer} pings ${pings} invoices ${await invoiceCount(o.order.id)} stock ${await o.stockNow()}`);
        }
      }
      check(failedRounds.length === 0, "One confirmation: four different events for one payment, delivered at once (8 rounds), send exactly one customer mail and one owner ping, one invoice, one decrement", `Duplicate confirmations or double booking: ${failedRounds.slice(0, 3).join(" | ")}`);
    }
    {
      // The winner died after it claimed PENDING -> PAID and before the invoice: the retry must finish the job AND send the confirmation.
      const o = await mkOrder({ qty: 1, stock: 5, status: "PAID", stripePaymentId: `cs_test_qa_${(n + 1).toString()}` });
      const sessionId = o.order.stripePaymentId!;
      await prisma.order.update({ where: { id: o.order.id }, data: { paidAt: new Date(), stripePaymentIntentId: `pi_qa_crash_${n}` } });
      const slackMark = slackBodies.length;
      const r = await deliver(makeEvent("checkout.session.completed", sessionFor(o.order, { id: sessionId, payment_intent: `pi_qa_crash_${n}` }), { id: evId() }));
      const toBuyer = mailsTo(o.order.email);
      check(r.status === 200 && (await invoiceCount(o.order.id)) === 1 && (await o.stockNow()) === 5 && toBuyer.length === 1 && /Betaling ontvangen/.test(slackText(slackMark)), "Retry after a crash between the claim and the invoice: the invoice is issued, the confirmation is sent once, the stock is not taken twice", `Crash recovery wrong: ${r.status} invoices ${await invoiceCount(o.order.id)} stock ${await o.stockNow()} mails ${toBuyer.length}`);
    }
    {
      // The function died AFTER it claimed the confirmation and before it sent it: once the claim's lease has run out the next call sends it.
      const paid = async () => {
        const o = await mkOrder({ qty: 1, stock: 5 });
        await deliver(makeEvent("checkout.session.completed", sessionFor(o.order), { id: evId() }));
        return o;
      };
      const stale = await paid();
      const mailsBefore = mails.length;
      await prisma.stripeEvent.update({ where: { stripeEventId: `mail:order-paid:${stale.order.id}` }, data: { completedAt: null, claimedAt: new Date(Date.now() - 5 * 60_000) } });
      const mailBefore = mailsTo(stale.order.email).length;
      const r = await deliver(makeEvent("checkout.session.async_payment_succeeded", sessionFor(stale.order), { id: evId() }));
      check(r.status === 200 && mailsTo(stale.order.email).length === mailBefore + 1 && (await prisma.stripeEvent.findUniqueOrThrow({ where: { stripeEventId: `mail:order-paid:${stale.order.id}` } })).completedAt !== null, "Confirmation claimed by a function that died: after the lease the next call sends it and completes the claim", `Dead confirmation claim not taken over: ${r.status} mails +${mailsTo(stale.order.email).length - mailBefore}`);

      const live = await paid();
      await prisma.stripeEvent.update({ where: { stripeEventId: `mail:order-paid:${live.order.id}` }, data: { completedAt: null, claimedAt: new Date() } });
      const liveMails = mailsTo(live.order.email).length;
      const busy = await deliver(makeEvent("checkout.session.async_payment_succeeded", sessionFor(live.order), { id: evId() }));
      check(busy.status === 500 && mailsTo(live.order.email).length === liveMails, "Confirmation being sent right now by another call: this call fails (Stripe retries) instead of reporting success, and sends nothing", `Live confirmation claim not respected: ${busy.status}`);

      const done = await paid();
      const doneMails = mailsTo(done.order.email).length;
      const again = await deliver(makeEvent("checkout.session.async_payment_succeeded", sessionFor(done.order), { id: evId() }));
      check(again.status === 200 && mailsTo(done.order.email).length === doneMails, "Confirmation already sent: a later event for the same payment sends nothing", `Confirmation sent twice: ${again.status}`);

      const old = await paid();
      await prisma.stripeEvent.delete({ where: { stripeEventId: `mail:order-paid:${old.order.id}` } });
      await prisma.order.update({ where: { id: old.order.id }, data: { paidAt: new Date(Date.now() - 10 * 86400_000) } });
      const oldMails = mailsTo(old.order.email).length;
      await deliver(makeEvent("checkout.session.async_payment_succeeded", sessionFor(old.order), { id: evId() }));
      check(mailsTo(old.order.email).length === oldMails && mails.length >= mailsBefore, "Confirmation window: an order paid 10 days ago is not mailed again by a late event", "A late event re-sent a confirmation for an order paid 10 days ago");
    }

    // ── 5. Expired and failed sessions ──────────────────────────────────
    {
      const sid = `cs_test_qa_e1_${n}`;
      const o = await mkOrder({ qty: 1, stock: 5, stripePaymentId: sid });
      fake.state.sessions[sid] = { id: sid, object: "checkout.session", status: "expired", payment_status: "unpaid", metadata: { orderId: o.order.id } };
      const mailsBefore = mails.length;
      const r = await deliver(makeEvent("checkout.session.expired", { id: sid, object: "checkout.session", metadata: { orderId: o.order.id } }, { id: evId() }));
      const row = await orderOf(o.order.id);
      checkEvent(["checkout.session.expired"], r.status === 200 && row.status === "CANCELLED" && row.cancelledAt !== null && /verlopen/.test(row.cancelReason ?? "") && (await o.stockNow()) === 5 && mails.length === mailsBefore, "Expired session: the abandoned order is CANCELLED with a reason, stock untouched, the customer is not mailed", `Expired session wrong: ${r.status} ${row.status}`);
    }
    {
      const sid = `cs_test_qa_e2_${n}`;
      const o = await mkOrder({ qty: 1, stock: 5, stripePaymentId: sid });
      fake.state.sessions[sid] = { id: sid, object: "checkout.session", status: "complete", payment_status: "paid", metadata: { orderId: o.order.id } };
      const r = await deliver(makeEvent("checkout.session.expired", { id: sid, object: "checkout.session", metadata: { orderId: o.order.id } }, { id: evId() }));
      check(r.status === 200 && (await orderOf(o.order.id)).status === "PENDING", "Expired event for a session Stripe says is paid: the order is left alone", `Paid session cancelled: ${(await orderOf(o.order.id)).status}`);
      const paid = await mkOrder({ qty: 1, stock: 5, status: "PAID", stripePaymentId: `cs_test_qa_e3_${n}` });
      fake.state.sessions[paid.order.stripePaymentId!] = { id: paid.order.stripePaymentId, object: "checkout.session", status: "expired", payment_status: "unpaid", metadata: { orderId: paid.order.id } };
      const r2 = await deliver(makeEvent("checkout.session.expired", { id: paid.order.stripePaymentId, object: "checkout.session", metadata: { orderId: paid.order.id } }, { id: evId() }));
      check(r2.status === 200 && (await orderOf(paid.order.id)).status === "PAID", "Expired event for an order that is already PAID: never cancels it", `Paid order cancelled by an expiry: ${(await orderOf(paid.order.id)).status}`);
      const oldSession = await mkOrder({ qty: 1, stock: 5, stripePaymentId: "cs_test_qa_current" });
      fake.state.sessions["cs_test_qa_older"] = { id: "cs_test_qa_older", object: "checkout.session", status: "expired", payment_status: "unpaid", metadata: { orderId: oldSession.order.id } };
      await deliver(makeEvent("checkout.session.expired", { id: "cs_test_qa_older", object: "checkout.session", metadata: { orderId: oldSession.order.id } }, { id: evId() }));
      check((await orderOf(oldSession.order.id)).status === "PENDING", "Expired event for an older session of the order: ignored", "An older session's expiry cancelled the order");
    }
    {
      const sid = `cs_test_qa_f1_${n}`;
      const o = await mkOrder({ qty: 1, stock: 5, stripePaymentId: sid });
      fake.state.sessions[sid] = { id: sid, object: "checkout.session", status: "complete", payment_status: "unpaid", metadata: { orderId: o.order.id } };
      const r = await deliver(makeEvent("checkout.session.async_payment_failed", { id: sid, object: "checkout.session", metadata: { orderId: o.order.id } }, { id: evId() }));
      const m = mailsTo(o.order.email);
      checkEvent(["checkout.session.async_payment_failed"], r.status === 200 && (await orderOf(o.order.id)).status === "CANCELLED" && m.length === 1 && /geannuleerd/i.test(m[0].subject + m[0].html), "Failed delayed payment: order CANCELLED through the domain function and the customer is told", `Async failure wrong: ${r.status} ${(await orderOf(o.order.id)).status} mails ${m.length}`);
    }

    // ── 6. Refunds and disputes ─────────────────────────────────────────
    const paidOrder = async (qty = 2, stock = 5) => {
      const o = await mkOrder({ qty, stock });
      await deliver(makeEvent("checkout.session.completed", sessionFor(o.order), { id: evId() }));
      return o;
    };
    const refundOf = (o: { order: { id: string; totalEur: number } }, amount: number, id: string, chargeId = `ch_qa_${id}`) => {
      fake.state.refunds.push({ id, object: "refund", amount, currency: "eur", status: "succeeded", charge: chargeId, payment_intent: `pi_qa_${o.order.id}`, created: nowSec() });
      return { id: chargeId, object: "charge", payment_intent: `pi_qa_${o.order.id}`, amount: cents(o.order.totalEur), currency: "eur" };
    };
    {
      const o = await paidOrder(2, 5);
      const mark = slackBodies.length;
      const charge = refundOf(o, cents(o.order.totalEur), "re_qa_full");
      const ev = makeEvent("charge.refunded", charge, { id: evId() });
      const r = await deliver(ev);
      const row = await orderOf(o.order.id);
      const notes = await inv.getCreditNotesForOrder(o.order.id);
      checkEvent(["charge.refunded"], r.status === 200 && row.status === "CANCELLED" && notes.length === 1 && notes[0].totalEur === o.order.totalEur && row.refundedEur === o.order.totalEur, "Full refund: credit note for the whole invoice, refundedEur set, the unshipped order is CANCELLED", `Full refund wrong: ${r.status} ${row.status} notes ${notes.length}`);
      check((await o.stockNow()) === 5, "Full refund: the units go back on the shelf", `Refund did not restock: ${await o.stockNow()}`);
      const raw = await prisma.creditNote.findFirstOrThrow({ where: { invoice: { orderId: o.order.id } } });
      check(raw.stripeRefundId === "re_qa_full" && /^CN-\d{4}-\d{5}$/.test(raw.number), "Full refund: the credit note carries the Stripe refund id and a CN-YYYY-NNNNN number", `Credit note wrong: ${raw.number} ${raw.stripeRefundId}`);
      check(/Terugbetaling/.test(slackText(mark)), "Full refund: the owner is told", "Refund: owner not told");
      const replay = await deliver(makeEvent("charge.refunded", charge, { id: evId() }));
      check(replay.status === 200 && (await inv.getCreditNotesForOrder(o.order.id)).length === 1 && (await o.stockNow()) === 5, "Refund replayed under another event id: still one credit note, stock restocked once", "A replayed refund booked a second credit note or restocked twice");
    }
    {
      const o = await paidOrder(2, 5);
      await prisma.order.update({ where: { id: o.order.id }, data: { status: "SHIPPED", shippedAt: new Date() } });
      const charge = refundOf(o, 500, "re_qa_part");
      const r = await deliver(makeEvent("charge.refunded", charge, { id: evId() }));
      const row = await orderOf(o.order.id);
      const notes = await inv.getCreditNotesForOrder(o.order.id);
      check(r.status === 200 && row.status === "SHIPPED" && row.refundedEur === 5 && notes.length === 1 && notes[0].totalEur === 5, "Partial refund of a shipped order: € 5,00 credit note, refundedEur 5, status stays SHIPPED", `Partial refund wrong: ${r.status} ${row.status} ${row.refundedEur}`);
    }
    {
      const mark = slackBodies.length;
      const r = await deliver(makeEvent("charge.refunded", { id: "ch_qa_stranger", object: "charge", payment_intent: "pi_qa_nobody" }, { id: evId() }));
      check(r.status === 200 && !/Terugbetaling niet verwerkt/.test(slackText(mark)), "Refund on a charge that belongs to no order: acknowledged, nothing booked, no false alarm", `Stranger charge answered ${r.status}`);
    }
    {
      // Order paid before the payment intent was stored: found through the checkout session.
      const o = await mkOrder({ qty: 1, stock: 5, status: "PAID", pi: null });
      await prisma.invoice.count(); // (no invoice yet: recordRefund issues the missing one)
      fake.state.sessions[`cs_test_qa_lookup_${n}`] = { id: `cs_test_qa_lookup_${n}`, object: "checkout.session", payment_intent: `pi_qa_lookup_${n}`, metadata: { orderId: o.order.id } };
      fake.state.refunds.push({ id: `re_qa_lookup_${n}`, object: "refund", amount: 300, currency: "eur", status: "succeeded", charge: `ch_qa_lookup_${n}`, payment_intent: `pi_qa_lookup_${n}`, created: nowSec() });
      const r = await deliver(makeEvent("charge.refunded", { id: `ch_qa_lookup_${n}`, object: "charge", payment_intent: `pi_qa_lookup_${n}` }, { id: evId() }));
      const row = await orderOf(o.order.id);
      check(r.status === 200 && row.refundedEur === 3 && row.stripePaymentIntentId === `pi_qa_lookup_${n}`, "Refund: an order without a stored payment intent is matched through its checkout session, and the intent is remembered", `Session lookup failed: ${r.status} refunded ${row.refundedEur} pi ${row.stripePaymentIntentId}`);
    }
    {
      const o = await paidOrder(1, 5);
      const mark = slackBodies.length;
      const due = nowSec() + 8 * 86400;
      const ev = makeEvent("charge.dispute.created", { id: "dp_qa_1", object: "dispute", amount: cents(o.order.totalEur), currency: "eur", reason: "fraudulent", payment_intent: `pi_qa_${o.order.id}`, charge: "ch_x", evidence_details: { due_by: due } }, { id: evId() });
      const r = await deliver(ev);
      const s = slackText(mark);
      const dueYear = String(new Date(due * 1000).getUTCFullYear());
      checkEvent(["charge.dispute.created"], r.status === 200 && /Betwisting/.test(s) && s.includes(`€ ${o.order.totalEur.toFixed(2)}`) && s.includes("fraudulent") && s.includes(dueYear) && /reactiedatum/i.test(s) && s.includes(o.order.id.slice(0, 8).toUpperCase()), "Dispute: the owner gets amount, reason, evidence deadline and the order number", `Dispute message wrong: ${r.status} ${s.slice(0, 300)}`);
      slackState.fail = true;
      const ev2 = makeEvent("charge.dispute.created", { id: "dp_qa_2", object: "dispute", amount: 1000, currency: "eur", reason: "general", payment_intent: null, evidence_details: { due_by: due } }, { id: evId() });
      const failed = await deliver(ev2);
      slackState.fail = false;
      const retried = await deliver(ev2);
      check(failed.status === 500 && retried.status === 200, "Dispute: if the owner could not be reached the event fails (Stripe retries) and succeeds once a channel works", `Unreachable owner swallowed a dispute: ${failed.status}/${retried.status}`);
    }

    {
      // The second payment of a double charge is refunded (that is what the owner is told to do): the order, which is paid by the FIRST payment, must stay as it is.
      const o = await paidOrder(2, 5);
      const second = { pi: `pi_qa_second_${n}`, session: `cs_test_qa_second_${n}`, charge: `ch_qa_second_${n}` };
      fake.state.sessions[second.session] = { id: second.session, object: "checkout.session", payment_intent: second.pi, metadata: { orderId: o.order.id } };
      fake.state.refunds.push({ id: `re_qa_second_${n}`, object: "refund", amount: cents(o.order.totalEur), currency: "eur", status: "succeeded", charge: second.charge, payment_intent: second.pi, created: nowSec() });
      const mark = slackBodies.length;
      const r = await deliver(makeEvent("charge.refunded", { id: second.charge, object: "charge", payment_intent: second.pi }, { id: evId() }));
      const row = await orderOf(o.order.id);
      check(r.status === 200 && row.status === "PAID" && row.refundedEur === 0 && (await inv.getCreditNotesForOrder(o.order.id)).length === 0 && (await o.stockNow()) === 3 && /Dubbele betaling terugbetaald/.test(slackText(mark)) && row.stripePaymentIntentId === `pi_qa_${o.order.id}`, "Double charge refunded: the refund of the SECOND payment leaves the paid order, its stock and its credit notes alone, and tells the owner", `Duplicate-payment refund cancelled or credited the valid order: ${r.status} ${row.status} refunded ${row.refundedEur} stock ${await o.stockNow()}`);
      // Same, for an order that was paid before the payment intent was stored on it: the session id decides.
      await prisma.order.update({ where: { id: o.order.id }, data: { stripePaymentIntentId: null } });
      const again = await deliver(makeEvent("charge.refunded", { id: second.charge, object: "charge", payment_intent: second.pi }, { id: evId() }));
      const rowAgain = await orderOf(o.order.id);
      check(again.status === 200 && rowAgain.status === "PAID" && (await inv.getCreditNotesForOrder(o.order.id)).length === 0 && rowAgain.stripePaymentIntentId === null, "Double charge refunded, order without a stored payment intent: still recognised as the second payment (by its session), nothing booked, no intent adopted", `Duplicate refund misread without a stored intent: ${again.status} ${rowAgain.status}`);
      // A dispute on the second payment says so.
      const mark2 = slackBodies.length;
      await deliver(makeEvent("charge.dispute.created", { id: `dp_qa_second_${n}`, object: "dispute", amount: 1000, currency: "eur", reason: "duplicate", payment_intent: second.pi, evidence_details: { due_by: nowSec() + 86400 } }, { id: evId() }));
      check(/NIET de betaling waarmee de bestelling is voldaan/.test(slackText(mark2)), "Dispute on the second payment of a double charge: the owner is told it is not the payment that paid the order", `Dispute on a duplicate payment not labelled: ${slackText(mark2).slice(0, 200)}`);
    }
    {
      // Refunds that returned no money, and refunds that are not in euro, are not credit notes.
      const o = await paidOrder(2, 5);
      const pi = `pi_qa_${o.order.id}`;
      const mark = slackBodies.length;
      const mk = (id: string, status: string, currency = "eur") => fake.state.refunds.push({ id, object: "refund", amount: 500, currency, status, charge: `ch_qa_guard_${n}`, payment_intent: pi, created: nowSec() });
      mk(`re_qa_failed_${n}`, "failed");
      mk(`re_qa_cancelled_${n}`, "canceled");
      const r = await deliver(makeEvent("charge.refunded", { id: `ch_qa_guard_${n}`, object: "charge", payment_intent: pi }, { id: evId() }));
      check(r.status === 200 && (await inv.getCreditNotesForOrder(o.order.id)).length === 0 && (await orderOf(o.order.id)).refundedEur === 0, "Refund that failed or was cancelled: no credit note (no money went back)", `A failed/cancelled refund was booked: ${(await inv.getCreditNotesForOrder(o.order.id)).length} notes`);
      mk(`re_qa_usd_${n}`, "succeeded", "usd");
      const usd = await deliver(makeEvent("charge.refunded", { id: `ch_qa_guard_${n}`, object: "charge", payment_intent: pi }, { id: evId() }));
      check(usd.status === 200 && (await inv.getCreditNotesForOrder(o.order.id)).length === 0 && /vreemde valuta/.test(slackText(mark)), "Refund in a foreign currency: not booked as euro, the owner is told to book it by hand", `A USD refund was booked as euro or stayed silent: ${(await inv.getCreditNotesForOrder(o.order.id)).length} notes`);
    }
    {
      // The admin path: refund at Stripe first, record it with the refund id, then the webhook arrives: still ONE credit note.
      const o = await paidOrder(1, 5);
      const pi = `pi_qa_${o.order.id}`;
      const refund = await stripeLib.refundStripePayment({ orderId: o.order.id, paymentIntentId: pi, amountEur: o.order.totalEur, idempotencyKey: `cancel-${o.order.id}` });
      const cancelled = refund.ok ? await inv.cancelOrder(o.order.id, { reason: "QA annulering", actor: "admin", stripeRefundId: refund.refundId, notifyCustomer: false }) : null;
      const notesBefore = await inv.getCreditNotesForOrder(o.order.id);
      const hook = await deliver(makeEvent("charge.refunded", { id: `ch_${pi}`, object: "charge", payment_intent: pi }, { id: evId() }));
      const notesAfter = await inv.getCreditNotesForOrder(o.order.id);
      check(refund.ok && !!cancelled && cancelled.ok && notesBefore.length === 1 && hook.status === 200 && notesAfter.length === 1 && notesAfter[0].number === notesBefore[0].number && (await o.stockNow()) === 5 && (await orderOf(o.order.id)).refundedEur === o.order.totalEur, "Admin refund round trip: refundStripePayment -> cancelOrder(stripeRefundId) -> charge.refunded webhook gives one credit note, one restock, one refund amount", `Admin refund round trip broke: notes ${notesBefore.length}->${notesAfter.length}, hook ${hook.status}, stock ${await o.stockNow()}`);
    }

    // ── 7. Subscriptions ────────────────────────────────────────────────
    const subUser = async (extra: Record<string, unknown> = {}) => {
      const cus = `cus_qa_${++n}`;
      const u = await mkUser({ stripeCustomerId: cus, ...extra });
      return { u, cus };
    };
    const subEvent = (type: string, s: Json) => makeEvent(type, s, { id: evId() });
    {
      resetFake();
      const { u, cus } = await subUser();
      const s = fake.subscription({ id: `sub_qa_${n}`, customer: cus, priceId: PRICES.PARTICULIER, status: "trialing", userId: u.id, plan: "PARTICULIER", trialEnd: nowSec() + 14 * 86400 });
      fake.state.subscriptions[s.id] = s;
      const mark = slackBodies.length;
      const r = await deliver(subEvent("checkout.session.completed", { id: "cs_sub_1", object: "checkout.session", mode: "subscription", subscription: s.id, customer: cus, payment_status: "no_payment_required", metadata: { userId: u.id, plan: "PARTICULIER" } }));
      const row = await userOf(u.id);
      check(r.status === 200 && row.plan === "PARTICULIER" && row.stripeSubId === s.id && row.stripeSubStatus === "trialing" && row.stripeCurrentPeriodEnd !== null && row.trialUsedAt !== null, "Subscription start: plan from the price, status trialing, period end stored, trial marked as used", `Subscription start wrong: ${JSON.stringify(row)}`);
      check(mailsTo(u.email).length === 1 && /Particulier/.test(mailsTo(u.email)[0].subject + mailsTo(u.email)[0].html) && /Nieuw abonnement/.test(slackText(mark)), "Subscription start: the customer gets a confirmation and the owner is told", "Subscription start: confirmation or owner notice missing");
      await deliver(subEvent("customer.subscription.created", s));
      check(mailsTo(u.email).length === 1, "Subscription: the created event after the checkout event sends no second confirmation", `Second confirmation sent: ${mailsTo(u.email).length}`);

      // stale: Stripe says canceled (period over); an old 'updated(active)' payload arrives late
      fake.state.subscriptions[s.id] = { ...s, status: "canceled", current_period_end: nowSec() - 86400 };
      const stale = await deliver(subEvent("customer.subscription.updated", { ...s, status: "active" }));
      const afterCancel = await userOf(u.id);
      check(stale.status === 200 && afterCancel.plan === "FREE" && afterCancel.stripeSubId === null, "Stale event: an 'updated(active)' payload for a subscription Stripe has cancelled does not re-grant the plan (state comes from Stripe)", `Stale payload re-granted: ${afterCancel.plan} ${afterCancel.stripeSubId}`);
      await deliver(subEvent("customer.subscription.updated", { ...s, status: "active" }));
      check((await userOf(u.id)).plan === "FREE", "Stale event: delivered again, still FREE", "Second stale delivery re-granted");

      // out of order: 'deleted' arrives first, then 'created'; Stripe's truth is active
      const { u: u2, cus: cus2 } = await subUser();
      const s2 = fake.subscription({ id: `sub_qa_${++n}`, customer: cus2, priceId: PRICES.MONTEUR_PRO, status: "active", userId: u2.id });
      fake.state.subscriptions[s2.id] = s2;
      await deliver(subEvent("customer.subscription.deleted", { ...s2, status: "canceled" }));
      await deliver(subEvent("customer.subscription.created", s2));
      const r2 = await userOf(u2.id);
      checkEvent(["customer.subscription.created"], r2.plan === "MONTEUR_PRO" && r2.stripeSubId === s2.id && r2.stripeSubStatus === "active", "Out of order: 'deleted' before 'created' converges on what Stripe says now (active)", `Out-of-order delivery diverged: ${r2.plan} ${r2.stripeSubStatus}`);

      // portal downgrade: price changes, metadata does not
      fake.state.subscriptions[s2.id] = { ...s2, items: { data: [{ price: { id: PRICES.PARTICULIER } }] }, metadata: s2.metadata };
      await deliver(subEvent("customer.subscription.updated", s2));
      checkEvent(["customer.subscription.updated"], (await userOf(u2.id)).plan === "PARTICULIER", "Plan change in the portal: the plan follows the price, not the stale metadata", `Downgrade not applied: ${(await userOf(u2.id)).plan}`);
    }
    {
      // two live subscriptions for one user
      resetFake();
      const { u, cus } = await subUser();
      const a = fake.subscription({ id: `sub_qa_a${++n}`, customer: cus, priceId: PRICES.PARTICULIER, userId: u.id, plan: "PARTICULIER" });
      const b = fake.subscription({ id: `sub_qa_b${n}`, customer: cus, priceId: PRICES.MONTEUR_PRO, userId: u.id, plan: "MONTEUR_PRO" });
      fake.state.subscriptions[a.id] = a;
      fake.state.subscriptions[b.id] = b;
      await deliver(subEvent("customer.subscription.created", a));
      const mark = slackBodies.length;
      await deliver(subEvent("customer.subscription.created", b));
      const row = await userOf(u.id);
      check(row.stripeSubId === a.id && row.plan === "PARTICULIER" && /twee lopende abonnementen/.test(slackText(mark)), "Two live subscriptions: the first stays, the second is reported to the owner, the plan is not swapped", `Second live subscription took over: ${row.stripeSubId} ${row.plan}`);
      fake.state.subscriptions[b.id] = { ...b, status: "canceled" };
      await deliver(subEvent("customer.subscription.deleted", b));
      const afterB = await userOf(u.id);
      check(afterB.plan === "PARTICULIER" && afterB.stripeSubId === a.id, "Cancelling the extra subscription does not downgrade the customer who still pays for the other one", `Deleted extra sub stripped the customer: ${afterB.plan} ${afterB.stripeSubId}`);
      // the stored one ends, the other is live: it is adopted
      fake.state.subscriptions[a.id] = { ...a, status: "canceled", current_period_end: nowSec() - 3600 };
      fake.state.subscriptions[b.id] = b;
      await deliver(subEvent("customer.subscription.updated", b));
      const adopted = await userOf(u.id);
      check(adopted.stripeSubId === b.id && adopted.plan === "MONTEUR_PRO", "When the stored subscription has ended, the live one replaces it", `Replacement not adopted: ${adopted.stripeSubId} ${adopted.plan}`);
    }
    {
      // dunning: past_due -> grace -> FREE -> paid again
      resetFake();
      const { u, cus } = await subUser();
      const periodStart = nowSec() - 3 * 86400;
      const s = fake.subscription({ id: `sub_qa_pd${++n}`, customer: cus, priceId: PRICES.MONTEUR_PRO, status: "active", userId: u.id, periodStart });
      fake.state.subscriptions[s.id] = s;
      await deliver(subEvent("customer.subscription.created", s));
      const mailsBefore = mails.length;
      fake.state.subscriptions[s.id] = { ...s, status: "past_due" };
      const mark = slackBodies.length;
      const r = await deliver(subEvent("invoice.payment_failed", { id: "in_qa_1", object: "invoice", subscription: s.id, customer: cus, attempt_count: 1, amount_due: 2900 }));
      const row = await userOf(u.id);
      const m = mails.slice(mailsBefore).filter((x) => x.to === u.email && /niet gelukt/.test(x.subject));
      const ownerText = slackText(mark);
      checkEvent(["invoice.payment_failed"], r.status === 200 && row.stripeSubStatus === "past_due" && row.plan === "MONTEUR_PRO" && sub.effectivePlan(row) === "MONTEUR_PRO", "Dunning: payment failed -> status past_due stored, plan kept during the grace window", `past_due handling wrong: ${row.stripeSubStatus} ${row.plan}`);
      check(m.length === 1 && m[0].html.includes("/dashboard/profiel") && /poging 1/.test(m[0].html) && /Abonnementsbetaling mislukt/.test(ownerText) && /Monteur Pro/.test(ownerText) && !ownerText.includes(u.email), "Dunning: the customer is mailed (attempt number, link to the profile/portal page) and the owner is told", `Dunning mail/notice missing: ${m.length} mails`);
      check(row.stripeCurrentPeriodEnd !== null && Math.abs(row.stripeCurrentPeriodEnd.getTime() - periodStart * 1000) < 1000, "Dunning: for past_due the stored 'paid through' date is the START of the unpaid period", `paid-through wrong: ${row.stripeCurrentPeriodEnd}`);
      const grace = sub.PAST_DUE_GRACE_DAYS;
      const day = 86400_000;
      const end = row.stripeCurrentPeriodEnd!.getTime();
      check(sub.effectivePlan(row, new Date(end + (grace - 0.5) * day)) === "MONTEUR_PRO" && sub.effectivePlan(row, new Date(end + (grace + 0.5) * day)) === "FREE", `Dunning: the plan lapses to FREE ${grace} days after the last paid period (constant PAST_DUE_GRACE_DAYS)`, "Grace window boundaries wrong");
      // the grace is over: stored paid-through is 10 days old
      await prisma.user.update({ where: { id: u.id }, data: { stripeCurrentPeriodEnd: new Date(Date.now() - 10 * day) } });
      const swept = await subsLib.sweepLapsedSubscriptions();
      const lapsed = await userOf(u.id);
      check(swept.lapsed >= 1 && lapsed.plan === "FREE" && lapsed.stripeSubId === s.id, "Dunning: the sweep resets a lapsed past_due plan to FREE but keeps the subscription id", `Sweep wrong: ${swept.lapsed} ${lapsed.plan} ${lapsed.stripeSubId}`);
      fake.state.subscriptions[s.id] = { ...s, status: "active", current_period_start: nowSec(), current_period_end: nowSec() + 30 * 86400 };
      const paid = await deliver(subEvent("invoice.paid", { id: "in_qa_2", object: "invoice", subscription: s.id, customer: cus }));
      const back = await userOf(u.id);
      checkEvent(["invoice.paid"], paid.status === 200 && back.plan === "MONTEUR_PRO" && back.stripeSubStatus === "active" && sub.effectivePlan(back) === "MONTEUR_PRO", "Dunning: invoice.paid after the lapse restores the plan from the price", `Not restored: ${back.plan} ${back.stripeSubStatus}`);
      // a retry that already succeeded must not produce a scolding mail
      const mailsNow = mails.length;
      await deliver(subEvent("invoice.payment_failed", { id: "in_qa_3", object: "invoice", subscription: s.id, customer: cus, attempt_count: 2, amount_due: 2900 }));
      check(mails.length === mailsNow, "Dunning: no failure mail when Stripe already shows the subscription active again", "A failure mail was sent for a subscription that is active");
    }
    {
      // cancelled with paid time left, unpaid, unknown customer/price, erased account
      resetFake();
      const day = 86400_000;
      const { u, cus } = await subUser();
      const s = fake.subscription({ id: `sub_qa_c${++n}`, customer: cus, priceId: PRICES.PARTICULIER, status: "active", userId: u.id });
      fake.state.subscriptions[s.id] = s;
      await deliver(subEvent("customer.subscription.created", s));
      const future = nowSec() + 10 * 86400;
      fake.state.subscriptions[s.id] = { ...s, status: "canceled", current_period_end: future };
      await deliver(subEvent("customer.subscription.deleted", s));
      const row = await userOf(u.id);
      checkEvent(["customer.subscription.deleted"], row.plan === "FREE" && row.stripeSubStatus === "canceled" && row.stripeSubId === null && row.stripeCurrentPeriodEnd === null && sub.effectivePlan(row) === "FREE", "Cancelled subscription: the plan ends with it, even though Stripe still shows period time (canceled means ended)", `Cancelled subscription kept access: ${row.plan} ${row.stripeSubStatus} ${row.stripeSubId} ${row.stripeCurrentPeriodEnd}`);
    }
    {
      // The invoice-to-subscription link in the shape newer API versions send (a webhook endpoint follows ITS version, not ours),
      // and in neither shape (the invoice is then fetched through the pinned client).
      resetFake();
      const { u, cus } = await subUser();
      const s = fake.subscription({ id: `sub_qa_shape${++n}`, customer: cus, priceId: PRICES.MONTEUR_PRO, status: "active", userId: u.id });
      fake.state.subscriptions[s.id] = s;
      await deliver(subEvent("customer.subscription.created", s));
      fake.state.subscriptions[s.id] = { ...s, status: "past_due" };
      const sent = () => mails.filter((m) => m.to === u.email && /niet gelukt/.test(m.subject)).length;
      const r1 = await deliver(subEvent("invoice.payment_failed", { id: "in_qa_new_shape", object: "invoice", customer: cus, attempt_count: 1, amount_due: 2900, parent: { type: "subscription_details", subscription_details: { subscription: s.id } } }));
      check(r1.status === 200 && sent() === 1 && (await userOf(u.id)).stripeSubStatus === "past_due", "Dunning mail: found through invoice.parent.subscription_details (the shape newer webhook API versions send)", `New-shape invoice lost its subscription: ${r1.status} mails ${sent()}`);
      fake.state.invoices["in_qa_bare"] = { id: "in_qa_bare", object: "invoice", subscription: s.id, customer: cus };
      const getsBefore = fake.requestsTo("GET", "/v1/invoices/").length;
      const r2 = await deliver(subEvent("invoice.payment_failed", { id: "in_qa_bare", object: "invoice", customer: cus, attempt_count: 2, amount_due: 2900 }));
      check(r2.status === 200 && sent() === 2 && fake.requestsTo("GET", "/v1/invoices/").length === getsBefore + 1, "Dunning mail: an event that names no subscription is resolved by fetching the invoice", `Bare invoice event not resolved: ${r2.status} mails ${sent()}`);
      const r3 = await deliver(subEvent("invoice.paid", { id: "in_qa_oneoff", object: "invoice", customer: cus }));
      check(r3.status === 200 && sent() === 2, "An invoice that Stripe does not know and that names no subscription is acknowledged without a mail", `Unknown bare invoice: ${r3.status}`);
    }
    {
      // What the Clerk user.deleted handler leaves behind (anonymised row, plan and subscription id untouched) is cancelled by the daily maintenance.
      resetFake();
      const { u, cus } = await subUser({ plan: "MONTEUR_PRO", stripeSubId: `sub_qa_orphan${++n}`, stripeSubStatus: "active", stripeCurrentPeriodEnd: new Date(Date.now() + 20 * 86400_000) });
      fake.state.subscriptions[u.stripeSubId!] = fake.subscription({ id: u.stripeSubId!, customer: cus, priceId: PRICES.MONTEUR_PRO, userId: u.id });
      await prisma.user.update({ where: { id: u.id }, data: { email: `deleted-${u.id}@anon.wasfix.nl`, name: "Verwijderd account", clerkId: null } });
      const mark = slackBodies.length;
      const first = await subsLib.runSubscriptionMaintenance(fake.client());
      const row = await userOf(u.id);
      check(first.orphansCancelled >= 1 && fake.requestsTo("DELETE", `/v1/subscriptions/${u.stripeSubId}`).length === 1 && row.stripeSubId === null && row.plan === "FREE" && row.stripeSubStatus === null && /verwijderd account opgezegd/.test(slackText(mark)), "Erased account left billing (Clerk path): the daily maintenance cancels its subscription at Stripe, resets the row and tells the owner", `Orphan subscription not cancelled: ${JSON.stringify(first)} cancels ${fake.requestsTo("DELETE", "/v1/subscriptions/").length} row ${row.plan}/${row.stripeSubId}`);
      const second = await subsLib.runSubscriptionMaintenance(fake.client());
      check(second.orphansCancelled === 0 && fake.requestsTo("DELETE", "/v1/subscriptions/").length === 1, "Erased account: the maintenance does not cancel it twice", "Orphan cancelled again");
      const { u: u2, cus: cus2 } = await subUser({ plan: "MONTEUR_PRO", stripeSubId: `sub_qa_orphan${++n}`, stripeSubStatus: "active", stripeCurrentPeriodEnd: new Date(Date.now() + 20 * 86400_000) });
      fake.state.subscriptions[u2.stripeSubId!] = fake.subscription({ id: u2.stripeSubId!, customer: cus2, priceId: PRICES.MONTEUR_PRO, userId: u2.id });
      await prisma.user.update({ where: { id: u2.id }, data: { email: `deleted-${u2.id}@anon.wasfix.nl` } });
      fake.fail("DELETE", "/v1/subscriptions/", 500, 1);
      const mark2 = slackBodies.length;
      const failed = await subsLib.runSubscriptionMaintenance(fake.client());
      check(failed.orphansFailed === 1 && (await userOf(u2.id)).stripeSubId === u2.stripeSubId && /loopt nog/.test(slackText(mark2)), "Erased account: when Stripe refuses the cancel the id is kept (retried next run) and the owner is told", `Failed orphan cancel mishandled: ${JSON.stringify(failed)}`);
      check(typeof (await subsLib.runSubscriptionMaintenance(null)).orphansCancelled === "number", "Maintenance without a Stripe client does not throw", "Maintenance threw without Stripe");
    }
    {
      // Stripe's dunning ends in "cancel the subscription": past_due -> grace over -> sweep -> canceled with the NEW period still ahead.
      resetFake();
      const day = 86400_000;
      const { u, cus } = await subUser();
      const periodStart = nowSec() - 14 * 86400;
      const s = fake.subscription({ id: `sub_qa_np${++n}`, customer: cus, priceId: PRICES.MONTEUR_PRO, status: "active", userId: u.id, periodStart });
      fake.state.subscriptions[s.id] = s;
      await deliver(subEvent("customer.subscription.created", s));
      fake.state.subscriptions[s.id] = { ...s, status: "past_due" };
      await deliver(subEvent("customer.subscription.updated", s));
      const pastDue = await userOf(u.id);
      check(pastDue.stripeSubStatus === "past_due" && sub.effectivePlan(pastDue) === "FREE", "Non-payment: past_due for 14 days is past the 7-day grace (effectivePlan FREE)", `past_due 14 days wrong: ${pastDue.stripeSubStatus} ${sub.effectivePlan(pastDue)}`);
      await subsLib.sweepLapsedSubscriptions();
      const swept = await userOf(u.id);
      check(swept.plan === "FREE" && swept.stripeSubId === s.id, "Non-payment: the sweep sets the plan to FREE and keeps the subscription id", `Sweep wrong: ${swept.plan} ${swept.stripeSubId}`);
      // Stripe now gives up: canceled, and the period it advanced when it created the unpaid invoice ends 16 days from now.
      fake.state.subscriptions[s.id] = { ...s, status: "canceled", cancellation_details: { reason: "payment_failed" }, current_period_start: periodStart + 30 * 86400, current_period_end: periodStart + 60 * 86400 };
      const del = await deliver(subEvent("customer.subscription.deleted", s));
      const after = await userOf(u.id);
      check(del.status === 200 && after.plan === "FREE" && sub.effectivePlan(after) === "FREE" && sub.effectivePlan(after, new Date(Date.now() + 5 * day)) === "FREE" && after.stripeSubId === null, "Non-payment: when Stripe cancels the unpaid subscription the customer stays on FREE (the unpaid month is not paid-for time)", `Paid plan restored after non-payment: plan ${after.plan} effective ${sub.effectivePlan(after)} status ${after.stripeSubStatus} through ${after.stripeCurrentPeriodEnd}`);
      await deliver(subEvent("customer.subscription.updated", { ...s, status: "active" }));
      check((await userOf(u.id)).plan === "FREE", "Non-payment: a stale 'updated(active)' after the cancellation does not bring the plan back", "Stale event restored the plan after non-payment");
    }
    {
      resetFake();
      const { u: u3, cus: cus3 } = await subUser();
      const s3 = fake.subscription({ id: `sub_qa_u${++n}`, customer: cus3, priceId: PRICES.BEDRIJF, status: "active", userId: u3.id });
      fake.state.subscriptions[s3.id] = s3;
      await deliver(subEvent("customer.subscription.created", s3));
      fake.state.subscriptions[s3.id] = { ...s3, status: "unpaid" };
      await deliver(subEvent("customer.subscription.updated", s3));
      const unpaidRow = await userOf(u3.id);
      check(unpaidRow.plan === "FREE" && unpaidRow.stripeSubStatus === "unpaid" && unpaidRow.stripeSubId === s3.id && unpaidRow.stripeCurrentPeriodEnd !== null && Math.abs(unpaidRow.stripeCurrentPeriodEnd.getTime() - s3.current_period_start * 1000) < 1000, "Unpaid: back to FREE at once (no payment was received for the period); the subscription id stays so the billing portal can settle it", `Unpaid handled wrong: ${JSON.stringify({ plan: unpaidRow.plan, status: unpaidRow.stripeSubStatus, id: unpaidRow.stripeSubId })}`);
      signIn(u3);
      const unpaidSubscribe = await post(subscribeRoute, "/api/stripe/subscribe", { plan: "BEDRIJF" });
      const unpaidBody = (await unpaidSubscribe.json()) as Json;
      check(unpaidSubscribe.status === 200 && unpaidBody.portal === true && fake.requestsTo("POST", "/v1/checkout/sessions").length === 0, "Unpaid: subscribing again goes to the billing portal, not to a second subscription", `Unpaid customer got a second Checkout: ${unpaidSubscribe.status} ${JSON.stringify(unpaidBody)}`);
      signIn(null);

      const mark = slackBodies.length;
      const ghost = fake.subscription({ id: `sub_qa_ghost${++n}`, customer: "cus_qa_nobody", priceId: PRICES.PARTICULIER });
      fake.state.subscriptions[ghost.id] = ghost;
      const rg = await deliver(subEvent("customer.subscription.created", ghost));
      check(rg.status === 200 && /zonder gebruiker/.test(slackText(mark)), "Subscription of an unknown customer: acknowledged and the owner is told (no silent drop)", `Unknown customer: ${rg.status}`);

      const { u: u4, cus: cus4 } = await subUser({ plan: "PARTICULIER" });
      const s4 = fake.subscription({ id: `sub_qa_up${++n}`, customer: cus4, priceId: "price_not_configured", status: "active", userId: u4.id });
      fake.state.subscriptions[s4.id] = s4;
      const mark4 = slackBodies.length;
      await deliver(subEvent("customer.subscription.updated", s4));
      check((await userOf(u4.id)).plan === "PARTICULIER" && /aan geen plan gekoppeld/.test(slackText(mark4)), "Unknown price id: the plan is left alone and the owner is told which price to map", `Unknown price handled wrong: ${(await userOf(u4.id)).plan}`);

      const { u: u5, cus: cus5 } = await subUser();
      await prisma.user.update({ where: { id: u5.id }, data: { email: `deleted-${u5.id}@anon.wasfix.nl`, name: "Verwijderd account" } });
      const s5 = fake.subscription({ id: `sub_qa_er${++n}`, customer: cus5, priceId: PRICES.BEDRIJF, status: "active", userId: u5.id });
      fake.state.subscriptions[s5.id] = s5;
      await deliver(subEvent("customer.subscription.created", s5));
      check((await userOf(u5.id)).plan === "FREE" && fake.requestsTo("DELETE", `/v1/subscriptions/${s5.id}`).length === 1, "Erased account: a live subscription event never hands it a plan and the orphan subscription is cancelled at Stripe", `Erased account mishandled: ${(await userOf(u5.id)).plan}, cancels ${fake.requestsTo("DELETE", "/v1/subscriptions/").length}`);

      const { u: u6, cus: cus6 } = await subUser();
      const other = await subUser();
      const s6 = fake.subscription({ id: `sub_qa_mm${++n}`, customer: other.cus, priceId: PRICES.BEDRIJF, status: "active", userId: u6.id });
      fake.state.subscriptions[s6.id] = s6;
      await deliver(subEvent("customer.subscription.created", s6));
      check((await userOf(u6.id)).plan === "FREE" && cus6 !== other.cus, "Metadata pointing at another Stripe customer's account never grants a plan", "A subscription of another customer was applied through metadata.userId");
    }
    {
      // pure rules
      const day = 86400_000;
      const now = new Date();
      const at = (d: number) => new Date(now.getTime() + d * day);
      const table: Array<[string, Parameters<typeof sub.effectivePlan>[0], string]> = [
        ["FREE stays FREE", { plan: "FREE", stripeSubStatus: "active" }, "FREE"],
        ["no status = stored plan (admin grant, old row)", { plan: "BEDRIJF" }, "BEDRIJF"],
        ["active", { plan: "BEDRIJF", stripeSubStatus: "active", stripeCurrentPeriodEnd: at(20) }, "BEDRIJF"],
        ["trialing", { plan: "BEDRIJF", stripeSubStatus: "trialing", stripeCurrentPeriodEnd: at(5) }, "BEDRIJF"],
        ["past_due inside grace", { plan: "BEDRIJF", stripeSubStatus: "past_due", stripeCurrentPeriodEnd: at(-(sub.PAST_DUE_GRACE_DAYS - 1)) }, "BEDRIJF"],
        ["past_due after grace", { plan: "BEDRIJF", stripeSubStatus: "past_due", stripeCurrentPeriodEnd: at(-(sub.PAST_DUE_GRACE_DAYS + 1)) }, "FREE"],
        ["past_due without a date", { plan: "BEDRIJF", stripeSubStatus: "past_due" }, "FREE"],
        ["canceled, period still ahead (immediate cancel or Stripe's dunning gave up): ended", { plan: "BEDRIJF", stripeSubStatus: "canceled", stripeCurrentPeriodEnd: at(3) }, "FREE"],
        ["canceled, period over", { plan: "BEDRIJF", stripeSubStatus: "canceled", stripeCurrentPeriodEnd: at(-1) }, "FREE"],
        ["canceled, no date", { plan: "BEDRIJF", stripeSubStatus: "canceled" }, "FREE"],
        ["active with cancel_at_period_end keeps the plan until Stripe ends it", { plan: "BEDRIJF", stripeSubStatus: "active", stripeCancelAtPeriodEnd: true, stripeCurrentPeriodEnd: at(3) }, "BEDRIJF"],
        ["unpaid", { plan: "BEDRIJF", stripeSubStatus: "unpaid", stripeCurrentPeriodEnd: at(10) }, "FREE"],
        ["incomplete_expired", { plan: "BEDRIJF", stripeSubStatus: "incomplete_expired" }, "FREE"],
        ["unknown status fails closed", { plan: "BEDRIJF", stripeSubStatus: "wat" }, "FREE"],
        ["ISO string dates", { plan: "BEDRIJF", stripeSubStatus: "past_due", stripeCurrentPeriodEnd: at(-2).toISOString() }, "BEDRIJF"],
        ["ISO string dates after grace", { plan: "BEDRIJF", stripeSubStatus: "past_due", stripeCurrentPeriodEnd: at(-(sub.PAST_DUE_GRACE_DAYS + 2)).toISOString() }, "FREE"],
      ];
      const wrong = table.filter(([, u, want]) => sub.effectivePlan(u, now) !== want).map(([name]) => name);
      check(wrong.length === 0, `effectivePlan: ${table.length} status/date cases behave as specified`, `effectivePlan wrong for: ${wrong.join("; ")}`);
      const notice = sub.subscriptionNotice({ plan: "MONTEUR_PRO", stripeSubStatus: "past_due", stripeCurrentPeriodEnd: at(-2) }, now);
      check(notice?.kind === "past_due" && sub.subscriptionNotice({ plan: "MONTEUR_PRO", stripeSubStatus: "active", stripeCurrentPeriodEnd: at(9) }, now) === null, "subscriptionNotice: a past_due account gets a banner notice, a healthy one none", "subscriptionNotice wrong");
      const ending = sub.subscriptionNotice({ plan: "MONTEUR_PRO", stripeSubStatus: "active", stripeCancelAtPeriodEnd: true, stripeCurrentPeriodEnd: at(9) }, now);
      const endedNothing = sub.subscriptionNotice({ plan: "MONTEUR_PRO", stripeSubStatus: "canceled", stripeCurrentPeriodEnd: at(9) }, now);
      check(ending?.kind === "ending" && ending.endsAt.getTime() === at(9).getTime() && endedNothing === null && sub.subscriptionNotice({ plan: "MONTEUR_PRO", stripeSubStatus: "active", stripeCurrentPeriodEnd: at(9) }, now) === null, "subscriptionNotice: 'ending' follows cancel_at_period_end only (a canceled subscription has already ended and gets no notice); without that field there is none", `subscriptionNotice ending wrong: ${JSON.stringify(ending)} / ${JSON.stringify(endedNothing)}`);
    }

    // ── 8. The subscribe route ──────────────────────────────────────────
    {
      resetFake();
      const u = await mkUser();
      signIn(u);
      const before = fake.requests.length;
      const r = await post(subscribeRoute, "/api/stripe/subscribe", { plan: "PARTICULIER" });
      const body = (await r.json()) as Json;
      const sessions = fake.requestsTo("POST", "/v1/checkout/sessions");
      const p = sessions[0]?.body ?? {};
      check(r.status === 200 && typeof body.checkoutUrl === "string" && sessions.length === 1 && fake.requests.length > before, "Subscribe: a first subscription creates one Checkout session and returns its URL", `Subscribe failed: ${r.status} ${JSON.stringify(body)}`);
      check(p.mode === "subscription" && p.payment_method_types?.join(",") === "card,ideal" && !JSON.stringify(p).includes("bancontact") && p.locale === "nl", "Subscribe payload: mode subscription, payment methods card + ideal only (no Bancontact), Dutch locale", `Subscribe payload methods wrong: ${JSON.stringify(p.payment_method_types)} ${p.locale}`);
      check(p.line_items?.[0]?.price === PRICES.PARTICULIER && p.line_items?.[0]?.quantity === "1" && p.automatic_tax?.enabled === "true" && p.tax_id_collection?.enabled === "true", "Subscribe payload: the plan's price, automatic tax and btw-number collection stay on", `Subscribe payload price/tax wrong: ${JSON.stringify(p.line_items)} ${JSON.stringify(p.automatic_tax)}`);
      check(p.metadata?.userId === u.id && p.metadata?.plan === "PARTICULIER" && p.subscription_data?.metadata?.userId === u.id && p.subscription_data?.metadata?.plan === "PARTICULIER" && p.success_url === `${APP}/dashboard?upgraded=1` && p.cancel_url === `${APP}/prijzen`, "Subscribe payload: metadata keys (userId, plan) and the success/cancel URLs", `Subscribe metadata/urls wrong: ${JSON.stringify(p.metadata)} ${p.success_url}`);
      check(p.subscription_data?.trial_period_days === "14", "Subscribe payload: a first subscription gets the advertised 14-day trial", `Trial missing: ${JSON.stringify(p.subscription_data)}`);
      const first = sessions[0]?.idempotencyKey;
      await post(subscribeRoute, "/api/stripe/subscribe", { plan: "PARTICULIER" });
      const second = fake.requestsTo("POST", "/v1/checkout/sessions")[1]?.idempotencyKey;
      check(!!first && first === second && Object.keys(fake.state.sessions).length === 1 && Object.keys(fake.state.customers).length === 1 && !!fake.requestsTo("POST", "/v1/customers")[0].idempotencyKey, "Subscribe: a repeated click lands on ONE Checkout session and ONE customer at Stripe (stable idempotency keys, which the fake honours like Stripe)", `Double click made ${Object.keys(fake.state.sessions).length} sessions / ${Object.keys(fake.state.customers).length} customers (keys ${first} vs ${second})`);
      check((await userOf(u.id)).stripeCustomerId !== null, "Subscribe: the Stripe customer id is stored", "Customer id not stored");
    }
    {
      resetFake();
      const u = await mkUser({ trialUsedAt: new Date(Date.now() - 60 * 86400_000) });
      signIn(u);
      await post(subscribeRoute, "/api/stripe/subscribe", { plan: "MONTEUR_PRO" });
      const p = fake.requestsTo("POST", "/v1/checkout/sessions")[0]?.body ?? {};
      check(p.subscription_data && p.subscription_data.trial_period_days === undefined, "Trial once: a user whose trial was used gets a Checkout WITHOUT trial_period_days", `Second trial granted: ${JSON.stringify(p.subscription_data)}`);

      const { u: u2, cus } = await subUser();
      fake.state.subscriptions["sub_qa_old"] = fake.subscription({ id: "sub_qa_old", customer: cus, priceId: PRICES.PARTICULIER, status: "canceled", userId: u2.id });
      signIn(u2);
      await post(subscribeRoute, "/api/stripe/subscribe", { plan: "PARTICULIER" });
      const p2 = fake.requestsTo("POST", "/v1/checkout/sessions").at(-1)?.body ?? {};
      check(p2.subscription_data && p2.subscription_data.trial_period_days === undefined, "Trial once: an account that had a subscription at Stripe before the trial column existed gets no trial either", `Trial farming possible: ${JSON.stringify(p2.subscription_data)}`);
    }
    {
      resetFake();
      const { u, cus } = await subUser({ plan: "MONTEUR_PRO", stripeSubId: "sub_qa_live", stripeSubStatus: "active" });
      fake.state.subscriptions["sub_qa_live"] = fake.subscription({ id: "sub_qa_live", customer: cus, priceId: PRICES.MONTEUR_PRO, userId: u.id });
      signIn(u);
      const r = await post(subscribeRoute, "/api/stripe/subscribe", { plan: "BEDRIJF" });
      const body = (await r.json()) as Json;
      const portal = fake.requestsTo("POST", "/v1/billing_portal/sessions");
      check(r.status === 200 && body.portal === true && body.alreadySubscribed === true && typeof body.checkoutUrl === "string" && body.checkoutUrl.includes("billing.stripe.test") && fake.requestsTo("POST", "/v1/checkout/sessions").length === 0 && portal.length === 1 && portal[0].body.customer === cus, "Second subscription: a live subscriber is sent to the billing portal, no second Checkout session is created", `Double subscription possible: ${r.status} ${JSON.stringify(body)} sessions ${fake.requestsTo("POST", "/v1/checkout/sessions").length}`);
      fake.state.subscriptions["sub_qa_live"].status = "canceled";
      const r2 = await post(subscribeRoute, "/api/stripe/subscribe", { plan: "BEDRIJF" });
      check(r2.status === 200 && fake.requestsTo("POST", "/v1/checkout/sessions").length === 1, "Second subscription: when the stored subscription is dead at Stripe a new Checkout is allowed", `Dead subscription still blocks: ${r2.status}`);
    }
    {
      // The webhook for a subscription that was just paid has not landed (late or failed): the user has no stripeSubId yet.
      resetFake();
      const { u, cus } = await subUser();
      fake.state.subscriptions["sub_qa_late"] = fake.subscription({ id: "sub_qa_late", customer: cus, priceId: PRICES.MONTEUR_PRO, userId: u.id });
      signIn(u);
      const r = await post(subscribeRoute, "/api/stripe/subscribe", { plan: "BEDRIJF" });
      const body = (await r.json()) as Json;
      check(r.status === 200 && body.portal === true && fake.requestsTo("POST", "/v1/checkout/sessions").length === 0 && (await userOf(u.id)).stripeSubId === null, "Second subscription while the webhook is late: Stripe is asked, a customer with a live subscription goes to the portal, no second Checkout", `Late webhook allowed a second subscription: ${r.status} ${JSON.stringify(body)} sessions ${fake.requestsTo("POST", "/v1/checkout/sessions").length}`);
      signIn(null);
    }
    {
      resetFake();
      const u = await mkUser();
      signIn(u);
      const mark = slackBodies.length;
      fake.state.prices[PRICES.PARTICULIER].unit_amount = 999;
      const r = await post(subscribeRoute, "/api/stripe/subscribe", { plan: "PARTICULIER" });
      check(r.status === 500 && fake.requestsTo("POST", "/v1/checkout/sessions").length === 0 && /wijkt af: unit_amount/.test(slackText(mark)), "Price check: a Stripe price with the wrong amount blocks the Checkout and alerts the owner", `Wrong price sold: ${r.status}`);
      fake.state.prices[PRICES.PARTICULIER].unit_amount = 499;
      fake.state.prices[PRICES.PARTICULIER].tax_behavior = "unspecified";
      const r2 = await post(subscribeRoute, "/api/stripe/subscribe", { plan: "PARTICULIER" });
      check(r2.status === 500 && fake.requestsTo("POST", "/v1/checkout/sessions").length === 0, "Price check: tax_behavior 'unspecified' is refused", `Unspecified tax behaviour sold: ${r2.status}`);
      fake.state.prices[PRICES.PARTICULIER].tax_behavior = "inclusive";
      const mark2 = slackBodies.length;
      fake.fail("POST", "/v1/checkout/sessions", 500, 1);
      const r3 = await post(subscribeRoute, "/api/stripe/subscribe", { plan: "PARTICULIER" });
      check(r3.status === 500 && /Fout in abonnement afsluiten/.test(slackText(mark2)), "Stripe failure while subscribing: a clean 500 for the customer and an alert for the owner", `Stripe failure not reported: ${r3.status}`);
      const bad = await post(subscribeRoute, "/api/stripe/subscribe", { plan: "FREE" });
      signIn(null);
      const anon = await post(subscribeRoute, "/api/stripe/subscribe", { plan: "PARTICULIER" });
      check(bad.status === 400 && anon.status === 401, "Subscribe: an unknown plan is 400, a visitor who is not signed in is 401", `Guards wrong: ${bad.status}/${anon.status}`);
    }
    {
      resetFake();
      const { u, cus } = await subUser();
      signIn(u);
      const r = await portalRoute.POST();
      const body = (await r.json()) as Json;
      const call = fake.requestsTo("POST", "/v1/billing_portal/sessions")[0];
      check(r.status === 200 && typeof body.url === "string" && call?.body.customer === cus && call?.body.return_url === `${APP}/dashboard/profiel`, "Portal: a customer gets a portal session with the right return URL", `Portal wrong: ${r.status} ${JSON.stringify(body)}`);
      const nobody = await mkUser();
      signIn(nobody);
      const r2 = await portalRoute.POST();
      check(r2.status === 400, "Portal: an account without a Stripe customer gets 'geen actief abonnement'", `Portal for a non-customer: ${r2.status}`);
      signIn(u);
      const mark = slackBodies.length;
      fake.fail("POST", "/v1/billing_portal/sessions", 400, 1);
      const r3 = await portalRoute.POST();
      check(r3.status === 500 && /klantportaal/i.test(slackText(mark)), "Portal: a Stripe error (for example an unsaved portal configuration) is reported to the owner", `Portal error silent: ${r3.status}`);
      signIn(null);
    }

    // ── 7b. Reconciling PENDING orders whose webhook never came ─────────
    {
      resetFake();
      const { reconcilePendingStripeOrders } = await import("../src/app/api/stripe/_lib/reconcile");
      const old = new Date(Date.now() - 60 * 60_000);
      const mk = async (sid: string, state: Json, createdAt: Date) => {
        const o = await mkOrder({ qty: 1, stock: 5, stripePaymentId: sid, createdAt });
        fake.state.sessions[sid] = { id: sid, object: "checkout.session", metadata: { orderId: o.order.id }, amount_total: cents(o.order.totalEur), currency: "eur", payment_intent: `pi_qa_${o.order.id}`, ...state };
        return o;
      };
      const paid = await mk(`cs_test_rec_paid_${n}`, { status: "complete", payment_status: "paid" }, old);
      const expired = await mk(`cs_test_rec_exp_${n}`, { status: "expired", payment_status: "unpaid" }, old);
      const open = await mk(`cs_test_rec_open_${n}`, { status: "open", payment_status: "unpaid" }, old);
      const fresh = await mk(`cs_test_rec_new_${n}`, { status: "complete", payment_status: "paid" }, new Date());
      const mark = slackBodies.length;
      const res = await reconcilePendingStripeOrders();
      check((await orderOf(paid.order.id)).status === "PAID" && (await invoiceCount(paid.order.id)) === 1 && (await paid.stockNow()) === 4 && mailsTo(paid.order.email).length === 1, "Reconcile: a PENDING order that Stripe knows as paid is fulfilled (PAID, invoice, stock, confirmation) without its webhook", `Reconcile did not fulfil: ${(await orderOf(paid.order.id)).status}`);
      check((await orderOf(expired.order.id)).status === "CANCELLED" && (await orderOf(open.order.id)).status === "PENDING" && (await orderOf(fresh.order.id)).status === "PENDING", "Reconcile: an expired session is cancelled; an open session and an order younger than 15 minutes are left alone", "Reconcile touched the wrong orders");
      check(res.fulfilled === 1 && res.cancelled === 1 && res.unpaid === 1 && res.errors === 0 && /zonder webhook/.test(slackText(mark)), "Reconcile: the result counts and the owner hears that a webhook was missed", `Reconcile result wrong: ${JSON.stringify(res)}`);
      const again = await reconcilePendingStripeOrders();
      check(again.fulfilled === 0 && (await paid.stockNow()) === 4, "Reconcile: running it again changes nothing", "Reconcile is not idempotent");
    }

    {
      resetFake();
      const { reconcilePendingStripeOrders } = await import("../src/app/api/stripe/_lib/reconcile");
      const old = new Date(Date.now() - 60 * 60_000);
      const session = (o: { order: { id: string; totalEur: number } }, sid: string, extra: Json = {}) => {
        fake.state.sessions[sid] = { id: sid, object: "checkout.session", metadata: { orderId: o.order.id }, status: "complete", payment_status: "paid", amount_total: cents(o.order.totalEur), currency: "eur", payment_intent: `pi_qa_${o.order.id}`, ...extra };
      };
      // The stored session id points at a session that belongs to ANOTHER order: never fulfil an order from somebody else's payment.
      const victim = await mkOrder({ qty: 1, stock: 5, stripePaymentId: `cs_test_rec_foreign_${n}`, createdAt: old });
      const other = await mkOrder({ qty: 1, stock: 5 });
      session(other, victim.order.stripePaymentId!);
      await reconcilePendingStripeOrders();
      check((await orderOf(victim.order.id)).status === "PENDING" && (await invoiceCount(victim.order.id)) === 0 && (await victim.stockNow()) === 5, "Reconcile: a stored session whose metadata names a different order is skipped (the order is not fulfilled from another order's payment)", "Reconcile fulfilled an order from a session that belongs to another order");

      // A paid session whose amount does not match: the owner hears about it ONCE, not on every run.
      const wrong = await mkOrder({ qty: 1, stock: 5, stripePaymentId: `cs_test_rec_wrong_${n}`, createdAt: old });
      session(wrong, wrong.order.stripePaymentId!, { amount_total: 1 });
      const mark = slackBodies.length;
      const runs = [] as Awaited<ReturnType<typeof reconcilePendingStripeOrders>>[];
      for (let i = 0; i < 4; i++) runs.push(await reconcilePendingStripeOrders());
      const alerts = slackBodies.slice(mark).filter((b) => /niet overeen/.test(b)).length;
      check(alerts === 1 && runs[0].rejected === 1 && runs[1].rejected === 0 && runs[1].skipped >= 1 && (await orderOf(wrong.order.id)).status === "PENDING", "Reconcile: a payment that cannot be booked (amount mismatch) alerts the owner on the first run only (4 runs, 1 alert), the order stays PENDING", `Reconcile alert spam: ${alerts} alerts in 4 runs, ${JSON.stringify(runs.map((r) => [r.rejected, r.skipped]))}`);
      // ...and the order is looked at again once its payment is a different one.
      session(wrong, wrong.order.stripePaymentId!, { amount_total: cents(wrong.order.totalEur) });
      const fixedRun = await reconcilePendingStripeOrders();
      check(fixedRun.skipped >= 1 && (await orderOf(wrong.order.id)).status === "PENDING", "Reconcile: a reported order stays skipped on later runs (no silent retry loop), even if its session changes in the meantime", "A reported order was retried");
    }
    {
      // 52 older open sessions must not hide a paid order behind them (the scan used to stop after the oldest 50).
      resetFake();
      const { reconcilePendingStripeOrders } = await import("../src/app/api/stripe/_lib/reconcile");
      const stale = new Date(Date.now() - 3 * 3600_000);
      const part = await mkPart(500);
      for (let i = 0; i < 52; i++) {
        const o = await mkOrder({ part, qty: 1, stripePaymentId: `cs_test_rec_open_many_${n}_${i}`, createdAt: new Date(stale.getTime() + i * 1000) });
        fake.state.sessions[o.order.stripePaymentId!] = { id: o.order.stripePaymentId, object: "checkout.session", status: "open", payment_status: "unpaid", metadata: { orderId: o.order.id } };
      }
      const late = await mkOrder({ part, qty: 1, stripePaymentId: `cs_test_rec_late_paid_${n}`, createdAt: new Date(Date.now() - 2 * 3600_000) });
      fake.state.sessions[late.order.stripePaymentId!] = { id: late.order.stripePaymentId, object: "checkout.session", status: "complete", payment_status: "paid", metadata: { orderId: late.order.id }, amount_total: cents(late.order.totalEur), currency: "eur", payment_intent: `pi_qa_${late.order.id}` };
      const res = await reconcilePendingStripeOrders({ budgetMs: 120_000 });
      check((await orderOf(late.order.id)).status === "PAID" && res.fulfilled === 1 && res.checked >= 53 && !res.truncated, "Reconcile: a paid order behind 52 older open sessions is still found (all pages are scanned)", `Paid order behind 52 open sessions missed: ${(await orderOf(late.order.id)).status} ${JSON.stringify(res)}`);
      const cut = await reconcilePendingStripeOrders({ limit: 3 });
      check(cut.truncated === true && cut.checked + cut.skipped === 3, "Reconcile: the order cap stops the scan and says it was cut short", `Cap not applied: ${JSON.stringify(cut)}`);
    }

    // ── 8b. Refund helper for the admin cancel/refund actions ───────────
    {
      resetFake();
      const r = await stripeLib.refundStripePayment({ orderId: "ord_1", paymentIntentId: "pi_qa_x", amountEur: 12.34, idempotencyKey: "cancel-ord_1" });
      const req = fake.requestsTo("POST", "/v1/refunds")[0];
      check(r.ok && r.refundId.startsWith("re_") && r.amountEur === 12.34 && req?.body.payment_intent === "pi_qa_x" && req.body.amount === "1234" && req.idempotencyKey === "cancel-ord_1" && req.body.metadata?.orderId === "ord_1", "refundStripePayment: refunds the payment intent for the exact cents with a stable idempotency key", `refundStripePayment wrong: ${JSON.stringify(r)} ${JSON.stringify(req)}`);
      fake.fail("POST", "/v1/refunds", 500, 1);
      const failed = await stripeLib.refundStripePayment({ orderId: "ord_1", paymentIntentId: "pi_qa_x", amountEur: 5, idempotencyKey: "cancel-ord_2" });
      const before = fake.requestsTo("POST", "/v1/refunds").length;
      const zero = await stripeLib.refundStripePayment({ orderId: "ord_1", paymentIntentId: "pi_qa_x", amountEur: 0, idempotencyKey: "cancel-ord_3" });
      check(!failed.ok && !zero.ok && fake.requestsTo("POST", "/v1/refunds").length === before, "refundStripePayment: a Stripe failure or a zero amount returns {ok:false} (never throws) and a zero amount sends nothing", "refundStripePayment threw or sent a zero refund");
    }

    // ── 9. Readiness ────────────────────────────────────────────────────
    {
      const good = async () => {
        resetFake();
        fake.state.webhookEndpoints = [{ id: "we_qa", object: "webhook_endpoint", url: `${APP}/api/stripe/webhook`, status: "enabled", api_version: stripeLib.STRIPE_API_VERSION, enabled_events: [...events.HANDLED_STRIPE_EVENTS] }];
        return readiness.checkStripeReadiness({ stripe: fake.client(), secretKey: "sk_test_fakefakefakefake", publishableKey: "pk_test_fakefakefakefake", webhookSecret: WH_SECRET, appUrl: APP, priceIds: PRICES });
      };
      const ok = await good();
      check(ok.configured && ok.ok && ok.mode === "test" && ok.checks.every((c) => c.ok) && ok.checks.length >= 11, `Readiness: a correct setup passes all ${ok.checks.length} checks`, `Readiness on a good setup: ${ok.summary} ${ok.checks.filter((c) => !c.ok).map((c) => c.id + ": " + c.detail).join(" | ")}`);
      const flips: Array<[string, () => void | Promise<void>, string]> = [
        ["price amount", () => { fake.state.prices[PRICES.BEDRIJF].unit_amount = 9900; }, "price.BEDRIJF"],
        ["price tax behaviour", () => { fake.state.prices[PRICES.MONTEUR_PRO].tax_behavior = "inclusive"; }, "price.MONTEUR_PRO"],
        ["price interval", () => { fake.state.prices[PRICES.PARTICULIER].recurring.interval = "year"; }, "price.PARTICULIER"],
        ["price currency", () => { fake.state.prices[PRICES.PARTICULIER].currency = "usd"; }, "price.PARTICULIER"],
        ["missing price", () => { delete fake.state.prices[PRICES.BEDRIJF]; }, "price.BEDRIJF"],
        ["webhook missing events", () => { fake.state.webhookEndpoints[0].enabled_events = events.HANDLED_STRIPE_EVENTS.filter((t) => t !== "charge.refunded" && t !== "checkout.session.expired"); }, "webhook.endpoint"],
        ["webhook disabled", () => { fake.state.webhookEndpoints[0].status = "disabled"; }, "webhook.endpoint"],
        ["no webhook for this URL", () => { fake.state.webhookEndpoints[0].url = "https://elsewhere.example/api/stripe/webhook"; }, "webhook.endpoint"],
        ["iDEAL inactive", () => { fake.state.account.capabilities.ideal_payments = "inactive"; }, "payment.ideal"],
        ["card inactive", () => { delete fake.state.account.capabilities.card_payments; }, "payment.card"],
        ["charges disabled", () => { fake.state.account.charges_enabled = false; }, "account"],
        ["Stripe Tax pending", () => { fake.state.taxSettings.status = "pending"; }, "tax"],
        ["no portal configuration", () => { fake.state.portalConfigurations = []; }, "portal"],
        ["portal cancels immediately", () => { fake.state.portalConfigurations[0].features.subscription_cancel.mode = "immediately"; }, "portal.cancel_mode"],
        ["SEPA direct debit inactive (iDEAL subscriptions)", () => { fake.state.account.capabilities.sepa_debit_payments = "inactive"; }, "payment.sepa"],
        ["webhook endpoint on another API version", () => { fake.state.webhookEndpoints[0].api_version = "2025-09-30.clover"; }, "webhook.api_version"],
        ["webhook endpoint without a fixed API version", () => { fake.state.webhookEndpoints[0].api_version = null; }, "webhook.api_version"],
      ];
      const wrong: string[] = [];
      for (const [name, mutate, id] of flips) {
        await good();
        await mutate();
        const res = await readiness.checkStripeReadiness({ stripe: fake.client(), secretKey: "sk_test_fakefakefakefake", publishableKey: "pk_test_fakefakefakefake", webhookSecret: WH_SECRET, appUrl: APP, priceIds: PRICES });
        const failed = res.checks.filter((c) => !c.ok).map((c) => c.id);
        // A "block" check must stop go-live (res.ok false); a "warn" check must be reported without blocking.
        const level = res.checks.find((c) => c.id === id)!.level;
        if (res.ok === (level === "block") || failed.length !== 1 || failed[0] !== id || !res.checks.find((c) => c.id === id)!.fix) wrong.push(`${name} -> ${failed.join(",") || "nothing"} (ok=${res.ok}, level ${level})`);
      }
      check(wrong.length === 0, `Readiness: each of ${flips.length} single defects fails exactly its own check, with a fix text`, `Readiness misses or misattributes: ${wrong.join("; ")}`);
      const mode = await readiness.checkStripeReadiness({ stripe: fake.client(), secretKey: "sk_live_fakefakefakefake", publishableKey: "pk_test_fakefakefakefake", webhookSecret: WH_SECRET, appUrl: APP, priceIds: PRICES });
      const noSecret = await readiness.checkStripeReadiness({ stripe: fake.client(), secretKey: "sk_test_fakefakefakefake", webhookSecret: null, appUrl: APP, priceIds: PRICES });
      check(mode.checks.find((c) => c.id === "key.mode")?.ok === false && noSecret.checks.find((c) => c.id === "webhook.secret")?.ok === false, "Readiness: a live secret key with a test publishable key, and a missing webhook secret, are caught", "Readiness: key mode or webhook secret not checked");
      await good();
      const silent = await readiness.checkStripeReadiness({ stripe: fake.client(), secretKey: "sk_test_fakefakefakefake", publishableKey: "pk_test_fakefakefakefake", webhookSecret: WH_SECRET, appUrl: APP, priceIds: PRICES, ownerChannel: false });
      check(silent.ok === false && silent.checks.filter((c) => !c.ok).map((c) => c.id).join(",") === "owner.channel" && !!silent.checks.find((c) => c.id === "owner.channel")!.fix, "Readiness: no way to tell the owner (no Slack, Discord or e-mail) blocks go-live, with the variables to set", `Readiness ignores a missing owner channel: ${silent.summary}`);
      // A test key on a production deployment is reported (warn); a live key, or a non-production deployment, is fine.
      const prodTest = await readiness.checkStripeReadiness({ stripe: fake.client(), secretKey: "sk_test_fakefakefakefake", publishableKey: "pk_test_fakefakefakefake", webhookSecret: WH_SECRET, appUrl: APP, priceIds: PRICES, production: true });
      const prodLive = await readiness.checkStripeReadiness({ stripe: fake.client(), secretKey: "sk_live_fakefakefakefake", publishableKey: "pk_live_fakefakefakefake", webhookSecret: WH_SECRET, appUrl: APP, priceIds: PRICES, production: true });
      check(prodTest.checks.find((c) => c.id === "key.production")?.ok === false && prodTest.checks.find((c) => c.id === "key.production")?.level === "warn" && prodLive.checks.find((c) => c.id === "key.production")?.ok === true, "Readiness: a test key on a production deployment is reported (warn), a live key is not", "Readiness does not notice a test key in production");
      // The environment-driven path (no explicit options): the keys, the three STRIPE_PRICE_* ids, the webhook secret and the app URL come from the environment.
      await good();
      const fromEnv = await readiness.checkStripeReadiness({ stripe: fake.client() });
      check(fromEnv.ok && fromEnv.checks.every((c) => c.ok) && fromEnv.checks.some((c) => c.id === "price.BEDRIJF" && c.detail.includes(PRICES.BEDRIJF)) && fromEnv.checks.some((c) => c.id === "webhook.endpoint" && c.detail.includes(`${APP}/api/stripe/webhook`)), "Readiness: with no options it reads STRIPE_SECRET_KEY, STRIPE_PRICE_*, STRIPE_WEBHOOK_SECRET and the app URL from the environment", `Readiness from the environment: ${fromEnv.summary} ${fromEnv.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`).join(" | ")}`);
      const requestsBefore = fake.requests.length;
      const none = await readiness.checkStripeReadiness({ secretKey: null });
      check(none.configured === false && none.ok === false && none.checks.length === 1 && fake.requests.length === requestsBefore && /niet geconfigureerd/.test(none.summary), "Readiness: without a key it says 'not configured' cleanly and calls nothing", `Readiness without key: ${JSON.stringify(none)}`);
      resetFake();
      fake.fail("GET", "/v1/account", 500, 1);
      const broken = await readiness.checkStripeReadiness({ stripe: fake.client(), secretKey: "sk_test_fakefakefakefake", webhookSecret: WH_SECRET, appUrl: APP, priceIds: PRICES });
      check(broken.ok === false && broken.checks.find((c) => c.id === "account")?.ok === false && !JSON.stringify(broken).includes("fakefakefakefake"), "Readiness: a Stripe outage becomes failed checks (never an exception) and no key appears in the report", "Readiness threw or leaked a key on a Stripe error");
    }
    // notify module is part of the harness contract: keep the import used
    check(notify.hasNotifyChannel(), "Harness: the fake Slack counts as a configured owner channel", "Harness: no owner channel");
    check(typeof lease.STRIPE_EVENT_LEASE_MS === "number" && lease.STRIPE_EVENT_LEASE_MS > 30_000, "Lease: longer than the route's 30 s maxDuration, so a running function is never taken over", "Lease is shorter than maxDuration");
    check(typeof webhook.maxDuration === "number" && webhook.maxDuration === 30, "Webhook route: maxDuration is 30", "Webhook route: maxDuration missing");
    const unproved = events.HANDLED_STRIPE_EVENTS.filter((t) => !proved.has(t));
    check(unproved.length === 0, `Events: every one of the ${events.HANDLED_STRIPE_EVENTS.length} handled types has a check that proves its real effect, not just a 200`, `Event types without a proving check: ${unproved.join(", ")}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  async function prodScenario() {
    check(env.IS_PRODUCTION && env.DEMO_MODE === true && isDemoMode() === false, `${T} Precondition: NODE_ENV=production with DEMO_MODE=true (raw flag on, isDemoMode() off), as wasfix.nl runs`, `${T} Precondition not met: production ${env.IS_PRODUCTION}, DEMO_MODE ${env.DEMO_MODE}, isDemoMode ${isDemoMode()}`);

    // A plan without a Stripe price is refused, never granted.
    {
      const u = await mkUser();
      signIn(u);
      const r = await post(subscribeRoute, "/api/stripe/subscribe", { plan: "BEDRIJF" });
      check(r.status === 503 && (await userOf(u.id)).plan === "FREE", `${T} Subscribe: Stripe key present but no price for the plan -> 503 and no plan change, even with DEMO_MODE=true`, `${T} Plan without price: ${r.status}, plan ${(await userOf(u.id)).plan}`);
    }

    // ── Account erasure ─────────────────────────────────────────────────
    const erasable = async (extra: Record<string, unknown> = {}) => {
      resetFake();
      const cus = `cus_qa_del_${++n}`;
      const u = await mkUser({ plan: "MONTEUR_PRO", stripeCustomerId: cus, stripeSubId: `sub_qa_del_${n}`, stripeSubStatus: "active", stripeCurrentPeriodEnd: new Date(Date.now() + 20 * 86400_000), ...extra });
      fake.state.customers[cus] = { id: cus, object: "customer", email: u.email, name: "QA Klant" };
      fake.state.subscriptions[u.stripeSubId!] = fake.subscription({ id: u.stripeSubId!, customer: cus, priceId: PRICES.MONTEUR_PRO, userId: u.id });
      return u;
    };
    const erase = async (u: { id: string; email: string }) => {
      signIn(u);
      const r = await post(deleteRoute, "/api/account/delete", { confirmation: "VERWIJDER MIJN ACCOUNT" });
      return { status: r.status, body: (await r.json()) as Json };
    };
    {
      const u = await erasable();
      fake.state.paymentMethods.push({ id: `pm_qa_${n}`, object: "payment_method", customer: u.stripeCustomerId, billing_details: { name: "QA Klant", email: u.email } });
      const delivered = await mkOrder({ status: "DELIVERED", userId: u.id, qty: 1 });
      await prisma.order.update({ where: { id: delivered.order.id }, data: { deliveredAt: new Date(Date.now() - 40 * 86400_000) } });
      await inv.issueInvoiceForOrder(delivered.order.id);
      // What the database looks like at the moment Stripe is asked to cancel.
      let atCancel: { email: string; subId: string | null; customerId: string | null; plan: string } | null = null;
      fake.hook("DELETE", "/v1/subscriptions/", async () => {
        const r = await userOf(u.id);
        atCancel = { email: r.email, subId: r.stripeSubId, customerId: r.stripeCustomerId, plan: r.plan };
      });
      const { status, body } = await erase(u);
      const row = await userOf(u.id);
      const cancel = fake.requestsTo("DELETE", `/v1/subscriptions/${u.stripeSubId}`);
      const scrub = fake.requestsTo("POST", `/v1/customers/${u.stripeCustomerId}`);
      check(status === 200 && cancel.length === 1 && row.stripeSubId === null && row.stripeCustomerId === null && row.plan === "FREE" && row.stripeSubStatus === null && row.email.endsWith("@anon.wasfix.nl"), `${T} Erasure: the Stripe subscription is cancelled and the row ends anonymised on FREE (a DELIVERED order past the 30-day return window does not block)`, `${T} Erasure wrong: ${status} ${JSON.stringify(body)} cancels ${cancel.length} row ${JSON.stringify(row)}`);
      const seen = atCancel as { email: string; subId: string | null; customerId: string | null; plan: string } | null;
      check(!!seen && seen.email === u.email && seen.subId === u.stripeSubId && seen.customerId === u.stripeCustomerId && seen.plan === "MONTEUR_PRO", `${T} Erasure: at the moment Stripe is asked to cancel, the ids and the real e-mail are still in the database (cancel comes BEFORE the erasure)`, `${T} Cancel came after the erasure started: ${JSON.stringify(seen)}`);
      check(/opgezegd/.test(body.message) && body.subscription === "cancelled", `${T} Erasure: the reply says honestly that the subscription was cancelled`, `${T} Erasure reply: ${body.message}`);
      check(scrub.length === 1 && scrub[0].body.name === "Verwijderd account" && String(scrub[0].body.email).endsWith("@anon.wasfix.nl"), `${T} Erasure: the Stripe customer record is anonymised after the commit (best effort)`, `${T} Stripe customer not anonymised: ${JSON.stringify(scrub[0]?.body)}`);
      check(fake.requestsTo("POST", "/v1/payment_methods/").length === 1 && fake.state.paymentMethods[0].customer === null, `${T} Erasure: the saved payment methods of the Stripe customer are detached`, `${T} Payment methods still attached: ${JSON.stringify(fake.state.paymentMethods)}`);
      check(/opgeslagen betaalmethoden gewist/.test(body.message) && /blijven bij Stripe staan/.test(body.message), `${T} Erasure: the reply says what was wiped at Stripe and that payments and invoices already issued stay there`, `${T} Erasure reply does not describe Stripe honestly: ${body.message}`);
    }
    {
      // The 30-day return window and shipped orders.
      const fmt = (d: Date) => new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }).format(d);
      const shipped = await erasable();
      await mkOrder({ status: "SHIPPED", userId: shipped.id, qty: 1 });
      const a = await erase(shipped);
      check(a.status === 409 && /onderweg/.test(a.body.error) && (await userOf(shipped.id)).email === shipped.email && fake.requestsTo("DELETE", "/v1/subscriptions/").length === 0, `${T} Erasure refused while an order is SHIPPED (it can still be refused or returned); nothing cancelled, nothing erased`, `${T} SHIPPED order did not block: ${a.status} ${JSON.stringify(a.body)}`);
      const recent = await erasable();
      const deliveredAt = new Date(Date.now() - 10 * 86400_000);
      const o = await mkOrder({ status: "DELIVERED", userId: recent.id, qty: 1 });
      await prisma.order.update({ where: { id: o.order.id }, data: { deliveredAt } });
      const b = await erase(recent);
      check(b.status === 409 && b.body.error.includes(fmt(new Date(deliveredAt.getTime() + 30 * 86400_000))) && (await userOf(recent.id)).email === recent.email, `${T} Erasure refused for 30 days after delivery, and the message says from which date it is possible`, `${T} Recently delivered order did not block or gave no date: ${b.status} ${JSON.stringify(b.body)}`);
      await prisma.order.update({ where: { id: o.order.id }, data: { deliveredAt: new Date(Date.now() - 31 * 86400_000) } });
      const c = await erase(recent);
      check(c.status === 200, `${T} Erasure: 31 days after delivery the order no longer blocks`, `${T} Order past the return window still blocks: ${c.status} ${JSON.stringify(c.body)}`);
    }
    for (const [status, label, age] of [["PAID", "paid but not shipped", 0], ["OPENSTAAND", "open (waiting for a transfer)", 0], ["PENDING", "recent unpaid Stripe", 3600_000]] as const) {
      const u = await erasable();
      await mkOrder({ status, userId: u.id, qty: 1, createdAt: new Date(Date.now() - age) });
      const { status: code, body } = await erase(u);
      const row = await userOf(u.id);
      check(code === 409 && /Er is niets gewist/.test(body.error) && row.email === u.email && row.stripeSubId === u.stripeSubId && fake.requestsTo("DELETE", "/v1/subscriptions/").length === 0, `${T} Erasure refused (409, Dutch message) while an order is ${label}; nothing cancelled, nothing erased`, `${T} Erasure not refused for ${label}: ${code} ${JSON.stringify(body)}`);
    }
    {
      const u = await erasable();
      await mkOrder({ status: "PENDING", userId: u.id, qty: 1, createdAt: new Date(Date.now() - 3 * 86400_000) });
      const { status } = await erase(u);
      check(status === 200, `${T} Erasure: an abandoned PENDING order (3 days old) does not block it`, `${T} Abandoned PENDING order blocked erasure: ${status}`);
    }
    {
      const u = await erasable();
      fake.fail("DELETE", "/v1/subscriptions/", 500, 1);
      const { status, body } = await erase(u);
      const row = await userOf(u.id);
      check(status === 502 && row.email === u.email && row.stripeSubId === u.stripeSubId && /niets gewist/.test(body.error), `${T} Erasure: if Stripe cannot cancel the subscription nothing is erased and the ids are kept (retry possible)`, `${T} Half erasure: ${status} ${JSON.stringify(body)}`);
      const again = await erase(u);
      check(again.status === 200 && fake.requestsTo("DELETE", "/v1/subscriptions/").length >= 2, `${T} Erasure: the retry succeeds`, `${T} Retry failed: ${again.status} ${JSON.stringify(again.body)}`);
    }
    {
      const u = await erasable();
      delete fake.state.subscriptions[u.stripeSubId!];
      const { status, body } = await erase(u);
      check(status === 200 && body.subscription === "already_ended", `${T} Erasure: a subscription Stripe no longer knows is not an obstacle`, `${T} Missing subscription blocked erasure: ${status} ${JSON.stringify(body)}`);
    }

    // ── Webhook in production with the company set ──────────────────────
    {
      const o = await mkOrder({ qty: 1, stock: 5 });
      const r = await deliver(makeEvent("checkout.session.completed", sessionFor(o.order), { id: evId() }));
      check(r.status === 200 && (await orderOf(o.order.id)).status === "PAID" && (await invoiceCount(o.order.id)) === 1, `${T} Production webhook: a paid order is fulfilled and invoiced when the company identity is set`, `${T} Production fulfilment failed: ${r.status}`);
    }
  }

  async function noStripeScenario() {
    check(env.IS_PRODUCTION && env.DEMO_MODE === true && isDemoMode() === false && !env.STRIPE_SECRET_KEY, `${T} Precondition: production, DEMO_MODE=true, no Stripe key, isDemoMode() false`, `${T} Precondition not met`);
    for (const plan of ["BEDRIJF", "PARTICULIER", "MONTEUR_PRO"]) {
      const u = await mkUser();
      signIn(u);
      const r = await post(subscribeRoute, "/api/stripe/subscribe", { plan });
      const row = await userOf(u.id);
      check(r.status === 503 && row.plan === "FREE", `${T} Subscribe ${plan}: production + DEMO_MODE=true + no Stripe keys + signed-in user -> 503, plan stays FREE`, `${T} Free plan grant: ${r.status}, plan ${row.plan}`);
    }
    const u = await mkUser({ plan: "BEDRIJF", stripeSubId: "sub_qa_nostripe" });
    signIn(u);
    const portal = await portalRoute.POST();
    check(portal.status === 503, `${T} Portal without Stripe keys in production: 503, not a demo answer`, `${T} Portal answered ${portal.status}`);
    const gone = await post(deleteRoute, "/api/account/delete", { confirmation: "VERWIJDER MIJN ACCOUNT" });
    check(gone.status === 503 && (await userOf(u.id)).email === u.email, `${T} Erasure of an account with a subscription while Stripe is unreachable: refused, nothing erased`, `${T} Erasure answered ${gone.status}`);
    signIn(null);
  }

  async function noCompanyScenario() {
    const o = await mkOrder({ qty: 1, stock: 5 });
    const mark = slackBodies.length;
    const r = await deliver(makeEvent("checkout.session.completed", sessionFor(o.order), { id: evId() }));
    const row = await orderOf(o.order.id);
    check(r.status === 200 && row.status === "PAID" && (await invoiceCount(o.order.id)) === 0, `${T} Company details missing: the paid order is booked PAID and acknowledged (200), no invoice with placeholder data`, `${T} Missing company mishandled: ${r.status} ${row.status}`);
    check(/geen factuur/i.test(slackText(mark)) && /COMPANY_/.test(slackText(mark)), `${T} Company details missing: the owner is told which variables to set`, `${T} Owner not told about the missing company details`);
    const m = mailsTo(o.order.email);
    check(m.length === 1 && !/Factuurnummer/.test(m[0].html), `${T} Company details missing: the customer still gets the payment confirmation (without an invoice number)`, `${T} Confirmation wrong: ${m.length} mails`);
  }

  async function noSecretScenario() {
    const mark = slackBodies.length;
    const body = JSON.stringify(makeEvent("checkout.session.completed", { id: "cs_x" }));
    const res = await webhook.POST(new NextRequest("http://localhost/api/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": "t=1,v1=00" } }));
    check(res.status === 503 && /STRIPE_WEBHOOK_SECRET/.test(slackText(mark)), `${T} No STRIPE_WEBHOOK_SECRET: 503 (not a quiet 400) and the owner is told`, `${T} Missing secret answered ${res.status}`);
  }
}

function spawnScenario(name: string, extraEnv: Record<string, string | undefined>): { out: string; code: number } {
  const env: NodeJS.ProcessEnv = { ...process.env, QA_STRIPE_SCENARIO: name };
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const res = spawnSync("npx", ["tsx", __filename], { env, encoding: "utf8", cwd: repo, timeout: 300_000 });
  return { out: `${res.stdout ?? ""}${res.stderr ? `\n${res.stderr}` : ""}`, code: res.status ?? 1 };
}

const COMPANY_TEST = {
  COMPANY_NAME: "WasFix Test B.V.",
  COMPANY_STREET: "Teststraat 1",
  COMPANY_POSTAL_CODE: "1011 AB",
  COMPANY_CITY: "Amsterdam",
  COMPANY_KVK: "90000001",
  COMPANY_VAT: "NL900000010B01",
  COMPANY_IBAN: "NL02ABNA0123456789",
};
const NO_COMPANY = Object.fromEntries(Object.keys(COMPANY_TEST).map((k) => [k, undefined])) as Record<string, undefined>;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required (use a test database).");
    process.exit(2);
  }
  if (SCENARIO) {
    await runScenario(SCENARIO);
    process.stdout.write(lines.join("\n") + "\n");
    process.exit(failures > 0 ? 1 : 0);
  }
  // Parent: the main scenario in this process, the others as children.
  const children: Array<[string, Record<string, string | undefined>]> = [
    ["prod", { NODE_ENV: "production", DEMO_MODE: "true", ...COMPANY_TEST }],
    ["prod-nostripe", { NODE_ENV: "production", DEMO_MODE: "true", ...COMPANY_TEST }],
    ["prod-nocompany", { NODE_ENV: "production", DEMO_MODE: undefined, ...NO_COMPANY }],
    ["nosecret", { NODE_ENV: undefined, DEMO_MODE: undefined }],
  ];
  process.env.QA_STRIPE_SCENARIO = "main";
  await runScenario("main");
  let total = failures;
  const out = [...lines];
  for (const [name, extra] of children) {
    const { out: text, code } = spawnScenario(name, extra);
    out.push(...text.split("\n").filter((l) => l.trim()));
    if (code !== 0) total += 1;
    if (code !== 0 && !/❌/.test(text)) out.push(`❌ scenario ${name} exited with ${code}: ${text.slice(-400)}`);
  }
  const bad = out.filter((l) => l.startsWith("❌")).length;
  process.stdout.write(out.join("\n") + `\n\n${out.filter((l) => l.startsWith("✅")).length} passed, ${bad} failed\n`);
  process.exit(bad > 0 || total > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stdout.write(lines.join("\n") + `\n❌ qa-stripe crashed: ${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
