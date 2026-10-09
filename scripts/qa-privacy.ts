/**
 * Privacy and honesty of customer data (bundle FB): erasure through BOTH doors, the data export, guest
 * orders that must not land on somebody else's account, newsletter sign-up with a confirmation step.
 *
 * Runs the REAL code (the route handlers, src/lib/erasure.ts, src/lib/newsletter.ts) against a real
 * Postgres. Stand-ins: the identity provider (the IdentityReader seam in src/lib/auth.ts), Stripe (the local
 * fake in scripts/lib/fake-stripe.ts), Slack (a local HTTP server) and the mail provider (sendMail is captured).
 * Nothing here proves how real Clerk, Stripe or Resend behave; it proves what OUR code does with the answers.
 *
 * Sections
 *   1  Erasure through the dashboard route and through the Clerk user.deleted webhook, on the SAME fixture
 *      (R2-07 never-invoiced cancelled orders, R2-08 the webhook erased far less)
 *   2  Open orders: the route refuses, the webhook keeps them, the retention step finishes them
 *   3  The data export (R2-09: no purchase cost, no internal fields)
 *   4  Guest checkout with a member's address (R2-12, decision D16)
 *   5  Newsletter and lead magnet (R2-18): honest errors, double opt-in, Resend timeout
 *
 * Usage:  VERCEL=1 DATABASE_URL=postgresql://... npx tsx scripts/qa-privacy.ts
 * (VERCEL=1: the suite sends x-vercel-forwarded-for to get a separate rate-limit bucket per simulated caller.)
 */
import http from "node:http";
import path from "node:path";
import Module from "node:module";
import type { AddressInfo } from "node:net";

const repo = path.resolve(__dirname, "..");
const RUN = Date.now().toString(36);
const DOMAIN = "qa-privacy.test";

const realLog = console.log.bind(console);
const log: string[] = [];
const check = (cond: boolean, ok: string, bad: string = ok) => log.push(cond ? `✅ ${ok}` : `❌ ${bad}`);
const section = (title: string) => log.push(`\n── ${title}`);

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl)) {
  console.error("Refusing to run: DATABASE_URL must point at a local test database.");
  process.exit(2);
}

// Not demo mode, not production, no Stripe key (a fake client is injected where a section needs one), no mail provider.
process.env.CLERK_SECRET_KEY = "sk_test_qa_privacy";
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_qa_privacy";
delete process.env.DEMO_MODE;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.DISCORD_WEBHOOK_URL;
delete process.env.ORDER_NOTIFY_EMAIL;
delete process.env.CLERK_WEBHOOK_SECRET;
delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_AUDIENCE_ID;
process.env.CLERK_WEBHOOK_ALLOW_UNSIGNED = "true";
process.env.CRON_SECRET = "qa-privacy-cron-secret-0123456789";
Object.assign(process.env, {
  COMPANY_NAME: "WasFix Test B.V.", COMPANY_STREET: "Teststraat 1", COMPANY_POSTAL_CODE: "1011 AB", COMPANY_CITY: "Amsterdam",
  COMPANY_KVK: "90000001", COMPANY_VAT: "NL900000010B01", COMPANY_IBAN: "NL02ABNA0123456789", COMPANY_EMAIL: `qa@${DOMAIN}`,
  NEXT_PUBLIC_APP_URL: "https://shop.qa-privacy.test",
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DAY = 86_400_000;

async function main() {
  // ── Module loading: no server-only, no real cache revalidation, captured mail ──
  const M = Module as unknown as { _load: (...a: unknown[]) => unknown; _resolveFilename: (...a: unknown[]) => string };
  const origLoad = M._load;
  const emailPath = path.join(repo, "src/lib/email.ts");
  const sentMail: { template: string; to: string; subject: string; html: string; text?: string }[] = [];
  let mailOk = true;
  M._load = function patched(this: unknown, ...args: unknown[]) {
    const [request, parent, isMain] = args as [string, unknown, boolean];
    if (request === "server-only" || /\.css$/.test(request)) return {};
    if (request === "next/cache") {
      const real = origLoad.apply(this, args) as Record<string, unknown>;
      return { ...real, revalidatePath: () => undefined, revalidateTag: () => undefined };
    }
    let resolved: string | undefined;
    try { resolved = M._resolveFilename(request, parent, isMain); } catch { /* not resolvable here */ }
    if (resolved === emailPath) {
      const real = origLoad.apply(this, args) as Record<string, unknown>;
      return { ...real, sendMail: async (o: { template: string; to: string; subject: string; html: string; text?: string }) => { sentMail.push(o); return mailOk ? { ok: true } : { ok: false, error: "qa" }; } };
    }
    return origLoad.apply(this, args);
  };

  const slackBodies: string[] = [];
  const slack = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { slackBodies.push(body); res.statusCode = 200; res.end("ok"); });
  });
  await new Promise<void>((r) => slack.listen(0, "127.0.0.1", r));
  process.env.SLACK_WEBHOOK_URL = `http://127.0.0.1:${(slack.address() as AddressInfo).port}/hook`;
  const slackTexts = () => slackBodies.map((b) => { try { return String(JSON.parse(b).text); } catch { return b; } });

  const captured: string[] = [];
  for (const k of ["log", "info", "warn", "error", "debug"] as const) {
    (console as unknown as Record<string, (...a: unknown[]) => void>)[k] = (...a: unknown[]) => { captured.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };
  }

  (globalThis as unknown as { React: unknown }).React = await import("react");
  const { NextRequest } = await import("next/server");
  const { prisma } = await import("../src/lib/prisma");
  const auth = await import("../src/lib/auth");
  const inv = await import("../src/lib/invoicing");
  const erasure = await import("../src/lib/erasure");
  const newsletter = await import("../src/lib/newsletter");
  const access = await import("../src/app/bestelling/_lib/access");
  const { startFakeStripe } = await import("./lib/fake-stripe");
  const { _setStripeForTests } = await import("../src/lib/stripe");
  const { env } = await import("../src/lib/env");
  const { _resetNotifyStateForTests } = await import("../src/lib/notify");

  let counter = 0;
  const email = (tag: string) => `${tag}${++counter}.${RUN}@${DOMAIN}`;
  let clerkSeq = 0;
  const clerkId = () => `user_qaprv_${RUN}_${++clerkSeq}`;
  let ipSeq = 0;
  const freshIp = () => `10.88.${(ipSeq >> 8) & 255}.${++ipSeq & 255}`;
  const settle = () => new Promise((r) => setTimeout(r, 250));

  let identity: import("../src/lib/auth").ClerkIdentity | null = null;
  auth._setIdentityReaderForTests(async () => identity);
  const signInAs = (row: { clerkId: string | null; email: string }) => { identity = { clerkId: row.clerkId ?? clerkId(), email: row.email, emailVerified: true, name: "QA Gebruiker" }; };
  const signOut = () => { identity = null; };

  const req = (url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    new NextRequest(`http://localhost${url}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", "x-vercel-forwarded-for": freshIp(), ...(init.headers ?? {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  const formReq = (url: string, fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return new NextRequest(`http://localhost${url}`, { method: "POST", headers: { "x-vercel-forwarded-for": freshIp() }, body: fd });
  };

  const deleteRoute = await import("../src/app/api/account/delete/route");
  const exportRoute = await import("../src/app/api/account/data-export/route");
  const clerkRoute = await import("../src/app/api/webhooks/clerk/route");
  const checkoutRoute = await import("../src/app/api/checkout/route");
  const ordersRoute = await import("../src/app/api/orders/route");
  const newsletterRoute = await import("../src/app/api/newsletter/route");
  const confirmRoute = await import("../src/app/api/newsletter/confirm/route");
  const leadRoute = await import("../src/app/api/lead-magnet/route");

  const part = await prisma.part.create({ data: { sku: `QAPRV-${RUN}`, name: "QA onderdeel", brand: "QA", category: "OTHER", priceEur: 20, costEur: 3.03, costSource: "QUOTE", stock: 500 } });
  const machine = await prisma.washingMachine.create({ data: { brand: "QAPRV", model: `M-${RUN}` } });
  const createdUsers: string[] = [];

  const ADDRESS = JSON.stringify({ name: "Piet Prive", street: "Geheimstraat", houseNumber: "7", postalCode: "1011 AB", city: "Amsterdam", country: "NL" });
  const mkOrder = async (userId: string, mail: string, status: string, over: Record<string, unknown> = {}) => {
    const vat = inv.splitVatInclusive(20);
    return prisma.order.create({
      data: {
        userId, email: mail, status, paymentMethod: status === "PENDING" || over.__stripe ? "STRIPE" : "BANK_TRANSFER", subtotalEur: 20, shippingEur: 0, totalEur: 20, vatRate: vat.vatRate, vatEur: vat.vatEur,
        shippingAddress: ADDRESS, phone: "06 99887766", customerNote: "Bel niet aan, kind slaapt", accessToken: inv.newAccessToken(), costEur: 3.03, idempotencyKey: `qaprv-${RUN}-${++counter}`,
        items: { create: [{ partId: part.id, quantity: 1, unitPrice: 20 }] },
        ...Object.fromEntries(Object.entries(over).filter(([k]) => !k.startsWith("__"))),
      },
    });
  };

  /**
   * One person with something in every table that holds data about them, and four orders:
   *   A  CANCELLED Stripe attempt, never invoiced (what every abandoned iDEAL attempt becomes: R2-07)
   *   B  bank transfer, invoiced, then cancelled with a credit note (decision D4)
   *   C  DELIVERED 90 days ago, invoiced
   *   D  DELIVERED 90 days ago, NOT invoiced yet (awaiting an invoice: the one real exception)
   */
  async function buildPerson(tag: string, opts: { stripe?: { fake: Awaited<ReturnType<typeof startFakeStripe>> } } = {}) {
    const mail = email(tag);
    const subId = `sub_qaprv_${tag}_${RUN}`;
    const cusId = `cus_qaprv_${tag}_${RUN}`;
    const u = await prisma.user.create({
      data: {
        email: mail, clerkId: clerkId(), name: "Piet Prive", plan: opts.stripe ? "MONTEUR_PRO" : "FREE", referralCode: `QAPRV${RUN}${tag}`.toUpperCase().slice(0, 18),
        ...(opts.stripe ? { stripeSubId: subId, stripeCustomerId: cusId, stripeSubStatus: "active", stripeCurrentPeriodEnd: new Date(Date.now() + 20 * DAY) } : {}),
      },
    });
    createdUsers.push(u.id);
    if (opts.stripe) {
      const { fake } = opts.stripe;
      fake.state.customers[cusId] = { id: cusId, object: "customer", email: mail, name: "Piet" };
      fake.state.subscriptions[subId] = fake.subscription({ id: subId, customer: cusId, priceId: "price_x", status: "active", userId: u.id, plan: "MONTEUR_PRO" });
    }
    await prisma.monteurProfile.create({ data: { userId: u.id, companyName: "Piet Techniek", kvkNumber: "12345679", iban: "NL02ABNA0123456789", street: "Geheimstraat 7", email: mail, phone: "06 99887766" } });
    const cust = await prisma.customer.create({ data: { ownerId: u.id, name: "Klant van Piet", phone: "06 11112222", street: "Klantlaan 3", notes: "Heeft een hond" } });
    await prisma.workOrder.create({ data: { ownerId: u.id, customerId: cust.id, reference: `QA-${tag}-${RUN}`, problem: "Pomp defect", notes: "Sleutel onder de mat" } });
    await prisma.review.create({ data: { targetType: "part", targetSku: part.sku, rating: 5, title: "Top", body: "Goed", author: "Piet Prive", email: mail } });
    await prisma.newsletterSubscriber.create({ data: { email: mail, source: "newsletter", confirmedAt: new Date() } });
    await prisma.monteurApplication.create({ data: { applicationId: `APP-${tag}-${RUN}`, companyName: "Piet Techniek", kvkNumber: "12345679", email: mail, contactName: "Piet Prive" } });
    const diag = await prisma.diagnosis.create({ data: { userId: u.id, sessionId: `sess-${tag}-${RUN}`, brand: "Bosch", symptoms: "lekt", messages: "[]" } });
    await prisma.diagnosisFeedback.create({ data: { diagnosisId: diag.id, rating: "up", comment: "ok" } });
    await prisma.savedMachine.create({ data: { userId: u.id, machineId: machine.id } });
    await prisma.apiKey.create({ data: { userId: u.id, name: "qa", prefix: `qa${tag}`.slice(0, 8), hash: `hash-${tag}-${RUN}-${Math.random()}` } });
    await prisma.referral.create({ data: { code: u.referralCode!, visitorId: `v-${tag}-${RUN}`, referrerId: u.id } });

    const A = await mkOrder(u.id, mail, "CANCELLED", { __stripe: true, paymentMethod: "STRIPE", cancelledAt: new Date(), cancelReason: "Betaling niet afgerond", stripePaymentId: `cs_qa_${tag}_${RUN}` });
    const B0 = await mkOrder(u.id, mail, "OPENSTAAND", { dueAt: new Date(Date.now() + 14 * DAY) });
    await inv.issueInvoiceForOrder(B0.id);
    const cancelled = await inv.cancelOrder(B0.id, { reason: "QA: niet betaald", actor: "admin", notifyCustomer: false });
    const C = await mkOrder(u.id, mail, "DELIVERED", { paidAt: new Date(Date.now() - 95 * DAY), shippedAt: new Date(Date.now() - 92 * DAY), deliveredAt: new Date(Date.now() - 90 * DAY), updatedAt: new Date(Date.now() - 90 * DAY) });
    await inv.issueInvoiceForOrder(C.id);
    const D = await mkOrder(u.id, mail, "DELIVERED", { paidAt: new Date(Date.now() - 95 * DAY), shippedAt: new Date(Date.now() - 92 * DAY), deliveredAt: new Date(Date.now() - 90 * DAY) });
    await prisma.order.update({ where: { id: D.id }, data: { updatedAt: new Date(Date.now() - 90 * DAY) } }).catch(() => undefined);
    if (!cancelled.ok) throw new Error(`fixture: cancelOrder failed: ${JSON.stringify(cancelled)}`);
    const rma = await prisma.rmaRequest.create({ data: { rmaNumber: `RMA-${tag}-${RUN}`, orderId: C.id.slice(-8), linkedOrderId: C.id, name: "Piet Prive", email: mail, reason: "Defect", notes: "Mijn telefoonnummer is 0612345678" } });
    return { user: u, mail, subId, cusId, orders: { A, B: B0, C, D }, rma };
  }

  /** What is left of a person, with ids and addresses normalised so two persons can be compared. */
  async function snapshot(p: Awaited<ReturnType<typeof buildPerson>>) {
    const norm = (v: unknown) => JSON.stringify(v ?? null).split(p.user.id).join("<ID>").split(p.mail).join("<MAIL>").split(RUN).join("<RUN>");
    const u = await prisma.user.findUniqueOrThrow({ where: { id: p.user.id } });
    const orders = await prisma.order.findMany({ where: { userId: p.user.id }, orderBy: { createdAt: "asc" }, include: { invoice: { include: { creditNotes: true } } } });
    return JSON.parse(norm({
      user: { email: u.email, name: u.name, clerkId: u.clerkId, plan: u.plan, sub: u.stripeSubId, cus: u.stripeCustomerId, status: u.stripeSubStatus, ref: u.referralCode },
      monteurProfile: await prisma.monteurProfile.count({ where: { userId: u.id } }),
      customers: await prisma.customer.count({ where: { ownerId: u.id } }),
      workOrders: await prisma.workOrder.count({ where: { ownerId: u.id } }),
      apiKeys: await prisma.apiKey.count({ where: { userId: u.id } }),
      diagnoses: await prisma.diagnosis.count({ where: { userId: u.id } }),
      savedMachines: await prisma.savedMachine.count({ where: { userId: u.id } }),
      referrals: await prisma.referral.count({ where: { referrerId: u.id } }),
      newsletter: await prisma.newsletterSubscriber.count({ where: { email: p.mail } }),
      applications: await prisma.monteurApplication.count({ where: { email: p.mail } }),
      reviews: (await prisma.review.findMany({ where: { OR: [{ email: p.mail }, { email: erasure.anonymizedEmailFor(u.id) }], targetSku: part.sku } })).filter((r) => r.title === "Top" && r.body === "Goed").map((r) => [r.author, r.email]),
      rma: (await prisma.rmaRequest.findMany({ where: { id: p.rma.id } })).map((r) => [r.name, r.email, r.notes]),
      orders: orders.map((o) => ({ status: o.status, email: o.email, address: o.shippingAddress, phone: o.phone, note: o.customerNote, token: o.accessToken, invoice: o.invoice ? { buyer: JSON.parse(o.invoice.buyerJson).name, credit: o.invoice.creditNotes.length } : null })),
    }));
  }

  // ════════════════════════ 1. Erasure: both doors, the same fixture ════════════════════════
  section("1. Erasure: dashboard route and Clerk user.deleted webhook erase the same things");
  let dashboardReply: Json = {};
  {
    const fake = await startFakeStripe();
    _setStripeForTests(fake.client());
    _resetNotifyStateForTests?.();
    const viaRoute = await buildPerson("route", { stripe: { fake } });
    const viaHook = await buildPerson("hook", { stripe: { fake } });

    // Before: the fixture really holds what the checks below look for.
    const before = await snapshot(viaRoute);
    check(before.monteurProfile === 1 && before.customers === 1 && before.orders.length === 4 && before.orders.every((o: Json) => o.phone && o.token) && before.orders[0].status === "CANCELLED" && before.orders[0].invoice === null, "Fixture: monteur profile, CRM customer, 4 orders (A cancelled and never invoiced) with phone and access token", `fixture: ${JSON.stringify(before).slice(0, 400)}`);

    // Door 1: the dashboard button
    signInAs(viaRoute.user);
    const del = await deleteRoute.POST(req("/api/account/delete", { method: "POST", body: { confirmation: "VERWIJDER MIJN ACCOUNT" } }));
    dashboardReply = (await del.json()) as Json;
    signOut();
    // Door 2: Clerk's own profile UI
    const hookRes = await clerkRoute.POST(req("/api/webhooks/clerk", { method: "POST", body: { type: "user.deleted", data: { id: viaHook.user.clerkId } } }));

    const snapRoute = await snapshot(viaRoute);
    const snapHook = await snapshot(viaHook);
    check(del.status === 200 && hookRes.status === 200, "Both doors answer 200", `statuses ${del.status} / ${hookRes.status}: ${JSON.stringify(dashboardReply).slice(0, 200)}`);
    check(JSON.stringify(snapRoute) === JSON.stringify(snapHook), "The same fixture ends up IDENTICAL through both doors (ids and addresses normalised)", `snapshots differ:\n route ${JSON.stringify(snapRoute)}\n hook  ${JSON.stringify(snapHook)}`);

    for (const [door, s] of [["dashboard", snapRoute], ["Clerk webhook", snapHook]] as const) {
      check(s.user.email === "deleted-<ID>@anon.wasfix.nl" && s.user.name === "Verwijderd account" && s.user.clerkId === null && s.user.plan === "FREE" && s.user.sub === null && s.user.cus === null && s.user.ref === null, `[${door}] the User row is anonymised: no address, no login, no plan, no Stripe handle, no referral code`, `[${door}] user: ${JSON.stringify(s.user)}`);
      check(s.monteurProfile === 0 && s.customers === 0 && s.workOrders === 0 && s.apiKeys === 0 && s.diagnoses === 0 && s.savedMachines === 0 && s.referrals === 0 && s.newsletter === 0 && s.applications === 0, `[${door}] monteur profile (KvK, IBAN, address), CRM customers, work orders, API keys, diagnoses, saved machines, referrals, newsletter row and monteur application are gone`, `[${door}] left behind: ${JSON.stringify(s)}`);
      check(JSON.stringify(s.reviews) === JSON.stringify([["Anoniem", "deleted-<ID>@anon.wasfix.nl"]]) && JSON.stringify(s.rma) === JSON.stringify([["Verwijderd account", "deleted-<ID>@anon.wasfix.nl", erasure.REDACTED]]), `[${door}] the review and the RMA request lose name, address and free text`, `[${door}] review/rma: ${JSON.stringify([s.reviews, s.rma])}`);
      const redactedAddress = JSON.stringify(JSON.parse(erasure.REDACTED_ADDRESS));
      check(s.orders.length === 4 && s.orders.every((o: Json) => o.email === "deleted-<ID>@anon.wasfix.nl" && JSON.stringify(JSON.parse(o.address)) === redactedAddress && o.phone === null && o.note === null && o.token === null), `[${door}] EVERY order (also A, cancelled and never invoiced, and D, whose invoice was issued first) has e-mail and address redacted, phone and note removed, and the access link killed`, `[${door}] orders: ${JSON.stringify(s.orders)}`);
      check(s.orders[0].invoice === null && s.orders[1].invoice?.buyer === "Piet Prive" && s.orders[1].invoice.credit === 1 && s.orders[2].invoice?.buyer === "Piet Prive" && s.orders[3].invoice?.buyer === "Piet Prive", `[${door}] the invoices (and the credit note) are kept with the buyer's name and address: Wet OB / AWR; D got its missing invoice BEFORE it was redacted`, `[${door}] invoices: ${JSON.stringify(s.orders.map((o: Json) => o.invoice))}`);
    }
    check(fake.requestsTo("DELETE", `/v1/subscriptions/${viaRoute.subId}`).length === 1 && fake.requestsTo("DELETE", `/v1/subscriptions/${viaHook.subId}`).length === 1 && fake.requestsTo("POST", `/v1/customers/${viaRoute.cusId}`).length === 1 && fake.requestsTo("POST", `/v1/customers/${viaHook.cusId}`).length === 1, "Both doors cancel the Stripe subscription and anonymise the Stripe customer (unchanged behaviour)", `stripe: ${fake.requests.map((r) => `${r.method} ${r.path}`).join(", ")}`);

    // R2-07: what the person is told
    const msg = String(dashboardReply.message);
    check(dashboardReply.retained?.ordersAwaitingInvoice === 0 && dashboardReply.retained?.invoices === 3 && dashboardReply.retained?.creditNotes === 1 && dashboardReply.retained?.orderRows === 4, "Reply: describes exactly what was kept (3 invoices, 1 credit note, 4 order rows) and NO order awaiting an invoice (before: the cancelled one was counted as such)", `reply.retained: ${JSON.stringify(dashboardReply.retained)}`);
    check(!/tot die factuur er is/.test(msg) && !/nog geen factuur/.test(msg) && /creditfacturen/.test(msg) && /losgekoppeld van je e-mailadres, telefoonnummer en bezorgadres/.test(msg) && /abonnement is opgezegd/.test(msg), "Reply: does not claim anything waits 'tot die factuur er is', names the credit notes, says the orders lost e-mail/phone/address, and the subscription cancel", `reply: ${msg}`);
    check(!/@wasfix\.nl/.test(msg.replace(/@anon\.wasfix\.nl/g, "")), "Reply: no hard-coded @wasfix.nl mailbox", `reply: ${msg}`);

    // an account with a CANCELLED never-invoiced order only: the old reply claimed an exception that does not exist
    const lone = await prisma.user.create({ data: { email: email("lone"), clerkId: clerkId(), name: "Lone" } });
    createdUsers.push(lone.id);
    const loneOrder = await mkOrder(lone.id, lone.email, "CANCELLED", { __stripe: true, paymentMethod: "STRIPE" });
    signInAs(lone);
    const loneDel = await deleteRoute.POST(req("/api/account/delete", { method: "POST", body: { confirmation: "VERWIJDER MIJN ACCOUNT" } }));
    const loneJson = (await loneDel.json()) as Json;
    signOut();
    const loneRow = await prisma.order.findUniqueOrThrow({ where: { id: loneOrder.id } });
    check(loneDel.status === 200 && loneRow.email === `deleted-${lone.id}@anon.wasfix.nl` && loneRow.shippingAddress === erasure.REDACTED_ADDRESS && loneJson.retained?.ordersAwaitingInvoice === 0 && !/geen factuur/.test(String(loneJson.message)), "R2-07: an account whose only order is CANCELLED and never invoiced loses its e-mail and address, and the reply does not say they wait for an invoice", `lone: ${loneDel.status} ${loneRow.email} ${JSON.stringify(loneJson)}`);

    _setStripeForTests(null);
    await fake.close();
  }

  // ════════════════════════ 2. Open orders ════════════════════════
  section("2. Open orders: the route refuses, the webhook keeps them, the retention step finishes the job");
  {
    // route: refuses, erases nothing
    const p = await buildPerson("open1");
    const paid = await mkOrder(p.user.id, p.mail, "PAID", { paidAt: new Date() });
    signInAs(p.user);
    const refused = await deleteRoute.POST(req("/api/account/delete", { method: "POST", body: { confirmation: "VERWIJDER MIJN ACCOUNT" } }));
    const refusedJson = (await refused.json()) as Json;
    signOut();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: p.user.id } });
    const orderAfter = await prisma.order.findUniqueOrThrow({ where: { id: paid.id } });
    check(refused.status === 409 && after.email === p.mail && after.clerkId === p.user.clerkId && orderAfter.email === p.mail && orderAfter.shippingAddress === ADDRESS && (await prisma.monteurProfile.count({ where: { userId: p.user.id } })) === 1, "Dashboard route: a PAID, unshipped order refuses the erasure (409) and NOTHING is erased", `open order: ${refused.status} ${JSON.stringify(refusedJson).slice(0, 200)}`);
    check(/Probeer het later opnieuw|mail qa@qa-privacy\.test|contactpagina|Wacht tot/.test(String(refusedJson.error)) && !/privacy@wasfix\.nl/.test(String(refusedJson.error)) && String(refusedJson.error).includes("qa@qa-privacy.test"), "The refusal names the configured contact address (COMPANY_EMAIL), not privacy@wasfix.nl", `refusal: ${refusedJson.error}`);

    // webhook: the person is already gone at Clerk; erase everything else, keep the open order, tell the owner
    slackBodies.length = 0;
    const hookRes = await clerkRoute.POST(req("/api/webhooks/clerk", { method: "POST", body: { type: "user.deleted", data: { id: p.user.clerkId } } }));
    await settle();
    const uRow = await prisma.user.findUniqueOrThrow({ where: { id: p.user.id } });
    const kept = await prisma.order.findUniqueOrThrow({ where: { id: paid.id } });
    const cancelledOne = await prisma.order.findUniqueOrThrow({ where: { id: p.orders.A.id } });
    const told = slackTexts().join(" | ");
    check(hookRes.status === 200 && uRow.email === erasure.anonymizedEmailFor(p.user.id) && (await prisma.monteurProfile.count({ where: { userId: p.user.id } })) === 0 && (await prisma.customer.count({ where: { ownerId: p.user.id } })) === 0, "Clerk webhook with an open order: the account, monteur profile and CRM customers are erased anyway", `webhook open: ${hookRes.status} ${uRow.email}`);
    check(kept.email === p.mail && kept.shippingAddress === ADDRESS && kept.phone === "06 99887766" && kept.accessToken !== null, "...but the open (PAID) order keeps its contact details, so it can still be shipped", `open order after webhook: ${kept.email} ${kept.phone}`);
    check(cancelledOne.email === erasure.anonymizedEmailFor(p.user.id) && cancelledOne.accessToken === null, "...while the account's other orders ARE redacted", `other order: ${cancelledOne.email}`);
    check(/bestellingen lopen nog/.test(told) && told.includes(p.user.id) && !told.includes(p.mail) && !told.includes("Geheimstraat"), "...and the owner is told (user id and counts, no address or e-mail)", `owner message: ${told}`);

    // not finished yet: the retention step leaves it; once delivered long ago it redacts it
    const stillOpen = await erasure.finishPendingErasures();
    const stillKept = await prisma.order.findUniqueOrThrow({ where: { id: paid.id } });
    check(stillOpen.stillOpen >= 1 && stillKept.email === p.mail, "finishPendingErasures(): an order that is still open is left alone", `retention while open: ${JSON.stringify(stillOpen)} ${stillKept.email}`);
    await prisma.order.update({ where: { id: paid.id }, data: { status: "DELIVERED", deliveredAt: new Date(Date.now() - 45 * DAY), updatedAt: new Date(Date.now() - 45 * DAY) } });
    const { runRetention } = await import("../src/lib/retention");
    const ret = await runRetention();
    const done = await prisma.order.findUniqueOrThrow({ where: { id: paid.id }, include: { invoice: true } });
    check(done.email === erasure.anonymizedEmailFor(p.user.id) && done.shippingAddress === erasure.REDACTED_ADDRESS && done.phone === null && done.accessToken === null && done.invoice !== null && ret.pendingErasures.ordersRedacted >= 1, "The daily retention run (runRetention) finishes it: the order is delivered more than 30 days ago, so its invoice is issued and the contact details are redacted", `retention: ${JSON.stringify(ret)} order ${done.email} ${done.shippingAddress.slice(0, 40)} invoice ${done.invoice?.number}`);
    check(JSON.stringify((await erasure.finishPendingErasures())) === JSON.stringify({ accounts: 0, ordersRedacted: 0, stillOpen: 0 }), "...and it is idempotent: a second run finds nothing", "second retention run still found work");
  }

  // ════════════════════════ 3. Data export ════════════════════════
  section("3. Data export: what the customer sees, not what the shop knows");
  {
    const p = await buildPerson("export");
    signInAs(p.user);
    const res = await exportRoute.GET(req("/api/account/data-export"));
    const text = await res.text();
    const data = JSON.parse(text) as Json;
    signOut();
    const o = (data.orders as Json[]).find((x) => x.id === p.orders.C.id)!;
    check(res.status === 200 && Array.isArray(data.orders) && data.orders.length === 4 && !!o, "Export: 200 with the account's 4 orders", `export: ${res.status} ${text.slice(0, 200)}`);
    const keys = new Set((data.orders as Json[]).flatMap((x) => Object.keys(x)));
    check(!keys.has("costEur") && !keys.has("idempotencyKey") && !keys.has("accessToken") && !keys.has("stripePaymentId") && !keys.has("stripePaymentIntentId") && !keys.has("userId"), `Export: no order carries costEur (the shop's purchase cost), idempotencyKey, accessToken, Stripe ids or userId (keys: ${[...keys].join(",")})`, `Export leaks internal order fields: ${[...keys].join(",")}`);
    check(!/"costEur"/.test(text) && !text.includes("3.03") && !/"supplier"/.test(text) && !/"idempotencyKey"/.test(text), "Export: the purchase cost 3.03 and the words costEur / supplier / idempotencyKey appear nowhere in the file", `export contains internal data: ${(text.match(/[\s\S]{0,30}(costEur|3\.03|supplier|idempotencyKey)[\s\S]{0,30}/) ?? [""])[0]}`);
    check(o.totalEur === 20 && o.status === "DELIVERED" && o.email === p.mail && String(o.shippingAddress).includes("Geheimstraat") && o.phone === "06 99887766" && o.items?.[0]?.part?.sku === part.sku && o.items[0].unitPrice === 20 && o.items[0].quantity === 1, "Export: the customer's own data is all there (amounts, status, e-mail, address, phone, lines with the part's sku and name)", `export order: ${JSON.stringify(o).slice(0, 300)}`);
    check(Array.isArray(data.creditNotes) && data.creditNotes.length === 1 && String(data.creditNotes[0].number).startsWith("CN-") && Array.isArray(data.invoices) && data.invoices.length === 2, "Export: the invoices (2: B and C; D gets its invoice only when an erasure needs one) and the credit note (1) are included (they carry the buyer's name and address)", `export invoices/credit notes: ${data.invoices?.length}/${data.creditNotes?.length}`);
    check(!/privacy@wasfix\.nl/.test(String(data._notice)) && String(data._notice).includes("qa@qa-privacy.test"), "Export: the notice names COMPANY_EMAIL, not a hard-coded privacy@wasfix.nl", `export notice: ${data._notice}`);
  }

  // ════════════════════════ 4. Guest checkout with a member's address ════════════════════════
  section("4. Guest checkout with a member's address (decision D16, R2-12)");
  {
    const member = await prisma.user.create({ data: { email: email("member"), clerkId: clerkId(), name: "Echte klant" } });
    createdUsers.push(member.id);
    signOut();
    const res = await checkoutRoute.POST(req("/api/checkout", { method: "POST", body: {
      items: [{ sku: part.sku, quantity: 1 }], email: member.email.toUpperCase().replace(`@${DOMAIN.toUpperCase()}`, `@${DOMAIN}`), name: "Een vreemde", phone: "06 12345678", paymentMethod: "bank_transfer",
      address: { street: "Vreemdelaan", houseNumber: "1", postalCode: "1011 AB", city: "Amsterdam" },
    } }));
    const json = (await res.json()) as Json;
    const order = json.orderId ? await prisma.order.findUnique({ where: { id: json.orderId }, include: { user: true } }) : null;
    check(res.status === 200 && !!order && order.userId !== member.id && order.user.clerkId === null && order.email === member.email, "Guest checkout typing a member's address: the order is a guest order (not on the member), with the typed address on the order", `guest order: ${res.status} ${JSON.stringify(json).slice(0, 160)} userId ${order?.userId} vs ${member.id}`);

    signInAs(member);
    const dash = await ordersRoute.GET();
    const dashJson = (await dash.json()) as Json;
    check(dash.status === 200 && (dashJson.orders as Json[]).length === 0, "The member's dashboard list (/api/orders) does not show the stranger's order", `member orders: ${JSON.stringify(dashJson).slice(0, 200)}`);
    const exp = await exportRoute.GET(req("/api/account/data-export"));
    const expJson = (await exp.json()) as Json;
    check((expJson.orders as Json[]).length === 0, "...nor does the member's data export", `member export orders: ${expJson.orders?.length}`);
    const del = await deleteRoute.POST(req("/api/account/delete", { method: "POST", body: { confirmation: "VERWIJDER MIJN ACCOUNT" } }));
    const delJson = (await del.json()) as Json;
    signOut();
    const memberAfter = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    const orderAfter = order ? await prisma.order.findUnique({ where: { id: order.id } }) : null;
    check(del.status === 200 && memberAfter.email === erasure.anonymizedEmailFor(member.id), "...and the member can erase their account at once (before: refused for up to 21 days because of the stranger's open order)", `member erasure: ${del.status} ${memberAfter.email}`);
    check(orderAfter?.email === order?.email && orderAfter?.status === "OPENSTAAND" && orderAfter?.shippingAddress.includes("Vreemdelaan"), "...and the member's erasure leaves the stranger's order untouched", `stranger order after erasure: ${orderAfter?.email} ${orderAfter?.status}`);
    // The order carries the member's address, so the erasure took it over (it is not left behind on the shared row); it is still open, so it is kept and the reply says so.
    check(orderAfter?.userId === member.id && /loopt nog/.test(String(delJson.message)) && delJson.retained?.guestOrdersAdopted === 1 && delJson.retained?.ordersKeptOpen === 1, "...it was taken over by the erasure (the typed address is the member's), and the reply names it as an order that is still running", `reply: ${JSON.stringify(delJson).slice(0, 400)} order userId ${orderAfter?.userId}`);
    const tok = new URL(`http://x${json.redirectUrl}`).searchParams.get("t");
    const viaToken = order ? await access.loadOrderForViewer(order.id, tok) : null;
    check(viaToken?.via === "token", "The guest reaches their own order with the token from the confirmation page", `token access: ${viaToken?.via}`);

    // Signed in as the account: the order IS attached to it, whatever address is typed
    const member2 = await prisma.user.create({ data: { email: email("member2"), clerkId: clerkId(), name: "Tweede klant" } });
    createdUsers.push(member2.id);
    signInAs(member2);
    const res2 = await checkoutRoute.POST(req("/api/checkout", { method: "POST", body: {
      items: [{ sku: part.sku, quantity: 1 }], email: email("other"), name: "Tweede klant", phone: "06 12345678", paymentMethod: "bank_transfer",
      address: { street: "Eigenlaan", houseNumber: "2", postalCode: "1011 AB", city: "Amsterdam" },
    } }));
    const json2 = (await res2.json()) as Json;
    signOut();
    const o2 = json2.orderId ? await prisma.order.findUnique({ where: { id: json2.orderId } }) : null;
    check(res2.status === 200 && o2?.userId === member2.id, "Signed in as the account: the order IS attached to that account", `signed-in order: ${res2.status} user ${o2?.userId} vs ${member2.id}`);
  }

  // ════════════════════════ 4b. The erasing person's OWN guest orders on the shared holder row ════════════════════════
  section("4b. Erasure also covers the person's earlier guest orders on the shared holder row (D16 side effect)");
  {
    const { GUEST_HOLDER_EMAIL, isGuestHolderEmail } = await import("../src/lib/checkout-user");
    const holder = await prisma.user.upsert({ where: { email: GUEST_HOLDER_EMAIL }, update: {}, create: { email: GUEST_HOLDER_EMAIL, name: "Gastbestellingen" } });
    const m = await prisma.user.create({ data: { email: email("holdermember"), clerkId: clerkId(), name: "Piet Prive" } });
    createdUsers.push(m.id);
    const stranger = email("holderother");
    const mixed = m.email.toUpperCase().replace(`@${DOMAIN.toUpperCase()}`, `@${DOMAIN}`);
    const closed = await mkOrder(holder.id, mixed, "CANCELLED");
    const open = await mkOrder(holder.id, m.email, "OPENSTAAND");
    const foreign = await mkOrder(holder.id, stranger, "CANCELLED");
    check(isGuestHolderEmail(GUEST_HOLDER_EMAIL) && isGuestHolderEmail(" Gastbestellingen@Guest.Invalid ") && !isGuestHolderEmail(m.email) && !isGuestHolderEmail(null), "isGuestHolderEmail(): recognises the shared row (any case), nothing else", "isGuestHolderEmail wrong");

    signInAs(m);
    const del = await deleteRoute.POST(req("/api/account/delete", { method: "POST", body: { confirmation: "VERWIJDER MIJN ACCOUNT" } }));
    const dj = (await del.json()) as Json;
    signOut();
    const [c1, o1, f1] = await Promise.all([closed, open, foreign].map((o) => prisma.order.findUniqueOrThrow({ where: { id: o.id } })));
    const anon = erasure.anonymizedEmailFor(m.id);
    check(del.status === 200 && c1.email === anon && c1.shippingAddress === erasure.REDACTED_ADDRESS && c1.phone === null && c1.customerNote === null && c1.accessToken === null && c1.userId === m.id,
      "A closed guest order typed with the erasing account's address (any letter case) is redacted with the account: e-mail, address, phone, note and access link (before: it kept all of them on the holder row)",
      `closed holder order after erasure: ${c1.email} ${c1.shippingAddress.slice(0, 40)} ${c1.phone} ${c1.accessToken}`);
    check(o1.email === m.email && o1.status === "OPENSTAAND" && o1.accessToken !== null && o1.userId === m.id && /loopt nog/.test(String(dj.message)) && !/Alles is gewist of geanonimiseerd\.( |$)/.test(String(dj.message)),
      "An OPEN guest order of the same address is kept (it still has to be fulfilled), the erasure is NOT blocked by it, and the reply names it", `open holder order: ${o1.email} ${o1.status} reply ${String(dj.message).slice(0, 200)}`);
    check(f1.email === stranger && f1.phone === "06 99887766" && f1.accessToken !== null && f1.userId === holder.id, "A guest order typed with SOMEBODY ELSE'S address is not touched", `foreign holder order: ${f1.email} ${f1.userId}`);
    await prisma.order.update({ where: { id: open.id }, data: { status: "CANCELLED" } });
    const fin = await erasure.finishPendingErasures();
    const o2 = await prisma.order.findUniqueOrThrow({ where: { id: open.id } });
    check(fin.ordersRedacted >= 1 && o2.email === anon && o2.shippingAddress === erasure.REDACTED_ADDRESS && o2.accessToken === null, "...and once that order is cancelled the retention step redacts it too", `after cancel: ${o2.email} ${JSON.stringify(fin)}`);
  }

  // ════════════════════════ 5. Newsletter and lead magnet ════════════════════════
  section("5. Newsletter and lead magnet: honest errors, double opt-in, Resend timeout");
  {
    const post = (e: string) => newsletterRoute.POST(req("/api/newsletter", { method: "POST", body: { email: e } }));

    // persistence fails -> an error, not "bedankt"
    const dbDown = email("nl-dbdown");
    const orig = prisma.newsletterSubscriber.findUnique;
    (prisma.newsletterSubscriber as any).findUnique = async () => { throw new Error("db down"); }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const failed = await post(dbDown);
    const failedLead = await leadRoute.POST(req("/api/lead-magnet", { method: "POST", body: { email: dbDown, magnetId: "foutcodes-cheatsheet" } }));
    (prisma.newsletterSubscriber as any).findUnique = orig; // eslint-disable-line @typescript-eslint/no-explicit-any
    const failedJson = (await failed.json()) as Json;
    const failedLeadJson = (await failedLead.json()) as Json;
    check(failed.status === 503 && /niets opgeslagen/.test(String(failedJson.error)) && !failedJson.message && failedLead.status === 503 && !failedLeadJson.url && (await prisma.newsletterSubscriber.count({ where: { email: dbDown } })) === 0, "Database error: /api/newsletter AND /api/lead-magnet answer 503 'niets opgeslagen' (before: 200 'Bedankt, je bent aangemeld'), no download link, nothing stored", `db down: ${failed.status} ${JSON.stringify(failedJson)} / ${failedLead.status} ${JSON.stringify(failedLeadJson)}`);

    // mail cannot be sent -> an error (the address is stored unconfirmed, which is harmless)
    const noMail = email("nl-nomail");
    mailOk = false;
    const noMailRes = await post(noMail);
    const noMailJson = (await noMailRes.json()) as Json;
    mailOk = true;
    check(noMailRes.status === 503 && /nog niet aangemeld/.test(String(noMailJson.error)), "Confirmation mail cannot be sent: 503 'je bent nog niet aangemeld' (the visitor is not told they are subscribed)", `no mail: ${noMailRes.status} ${JSON.stringify(noMailJson)}`);
    check((await prisma.newsletterSubscriber.count({ where: { email: noMail } })) === 0, "...and NO row is left behind for an address that never got the mail (before: an unconfirmed row stayed forever, and the admin counted it as a subscriber)", "a failed sign-up left a NewsletterSubscriber row");
    // junk: a 305-character address is refused (was stored as is)
    const longMail = `${"a".repeat(250)}@${DOMAIN}`;
    const longRes = await post(longMail);
    const longLead = await leadRoute.POST(req("/api/lead-magnet", { method: "POST", body: { email: longMail, magnetId: "foutcodes-cheatsheet" } }));
    const longDirect = await newsletter.requestNewsletterSubscription(longMail, "newsletter");
    check(longRes.status === 400 && longLead.status === 400 && longDirect.ok === false && (await prisma.newsletterSubscriber.count({ where: { email: longMail } })) === 0, `An address of ${longMail.length} characters is refused by both routes and by the library, and nothing is stored (max ${newsletter.MAX_EMAIL_LENGTH})`, `long address: ${longRes.status}/${longLead.status}/${JSON.stringify(longDirect)}`);

    // happy path
    sentMail.length = 0;
    const addr = email("nl-ok");
    const ok = await post(addr.toUpperCase().replace(`@${DOMAIN.toUpperCase()}`, `@${DOMAIN}`));
    const okJson = (await ok.json()) as Json;
    const row = await prisma.newsletterSubscriber.findUnique({ where: { email: addr } });
    const mail = sentMail.find((m) => m.template === "newsletter-confirm");
    const link = /href="([^"]*\/api\/newsletter\/confirm\?token=[^"]+)"/.exec(mail?.html ?? "")?.[1]?.replace(/&amp;/g, "&");
    check(ok.status === 200 && /Tot die tijd ben je niet aangemeld/.test(String(okJson.message)) && !!row && row.confirmedAt === null && row.unsubscribedAt === null && sentMail.length === 1 && mail?.to === addr, "Sign-up: stored UNCONFIRMED (confirmedAt null), one confirmation mail to the (lower-cased) address, and the answer says you are not subscribed yet", `sign-up: ${ok.status} ${JSON.stringify(okJson)} row ${JSON.stringify(row)} mails ${sentMail.length}`);
    check(!!link && link.startsWith("https://shop.qa-privacy.test/api/newsletter/confirm?token=") && !(mail?.html ?? "").includes("Geheimstraat"), "The mail carries a signed link on the configured public address", `link: ${link}`);
    const token = link ? new URL(link).searchParams.get("token")! : "";

    // GET only shows a button (a mail scanner opening the link must not subscribe the address)
    const get = await confirmRoute.GET(new NextRequest(link ?? "http://localhost/x"));
    const getHtml = await get.text();
    const afterGet = await prisma.newsletterSubscriber.findUnique({ where: { email: addr } });
    check(get.status === 200 && /<form method="post"/.test(getHtml) && afterGet?.confirmedAt === null && /noindex/.test(getHtml), "Opening the link (GET) shows a confirm button and does NOT subscribe (mail scanners open links), noindex", `GET confirm: ${get.status} confirmedAt ${afterGet?.confirmedAt}`);
    // forged / truncated / expired / other secret
    // A character in the MIDDLE of the signature: the last base64url character of a 32-byte HMAC carries only 2 significant bits,
    // so flipping it left the decoded signature unchanged for about 6% of tokens (the check failed at random in 2 of 11 runs).
    const tparts = token.split(".");
    tparts[2] = tparts[2].slice(0, 20) + (tparts[2][20] === "A" ? "B" : "A") + tparts[2].slice(21);
    const forged = tparts.join(".");
    const bad1 = await confirmRoute.POST(formReq("/api/newsletter/confirm", { token: forged }));
    const bad2 = await confirmRoute.POST(formReq("/api/newsletter/confirm", { token: token.split(".").slice(0, 2).join(".") }));
    const expired = newsletter.signNewsletterToken(addr, Date.now() - (newsletter.NEWSLETTER_CONFIRM_TTL_DAYS + 1) * DAY)!;
    const bad3 = await confirmRoute.POST(formReq("/api/newsletter/confirm", { token: expired }));
    const tokenForOther = newsletter.signNewsletterToken(email("someone-else"))!;
    const swapped = `${tokenForOther.split(".")[0]}.${token.split(".")[1]}.${token.split(".")[2]}`;
    const bad4 = await confirmRoute.POST(formReq("/api/newsletter/confirm", { token: swapped }));
    const stillNo = await prisma.newsletterSubscriber.findUnique({ where: { email: addr } });
    check([bad1, bad2, bad3, bad4].every((r) => r.status === 400) && stillNo?.confirmedAt === null, "A forged, truncated, expired or swapped token is refused (400) and subscribes nothing", `bad tokens: ${[bad1, bad2, bad3, bad4].map((r) => r.status)} confirmedAt ${stillNo?.confirmedAt}`);
    const oldSecret = env.CRON_SECRET;
    (env as Json).CRON_SECRET = "another-secret-entirely-0123456789";
    const wrongKey = newsletter.verifyNewsletterToken(token);
    (env as Json).CRON_SECRET = oldSecret;
    check(wrongKey === null && newsletter.verifyNewsletterToken(token) === addr, "A token signed with another secret does not verify (and verifies again with the right one)", `token under another secret: ${wrongKey}`);

    // the click
    const click = await confirmRoute.POST(formReq("/api/newsletter/confirm", { token }));
    const confirmed = await prisma.newsletterSubscriber.findUnique({ where: { email: addr } });
    check(click.status === 200 && confirmed?.confirmedAt instanceof Date && confirmed.unsubscribedAt === null, "The click (POST) sets confirmedAt: only now is the address subscribed", `confirm: ${click.status} ${JSON.stringify(confirmed)}`);

    // already subscribed: no second mail (the form cannot be used to mail strangers)
    sentMail.length = 0;
    const again = await post(addr);
    const againJson = (await again.json()) as Json;
    check(again.status === 200 && /al aangemeld/.test(String(againJson.message)) && sentMail.length === 0, "Signing up an already confirmed address sends no mail and says so", `again: ${again.status} ${JSON.stringify(againJson)} mails ${sentMail.length}`);
    // unsubscribed earlier: needs a new confirmation
    await prisma.newsletterSubscriber.update({ where: { email: addr }, data: { unsubscribedAt: new Date() } });
    const resub = await post(addr);
    const afterResub = await prisma.newsletterSubscriber.findUnique({ where: { email: addr } });
    check(resub.status === 200 && sentMail.length === 1 && afterResub?.unsubscribedAt !== null, "An address that unsubscribed gets a NEW confirmation mail and stays unsubscribed until the click", `resub: ${resub.status} mails ${sentMail.length} unsubscribedAt ${afterResub?.unsubscribedAt}`);
    // too many mails to one address
    const spam = email("nl-spam");
    const results: number[] = [];
    sentMail.length = 0;
    for (let i = 0; i < 5; i++) results.push((await post(spam)).status);
    check(sentMail.length === 3, `At most 3 confirmation mails per address per day (${sentMail.length} sent for 5 requests)`, `mails to one address: ${sentMail.length}, statuses ${results}`);

    // lead magnet
    sentMail.length = 0;
    const lead = email("lead");
    const leadRes = await leadRoute.POST(req("/api/lead-magnet", { method: "POST", body: { email: lead, magnetId: "foutcodes-cheatsheet", source: "exit-intent" } }));
    const leadJson = (await leadRes.json()) as Json;
    const leadRow = await prisma.newsletterSubscriber.findUnique({ where: { email: lead } });
    check(leadRes.status === 200 && leadJson.url === "/leadmagnets/foutcodes-cheatsheet.html" && leadRow?.confirmedAt === null && leadRow.source === "lead-magnet:foutcodes-cheatsheet" && sentMail.length === 1 && /zonder die bevestiging sturen we je geen nieuwsbrief/.test(String(leadJson.message)), "Lead magnet: the download link is given, the address is stored UNCONFIRMED for the newsletter, one confirmation mail is sent, and the message says so", `lead: ${leadRes.status} ${JSON.stringify(leadJson)} row ${JSON.stringify(leadRow)}`);
    mailOk = false;
    const leadNoMail = await leadRoute.POST(req("/api/lead-magnet", { method: "POST", body: { email: email("lead2"), magnetId: "foutcodes-cheatsheet" } }));
    const leadNoMailJson = (await leadNoMail.json()) as Json;
    mailOk = true;
    check(leadNoMail.status === 200 && !!leadNoMailJson.url && /niet aangemeld voor de nieuwsbrief/.test(String(leadNoMailJson.message)), "Lead magnet: if the confirmation mail cannot be sent the download still works and the message says you are NOT subscribed", `lead no mail: ${leadNoMail.status} ${JSON.stringify(leadNoMailJson)}`);

    // Unconfirmed rows do not live forever: purged after the link expired (+ a week), confirmed rows are never touched
    const old = email("nl-old");
    const recent = email("nl-recent");
    const oldConfirmed = email("nl-oldconfirmed");
    const oldUnsub = email("nl-oldunsub");
    const ago = (days: number) => new Date(Date.now() - days * DAY);
    await prisma.newsletterSubscriber.createMany({ data: [
      { email: old, createdAt: ago(newsletter.NEWSLETTER_UNCONFIRMED_KEEP_DAYS + 1) },
      { email: recent, createdAt: ago(3) },
      { email: oldConfirmed, createdAt: ago(300), confirmedAt: ago(299) },
      { email: oldUnsub, createdAt: ago(300), confirmedAt: ago(299), unsubscribedAt: ago(10) },
    ] });
    const { runRetention: retentionRun } = await import("../src/lib/retention");
    const retRes = await retentionRun();
    const left = (await prisma.newsletterSubscriber.findMany({ where: { email: { in: [old, recent, oldConfirmed, oldUnsub] } }, select: { email: true } })).map((r) => r.email);
    check(!left.includes(old) && left.includes(recent) && left.includes(oldConfirmed) && left.includes(oldUnsub) && retRes.unconfirmedSubscribersDeleted >= 1, `The daily retention run deletes sign-ups never confirmed after ${newsletter.NEWSLETTER_UNCONFIRMED_KEEP_DAYS} days and keeps a recent one, a confirmed one and an unsubscribed one (the privacy page promises it; before: they stayed forever)`, `purge: left ${left.length} ${JSON.stringify(retRes)}`);

    // The privacy page quotes the two numbers; they must be the constants the code uses.
    const privacySrc = (await import("node:fs")).readFileSync(path.join(repo, "src/app/privacy/page.tsx"), "utf8");
    check(newsletter.NEWSLETTER_UNCONFIRMED_KEEP_DAYS === 14 && newsletter.NEWSLETTER_CONFIRM_TTL_DAYS === 7 && /na 14 dagen weer uit onze administratie \(de link werkt 7 dagen\)/.test(privacySrc), "The privacy page's numbers (link works 7 days, unconfirmed address removed after 14) are the constants the purge uses", "privacy page and newsletter constants disagree");

    // Resend audience: confirmed addresses only, bounded by a timeout
    process.env.RESEND_API_KEY = "re_qa_privacy";
    process.env.RESEND_AUDIENCE_ID = "aud_qa";
    const realFetch = globalThis.fetch;
    const seen: { url: string; signal?: AbortSignal | null }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (!u.includes("api.resend.com")) return realFetch(url as never, init);
      seen.push({ url: u, signal: init?.signal });
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }))));
    }) as typeof fetch;
    const t0 = Date.now();
    const added = await newsletter.addToResendAudience(email("aud"), 300);
    const took = Date.now() - t0;
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_AUDIENCE_ID;
    check(added === false && took < 3000 && seen.length === 1 && seen[0].signal instanceof AbortSignal && /\/audiences\/aud_qa\/contacts$/.test(seen[0].url), `Resend audience call carries an AbortSignal and gives up when Resend hangs (returned after ${took} ms; before: no timeout, it waited for the platform)`, `resend timeout: added ${added}, took ${took}, seen ${seen.length}`);
    check(newsletter.RESEND_TIMEOUT_MS > 0 && newsletter.RESEND_TIMEOUT_MS <= 10_000, `The default timeout for that call is ${newsletter.RESEND_TIMEOUT_MS} ms`, "default timeout missing");
  }

  // ─── cleanup ───
  try {
    const ids = createdUsers;
    const orders = await prisma.order.findMany({ where: { OR: [{ userId: { in: ids } }, { email: { endsWith: `@${DOMAIN}` } }, { email: { startsWith: "deleted-" }, user: { id: { in: ids } } }] }, select: { id: true } });
    const oids = orders.map((o) => o.id);
    await prisma.rmaRequest.deleteMany({ where: { OR: [{ linkedOrderId: { in: oids } }, { rmaNumber: { endsWith: RUN } }] } });
    await prisma.creditNote.deleteMany({ where: { invoice: { orderId: { in: oids } } } });
    await prisma.invoice.deleteMany({ where: { orderId: { in: oids } } });
    await prisma.order.deleteMany({ where: { id: { in: oids } } });
    await prisma.review.deleteMany({ where: { targetSku: part.sku } });
    await prisma.monteurApplication.deleteMany({ where: { applicationId: { endsWith: RUN } } });
    await prisma.newsletterSubscriber.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await prisma.user.deleteMany({ where: { OR: [{ id: { in: ids } }, { email: { endsWith: `@${DOMAIN}` } }] } });
    await prisma.user.deleteMany({ where: { email: "gastbestellingen@guest.invalid", orders: { none: {} } } });
    await prisma.part.deleteMany({ where: { id: part.id } });
    await prisma.washingMachine.deleteMany({ where: { id: machine.id } });
    // Test database: rewind the sequences to what really exists, as if the test invoices had never been issued.
    for (const { year } of await prisma.invoiceSequence.findMany()) {
      const rows = await prisma.invoice.findMany({ where: { year }, select: { number: true } });
      await prisma.invoiceSequence.update({ where: { year }, data: { last: rows.reduce((m, r) => Math.max(m, Number(r.number.slice(-5))), 0) } });
    }
    for (const { year } of await prisma.creditNoteSequence.findMany()) {
      if (year === 2999) continue;
      const rows = await prisma.creditNote.findMany({ where: { year }, select: { number: true } });
      await prisma.creditNoteSequence.update({ where: { year }, data: { last: rows.reduce((m, r) => Math.max(m, Number(r.number.slice(-5))), 0) } });
    }
  } catch (err) {
    log.push(`⚠️  cleanup incomplete: ${err instanceof Error ? err.message : String(err)}`);
  }
  slack.close();
  await prisma.$disconnect();
  void captured;
}

main()
  .catch((e) => {
    log.push(`❌ FATAL: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    realLog(log.join("\n"));
    const failures = log.filter((l) => l.startsWith("❌")).length;
    const checks = log.filter((l) => l.startsWith("✅") || l.startsWith("❌")).length;
    realLog(`\n${checks - failures}/${checks} checks passed`);
    if (failures > 0) process.exitCode = 1;
    process.exit();
  });
