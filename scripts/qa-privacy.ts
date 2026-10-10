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
 *      (R2-07 never-invoiced cancelled orders, R2-08 the webhook erased far less); both doors also flag the Resend
 *      audience contact unsubscribed after the commit
 *   2  Open orders: the route refuses, the webhook keeps them, the retention step finishes them
 *   3  The data export (R2-09: no purchase cost, no internal fields)
 *   4  Guest checkout with a member's address (R2-12, decision D16)
 *   5  Newsletter and lead magnet (R2-18): honest errors, double opt-in, Resend timeout
 *   5b Newsletter opt-out (bundle N): signed non-expiring link, GET shows a button, POST (button or RFC 8058 one-click)
 *      unsubscribes in our table first and PATCHes the Resend audience (a local HTTP stand-in; 500, 422, hang, 404, a
 *      wrong audience id); a database failure is an honest 503; owner notices go out after the response, once per
 *      address and direction; a confirmation link older than an opt-out does not undo it; two rate-limit buckets
 *      (forged tokens per caller, valid tokens per address); the RFC 8058 headers reach the transport (sendMail ->
 *      sendRaw -> the Resend stand-in's POST /emails)
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
  const sentMail: { template: string; to: string; subject: string; html: string; text?: string; headers?: Record<string, string> }[] = [];
  let mailOk = true;
  // The real sendMail, kept aside before the stub replaces it: section 5b sends one mail through it to prove the headers
  // reach the transport (sendRaw) and the Resend stand-in below.
  const realMail: { send: ((o: (typeof sentMail)[number]) => Promise<{ ok: boolean; error?: string }>) | null } = { send: null };
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
      realMail.send = real.sendMail as typeof realMail.send;
      return { ...real, sendMail: async (o: (typeof sentMail)[number]) => { sentMail.push(o); return mailOk ? { ok: true } : { ok: false, error: "qa" }; } };
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

  // A local stand-in for Resend, reached through RESEND_BASE_URL (the same override the Resend SDK honours; the SDK reads
  // it ONCE, when its module loads, so it is set here, before the first import below). Two things live on it:
  //   - the audience API (PATCH .../contacts/<email>, POST .../contacts), for section 1 (erasure), 5 and 5b. Real HTTP, so
  //     the timeout and the status handling are the real code paths. Modes: ok (200), fail (500 on everything), hang
  //     (never answers), missing (404 on the update, 200 on the create), reject (422 on the update, 200 on the create: a
  //     status the code must not mistake for "known contact");
  //   - POST /emails, what the SDK calls for a mail: the body is recorded (section 5b: the RFC 8058 headers on the wire).
  // RESEND_API_KEY and RESEND_AUDIENCE_ID stay unset until a section needs them.
  type AudienceCall = { method: string; path: string; email: string | null; body: Json; auth: string | null };
  const audience = { mode: "ok" as "ok" | "fail" | "hang" | "missing" | "reject", calls: [] as AudienceCall[] };
  const emails: Json[] = [];
  const resendFake = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed: Json = {};
      try { parsed = JSON.parse(body || "{}"); } catch { /* keep {} */ }
      if (req.method === "POST" && req.url === "/emails") {
        emails.push(parsed);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `email_${emails.length}` }));
        return;
      }
      const m = /^\/audiences\/([^/]+)\/contacts(?:\/([^/?]+))?$/.exec(req.url ?? "");
      audience.calls.push({ method: req.method ?? "", path: req.url ?? "", email: m?.[2] ? decodeURIComponent(m[2]) : null, body: parsed, auth: req.headers.authorization ?? null });
      if (audience.mode === "hang") return; // never answers; the client must give up on its own
      if (audience.mode === "fail") { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ name: "internal_server_error", message: "qa" })); return; }
      if (!m || m[1] !== "aud_qa") { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ name: "not_found", message: "audience" })); return; }
      if (req.method === "PATCH" && audience.mode === "missing") { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ name: "not_found", message: "contact" })); return; }
      if (req.method === "PATCH" && audience.mode === "reject") { res.writeHead(422, { "content-type": "application/json" }); res.end(JSON.stringify({ name: "validation_error", message: "qa" })); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "contact", id: `con_${audience.calls.length}` }));
    });
  });
  await new Promise<void>((r) => resendFake.listen(0, "127.0.0.1", r));
  process.env.RESEND_BASE_URL = `http://127.0.0.1:${(resendFake.address() as AddressInfo).port}`;
  const patches = (addr: string) => audience.calls.filter((c) => c.method === "PATCH" && c.email === addr);

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
  const afmeldenRoute = await import("../src/app/api/newsletter/afmelden/route");
  const afmeldlinksRoute = await import("../src/app/api/newsletter/afmeldlinks/route");
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
    // The audience is configured for this section: an erased person must stop receiving broadcasts too.
    process.env.RESEND_API_KEY = "re_qa_privacy";
    process.env.RESEND_AUDIENCE_ID = "aud_qa";
    audience.calls.length = 0;
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
    // The newsletter row is deleted inside the transaction; the Resend contact (a copy of it) is flagged unsubscribed after
    // the commit, best effort and after the response, so an erased person stops receiving broadcasts without a click.
    await settle();
    check(patches(viaRoute.mail).length === 1 && patches(viaRoute.mail)[0].body.unsubscribed === true && patches(viaHook.mail).length === 1 && patches(viaHook.mail)[0].body.unsubscribed === true && audience.calls.every((c) => c.method === "PATCH"), "Both doors flag the Resend audience contact unsubscribed after the commit (one PATCH {unsubscribed:true} per erased address; nothing is created)", `audience calls: ${JSON.stringify(audience.calls.map((c) => [c.method, c.email, c.body]))}`);

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
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_AUDIENCE_ID;
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
    // 3.03 as a number, not as a substring: an exported timestamp such as `…:53.035Z` contains the digits too (a flake seen once in CI).
    check(!/"costEur"/.test(text) && !/(?<![\d.])3\.03(?![\d])/.test(text) && !/"supplier"/.test(text) && !/"idempotencyKey"/.test(text), "Export: the purchase cost 3.03 and the words costEur / supplier / idempotencyKey appear nowhere in the file", `export contains internal data: ${(text.match(/[\s\S]{0,30}(costEur|(?<![\d.])3\.03(?![\d])|supplier|idempotencyKey)[\s\S]{0,30}/) ?? [""])[0]}`);
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

    // Resend audience: confirmed addresses only, bounded by a timeout. The audience call reads RESEND_BASE_URL per call, so
    // the stand-in is taken off the address for this probe and fetch itself is patched to hang on api.resend.com.
    process.env.RESEND_API_KEY = "re_qa_privacy";
    process.env.RESEND_AUDIENCE_ID = "aud_qa";
    const standInBase = process.env.RESEND_BASE_URL;
    delete process.env.RESEND_BASE_URL;
    const realFetch = globalThis.fetch;
    const seen: { url: string; method?: string; signal?: AbortSignal | null }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (!u.includes("api.resend.com")) return realFetch(url as never, init);
      seen.push({ url: u, method: init?.method, signal: init?.signal });
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }))));
    }) as typeof fetch;
    const t0 = Date.now();
    const added = await newsletter.addToResendAudience(email("aud"), 300);
    const took = Date.now() - t0;
    globalThis.fetch = realFetch;
    process.env.RESEND_BASE_URL = standInBase;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_AUDIENCE_ID;
    // The subscribe call UPDATES the contact first (an address that opted out earlier is still a contact, flagged unsubscribed) and creates it only on a 404; a hang on the first call ends the operation.
    check(added.ok === false && took < 3000 && seen.length === 1 && seen[0].signal instanceof AbortSignal && seen[0].method === "PATCH" && /\/audiences\/aud_qa\/contacts\/aud\d+\.[a-z0-9]+%40qa-privacy\.test$/.test(seen[0].url), `Resend audience call (PATCH the contact) carries an AbortSignal and gives up when Resend hangs (returned after ${took} ms; before: no timeout, it waited for the platform)`, `resend timeout: added ${added}, took ${took}, seen ${JSON.stringify(seen.map((s) => [s.method, s.url]))}`);
    check(newsletter.RESEND_TIMEOUT_MS > 0 && newsletter.RESEND_TIMEOUT_MS <= 10_000, `The default timeout for that call is ${newsletter.RESEND_TIMEOUT_MS} ms`, "default timeout missing");
  }

  // ════════════════════════ 5b. Newsletter opt-out ════════════════════════
  section("5b. Newsletter opt-out: a signed link that keeps working, one-click, our table first and the Resend audience in step");
  {
    // The Resend stand-in (audience API and POST /emails) has been listening on RESEND_BASE_URL since before the first import.
    process.env.RESEND_API_KEY = "re_qa_privacy";
    process.env.RESEND_AUDIENCE_ID = "aud_qa";
    audience.mode = "ok";
    audience.calls.length = 0;
    newsletter._setNewsletterStateForTests();
    const noticeTexts = () => slackTexts().filter((t) => /newsletter\.resend_unsubscribe_failed/.test(t));
    const subscribeNotices = () => slackTexts().filter((t) => /newsletter\.resend_subscribe_failed/.test(t));
    const unsubReq = (token: string, ip: string, oneClick = false) =>
      new NextRequest(`http://localhost/api/newsletter/afmelden${oneClick ? `?token=${encodeURIComponent(token)}` : ""}`, {
        method: "POST",
        headers: { "x-vercel-forwarded-for": ip, "content-type": "application/x-www-form-urlencoded" },
        body: oneClick ? "List-Unsubscribe=One-Click" : `token=${encodeURIComponent(token)}`,
      });
    const confirmedRow = (addr: string) => prisma.newsletterSubscriber.create({ data: { email: addr, source: "newsletter", confirmedAt: new Date(Date.now() - 30 * DAY) } });

    // The token: round trip, no expiry field, never interchangeable with the confirmation token
    const addr = email("unsub");
    const token = newsletter.signNewsletterUnsubscribeToken(addr.toUpperCase().replace(`@${DOMAIN.toUpperCase()}`, `@${DOMAIN}`))!;
    const confirmTok = newsletter.signNewsletterToken(addr)!;
    check(newsletter.verifyNewsletterUnsubscribeToken(token) === addr && token.split(".").length === 2 && token === newsletter.signNewsletterUnsubscribeToken(addr), "Unsubscribe token: round trip gives the lower-cased address, two parts (address and signature, no expiry), and is the same every time for an address", `token: ${token} -> ${newsletter.verifyNewsletterUnsubscribeToken(token)}`);
    const [uEmail, uSig] = token.split(".");
    const [cEmail, cExp, cSig] = confirmTok.split(".");
    const crossA = newsletter.verifyNewsletterUnsubscribeToken(confirmTok);
    const crossB = newsletter.verifyNewsletterToken(token);
    const crossC = newsletter.verifyNewsletterUnsubscribeToken(`${cEmail}.${cSig}`);
    const crossD = newsletter.verifyNewsletterToken(`${uEmail}.${cExp}.${uSig}`);
    const crossE = newsletter.verifyNewsletterToken(`${uEmail}.${Math.floor(Date.now() / 1000) + 10 * 86400}.${uSig}`);
    check([crossA, crossB, crossC, crossD, crossE].every((v) => v === null), "Neither token passes as the other: a confirmation token (or its signature re-shaped to two parts) is not an unsubscribe token, and an unsubscribe signature with any expiry glued on is not a confirmation token", `cross-purpose: ${JSON.stringify([crossA, crossB, crossC, crossD, crossE])}`);
    // The brief's "different purpose string" inside the signed message, pinned: a signature with the SAME derived key over the
    // address part alone, or over the confirmation token's shape of message, is refused (the key derivation of newsletter.ts
    // is repeated here on purpose), and the token for a fixed address under this suite's fixed CRON_SECRET is the recorded one.
    const { createHmac } = await import("node:crypto");
    const derivedKey = createHmac("sha256", "wasfix-newsletter-confirm-v1").update(String(process.env.CRON_SECRET)).digest();
    const noPurpose = `${uEmail}.${createHmac("sha256", derivedKey).update(uEmail).digest("base64url")}`;
    const confirmShaped = `${uEmail}.${createHmac("sha256", derivedKey).update(`${uEmail}.`).digest("base64url")}`;
    const pinned = newsletter.signNewsletterUnsubscribeToken("pin@qa-privacy.test");
    check(newsletter.verifyNewsletterUnsubscribeToken(noPurpose) === null && newsletter.verifyNewsletterUnsubscribeToken(confirmShaped) === null && pinned === "cGluQHFhLXByaXZhY3kudGVzdA.tOTBZM8mDRzZqaYmYKxzjsx8ZM4sUq6JpywIi1aQhnQ", "The unsubscribe signature covers a purpose string: a signature over the address part alone (same key, no purpose) is refused, and the token of a fixed address under this suite's secret is the recorded constant", `purpose: no-purpose ${newsletter.verifyNewsletterUnsubscribeToken(noPurpose)} confirm-shaped ${newsletter.verifyNewsletterUnsubscribeToken(confirmShaped)} pinned ${pinned}`);
    const forgedSig = uSig.slice(0, 20) + (uSig[20] === "A" ? "B" : "A") + uSig.slice(21);
    const oldSecret2 = env.CRON_SECRET;
    (env as Json).CRON_SECRET = "another-secret-entirely-0123456789";
    const otherKey = newsletter.verifyNewsletterUnsubscribeToken(token);
    (env as Json).CRON_SECRET = oldSecret2;
    check(newsletter.verifyNewsletterUnsubscribeToken(`${uEmail}.${forgedSig}`) === null && newsletter.verifyNewsletterUnsubscribeToken(uEmail) === null && newsletter.verifyNewsletterUnsubscribeToken(`${newsletter.signNewsletterUnsubscribeToken(email("someone-else"))!.split(".")[0]}.${uSig}`) === null && otherKey === null, "A forged, truncated or swapped unsubscribe token is refused, and so is one signed under another secret (knowing an address is not enough)", `forged: ${newsletter.verifyNewsletterUnsubscribeToken(`${uEmail}.${forgedSig}`)} truncated: ${newsletter.verifyNewsletterUnsubscribeToken(uEmail)} other secret: ${otherKey}`);
    const hdrs = newsletter.listUnsubscribeHeaders(addr)!;
    const url = newsletter.newsletterUnsubscribeUrl(addr)!;
    check(url === `https://shop.qa-privacy.test/api/newsletter/afmelden?token=${encodeURIComponent(token)}` && hdrs["List-Unsubscribe"] === `<${url}>` && hdrs["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click" && Object.keys(hdrs).length === 2, "listUnsubscribeHeaders(): the RFC 8058 pair (List-Unsubscribe with the signed URL on the public address, List-Unsubscribe-Post: List-Unsubscribe=One-Click)", `headers: ${JSON.stringify(hdrs)} url ${url}`);

    // The confirmation mail carries the link, the sentence and the two headers (the only mail this app sends to the list)
    sentMail.length = 0;
    const signUp = await newsletterRoute.POST(req("/api/newsletter", { method: "POST", body: { email: addr } }));
    const cMail = sentMail.find((m) => m.template === "newsletter-confirm") as (typeof sentMail)[number] & { headers?: Record<string, string> } | undefined;
    const mailLink = /href="([^"]*\/api\/newsletter\/afmelden\?token=[^"]+)"/.exec(cMail?.html ?? "")?.[1]?.replace(/&amp;/g, "&");
    check(signUp.status === 200 && mailLink === url && (cMail?.text ?? "").includes(url) && /Elke nieuwsbrief die we sturen bevat een afmeldlink/.test(cMail?.html ?? "") && /Elke nieuwsbrief die we sturen bevat een afmeldlink/.test(cMail?.text ?? ""), "The confirmation mail (HTML and text) carries the unsubscribe link and says every newsletter will carry one", `mail link: ${mailLink} text has url: ${(cMail?.text ?? "").includes(url)}`);
    check(!!cMail?.headers && cMail.headers["List-Unsubscribe"] === `<${url}>` && cMail.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click", "...and the sendMail call carries the List-Unsubscribe and List-Unsubscribe-Post headers", `mail headers: ${JSON.stringify(cMail?.headers)}`);
    // ...and they reach the wire: the REAL sendMail (kept aside before the stub replaced it) hands `headers` to sendRaw
    // (src/lib/emails/transport.ts), which passes them to the Resend SDK as given; the stand-in records what the SDK POSTs
    // to /emails. The transport reads the key from the env snapshot, so that is set for this one send and cleared again.
    (env as Json).RESEND_API_KEY = "re_qa_privacy";
    emails.length = 0;
    const wired = await realMail.send!({ template: "newsletter-confirm", to: addr, subject: `qa headers ${RUN}`, html: "<p>qa</p>", headers: hdrs });
    (env as Json).RESEND_API_KEY = undefined;
    const onWire = emails.find((m) => m.subject === `qa headers ${RUN}`);
    check(wired.ok === true && !!onWire && onWire.to === addr && onWire.headers?.["List-Unsubscribe"] === `<${url}>` && onWire.headers?.["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click" && Object.keys(onWire.headers ?? {}).length === 2, "...and sendMail -> sendRaw passes them to Resend as given: the POST /emails body the stand-in received carries exactly the two headers (RFC 8058 one-click is on the wire)", `on the wire: ${JSON.stringify(onWire)} result ${JSON.stringify(wired)} emails ${emails.length}`);

    // GET: a button and nothing else; the wrong kind of token is refused by both routes
    await prisma.newsletterSubscriber.update({ where: { email: addr }, data: { confirmedAt: new Date() } });
    audience.calls.length = 0;
    const get = await afmeldenRoute.GET(new NextRequest(url));
    const getHtml = await get.text();
    const afterGet = await prisma.newsletterSubscriber.findUnique({ where: { email: addr } });
    check(get.status === 200 && /<form method="post" action="\/api\/newsletter\/afmelden">/.test(getHtml) && getHtml.includes(`name="token" value="${token}"`) && /Ja, meld mij af/.test(getHtml) && /noindex/.test(getHtml) && afterGet?.unsubscribedAt === null && audience.calls.length === 0, "Opening the link (GET) shows an unsubscribe button, noindex, and changes NOTHING (no unsubscribedAt, no Resend call): mail scanners open links", `GET afmelden: ${get.status} unsubscribedAt ${afterGet?.unsubscribedAt} resend calls ${audience.calls.length} html ${getHtml.slice(0, 300)}`);
    const getBad = await afmeldenRoute.GET(new NextRequest(`http://localhost/api/newsletter/afmelden?token=${encodeURIComponent(confirmTok)}`));
    const getBadHtml = await getBad.text();
    const postCross = await confirmRoute.POST(formReq("/api/newsletter/confirm", { token }));
    const afterCross = await prisma.newsletterSubscriber.findUnique({ where: { email: addr } });
    check(getBad.status === 400 && !/<form/.test(getBadHtml) && /afmeldlink onderaan een nieuwsbrief/.test(getBadHtml) && getBadHtml.includes("qa@qa-privacy.test") && postCross.status === 400 && afterCross?.unsubscribedAt === null, "A confirmation token on the unsubscribe page is refused (400, honest text naming the configured contact address), and an unsubscribe token on the confirmation route is refused too", `cross routes: GET ${getBad.status} / POST confirm ${postCross.status}`);

    // POST: unsubscribed in our table, PATCHed in Resend, idempotent, same page for an unknown address
    const t0 = Date.now();
    const post = await afmeldenRoute.POST(formReq("/api/newsletter/afmelden", { token }));
    const postHtml = await post.text();
    const row1 = await prisma.newsletterSubscriber.findUnique({ where: { email: addr } });
    const p1 = patches(addr);
    check(post.status === 200 && /Je bent afgemeld/.test(postHtml) && /gaat direct in/.test(postHtml) && row1?.unsubscribedAt instanceof Date && row1.unsubscribedAt.getTime() >= t0 - 1000 && row1.confirmedAt instanceof Date, "The click (POST) sets unsubscribedAt and answers 'Je bent afgemeld' (confirmedAt is kept: the row records that consent once existed)", `POST afmelden: ${post.status} row ${JSON.stringify(row1)} html ${postHtml.slice(0, 200)}`);
    check(p1.length === 1 && p1[0].path === `/audiences/aud_qa/contacts/${encodeURIComponent(addr)}` && JSON.stringify(p1[0].body) === JSON.stringify({ unsubscribed: true }) && p1[0].auth === "Bearer re_qa_privacy", "...and PATCHes the Resend contact: /audiences/{RESEND_AUDIENCE_ID}/contacts/{email} with body {\"unsubscribed\":true} and the bearer key", `resend calls: ${JSON.stringify(audience.calls)}`);
    check((await prisma.newsletterSubscriber.count({ where: { email: addr, confirmedAt: { not: null }, unsubscribedAt: null } })) === 0, "The row no longer counts as a subscriber under the admin's definition (confirmedAt set AND unsubscribedAt null)", "an unsubscribed row still counts as a subscriber");
    const again = await afmeldenRoute.POST(formReq("/api/newsletter/afmelden", { token }));
    const row2 = await prisma.newsletterSubscriber.findUnique({ where: { email: addr } });
    check(again.status === 200 && /Je bent afgemeld/.test(await again.text()) && row2?.unsubscribedAt?.getTime() === row1?.unsubscribedAt?.getTime(), "A second click is still 'afgemeld' (200) and keeps the first timestamp (idempotent)", `second click: ${again.status} ${row2?.unsubscribedAt?.getTime()} vs ${row1?.unsubscribedAt?.getTime()}`);
    // An address we do not know (never confirmed, purged, erased): the same page, no row, and Resend is still asked (the
    // token proves we once mailed the address); its 404 ("not in the audience") is an answer, not a failure: no owner notice.
    const ghost = email("ghost");
    const ghostTok = newsletter.signNewsletterUnsubscribeToken(ghost)!;
    audience.mode = "missing";
    const noticesBeforeGhost = noticeTexts().length;
    const ghostRes = await afmeldenRoute.POST(formReq("/api/newsletter/afmelden", { token: ghostTok }));
    const ghostHtml = await ghostRes.text();
    await settle();
    check(ghostRes.status === 200 && ghostHtml === postHtml && (await prisma.newsletterSubscriber.count({ where: { email: ghost } })) === 0, "An address we do not know gets the IDENTICAL page (200 'Je bent afgemeld'), and no row is created: the route cannot be used to find out who is on the list", `unknown address: ${ghostRes.status} same html ${ghostHtml === postHtml} rows ${await prisma.newsletterSubscriber.count({ where: { email: ghost } })}`);
    check(patches(ghost).length === 1 && JSON.stringify(patches(ghost)[0].body) === JSON.stringify({ unsubscribed: true }) && noticeTexts().length === noticesBeforeGhost, "...its Resend contact is still PATCHed (the token proves we once mailed the address), and Resend's 404 for it ('not in the audience') raises NO owner notice", `ghost: patches ${patches(ghost).length} notices ${noticeTexts().length} (before ${noticesBeforeGhost})`);
    const ghostDirect = await newsletter.removeFromResendAudience(ghost);
    const pending = email("unsub-pending");
    await prisma.newsletterSubscriber.create({ data: { email: pending, source: "newsletter" } });
    const pendingRes = await afmeldenRoute.POST(formReq("/api/newsletter/afmelden", { token: newsletter.signNewsletterUnsubscribeToken(pending)! }));
    const pendingHtml = await pendingRes.text();
    await settle();
    const pendingRow = await prisma.newsletterSubscriber.findUnique({ where: { email: pending } });
    check(ghostDirect.outcome === "not_in_audience" && pendingRes.status === 200 && pendingHtml === postHtml && pendingRow?.unsubscribedAt instanceof Date && pendingRow.confirmedAt === null && patches(pending).length === 1 && noticeTexts().length === noticesBeforeGhost, "removeFromResendAudience() reports 'not_in_audience' on a 404, and the opt-out of a row that was never confirmed (so never in the audience) is recorded, gets the same page and raises no notice", `404 branch: direct ${JSON.stringify(ghostDirect)} pending ${pendingRes.status} same html ${pendingHtml === postHtml} row ${JSON.stringify(pendingRow)} patches ${patches(pending).length} notices ${noticeTexts().length}`);
    audience.mode = "ok";

    // Resend down: the opt-out holds, the page claims no more than the table guarantees, the owner is told once per address
    // (without the address) and only AFTER the response
    slackBodies.length = 0;
    audience.mode = "fail";
    const down = email("unsub-down");
    const downRow = await confirmedRow(down);
    const downTok = newsletter.signNewsletterUnsubscribeToken(down)!;
    const downRes = await afmeldenRoute.POST(formReq("/api/newsletter/afmelden", { token: downTok }));
    // Read before anything else is awaited: a notice that was part of the answer would already be here.
    const noticesAtAnswer = noticeTexts().length;
    const downHtml = await downRes.text();
    const downAfter = await prisma.newsletterSubscriber.findUnique({ where: { email: down } });
    await settle();
    const n1 = noticeTexts();
    check(downRes.status === 200 && /Je bent afgemeld/.test(downHtml) && /opgeslagen en gaat direct in/.test(downHtml) && /verzendsysteem/.test(downHtml) && !/ontvangt geen nieuwsbrieven meer/.test(downHtml) && downAfter?.unsubscribedAt instanceof Date && patches(down).length === 1, "Resend answers 500: the opt-out is still recorded (our table is authoritative), and the page says it is stored, in force and still being passed on, NOT that nothing will arrive any more (the contact is still flagged subscribed until the owner acts)", `resend 500: ${downRes.status} row ${JSON.stringify(downAfter)} html ${downHtml.slice(0, 400)}`);
    check(n1.length === 1 && /Afmelding niet doorgegeven aan Resend/.test(n1[0]) && /http_500/.test(n1[0]) && n1[0].includes(downRow.id) && /unsubscribed/.test(n1[0]) && !n1[0].includes(down) && !n1[0].includes("@qa-privacy.test"), "...and the owner is told (reason http_500, the row id to find the address, the instruction to fix the audience by hand), without the address itself", `owner notices: ${JSON.stringify(n1)}`);
    check(noticesAtAnswer === 0, "...after the response, not inside it: when the route has answered, the notice has not been delivered yet (next/server after(); fire-and-forget outside a request scope, as here)", `notices already delivered when the route answered: ${noticesAtAnswer}`);
    const downAgain = await afmeldenRoute.POST(formReq("/api/newsletter/afmelden", { token: downTok }));
    await settle();
    check(downAgain.status === 200 && noticeTexts().length === 1 && patches(down).length === 2, "A second click while Resend is still down retries the PATCH but does NOT tell the owner again (once per address)", `second click while down: ${downAgain.status} notices ${noticeTexts().length} patches ${patches(down).length}`);
    // Resend hangs: bounded by the timeout, same outcome, its own notice
    audience.mode = "hang";
    newsletter._setNewsletterStateForTests({ resendTimeoutMs: 300 });
    const hang = email("unsub-hang");
    await confirmedRow(hang);
    const t1 = Date.now();
    const hangRes = await afmeldenRoute.POST(formReq("/api/newsletter/afmelden", { token: newsletter.signNewsletterUnsubscribeToken(hang)! }));
    const hangTook = Date.now() - t1;
    const hangAfter = await prisma.newsletterSubscriber.findUnique({ where: { email: hang } });
    await settle();
    const n2 = noticeTexts();
    check(hangRes.status === 200 && hangTook < 3000 && hangAfter?.unsubscribedAt instanceof Date && n2.length === 2 && /timeout_300ms/.test(n2[1]), `Resend hangs: the route answers 'afgemeld' after the timeout (${hangTook} ms), the row is unsubscribed, and the owner notice names the timeout`, `resend hang: ${hangRes.status} took ${hangTook} row ${JSON.stringify(hangAfter)} notices ${JSON.stringify(n2)}`);
    resendFake.closeAllConnections?.();
    newsletter._setNewsletterStateForTests();
    audience.mode = "ok";
    // Resend not configured: no call, no notice, the opt-out holds
    delete process.env.RESEND_AUDIENCE_ID;
    const noAud = email("unsub-noaud");
    await confirmedRow(noAud);
    audience.calls.length = 0;
    const noAudRes = await afmeldenRoute.POST(formReq("/api/newsletter/afmelden", { token: newsletter.signNewsletterUnsubscribeToken(noAud)! }));
    const noAudAfter = await prisma.newsletterSubscriber.findUnique({ where: { email: noAud } });
    await settle();
    check(noAudRes.status === 200 && noAudAfter?.unsubscribedAt instanceof Date && audience.calls.length === 0 && noticeTexts().length === 2, "Without RESEND_AUDIENCE_ID the opt-out is recorded with no Resend call and no notice (there is no audience to keep in step)", `no audience: ${noAudRes.status} calls ${audience.calls.length} notices ${noticeTexts().length}`);
    process.env.RESEND_AUDIENCE_ID = "aud_qa";

    // RFC 8058 one-click: the POST a mail client sends to the header URL, no page
    const oc = email("unsub-oneclick");
    await confirmedRow(oc);
    const ocTok = newsletter.signNewsletterUnsubscribeToken(oc)!;
    const ocRes = await afmeldenRoute.POST(unsubReq(ocTok, freshIp(), true));
    const ocText = await ocRes.text();
    const ocAfter = await prisma.newsletterSubscriber.findUnique({ where: { email: oc } });
    check(ocRes.status === 200 && /^text\/plain/.test(ocRes.headers.get("content-type") ?? "") && !/<html/.test(ocText) && /Afgemeld/.test(ocText) && ocAfter?.unsubscribedAt instanceof Date && patches(oc).length === 1 && JSON.stringify(patches(oc)[0].body) === JSON.stringify({ unsubscribed: true }), "One-click: POST ?token=... with body List-Unsubscribe=One-Click unsubscribes, PATCHes Resend and answers 200 with a line of text, no page", `one-click: ${ocRes.status} ${ocRes.headers.get("content-type")} ${ocText.slice(0, 120)} row ${JSON.stringify(ocAfter)}`);
    const ocBad = await afmeldenRoute.POST(unsubReq(`${uEmail}.${forgedSig}`, freshIp(), true));
    const formBad = await afmeldenRoute.POST(formReq("/api/newsletter/afmelden", { token: `${uEmail}.${forgedSig}` }));
    check(ocBad.status === 400 && /^text\/plain/.test(ocBad.headers.get("content-type") ?? "") && formBad.status === 400 && /<html/.test(await formBad.text()), "A forged token is refused by both callers: 400 text for one-click, a 400 page for the button", `forged: one-click ${ocBad.status}, form ${formBad.status}`);
    // A bodiless POST to the header URL with a VALID token (a non-compliant mail client): the same shape as its 400/429, a line of text, never a page.
    const bodiless = email("unsub-bodiless");
    await confirmedRow(bodiless);
    const bodilessRes = await afmeldenRoute.POST(new NextRequest(`http://localhost/api/newsletter/afmelden?token=${encodeURIComponent(newsletter.signNewsletterUnsubscribeToken(bodiless)!)}`, { method: "POST", headers: { "x-vercel-forwarded-for": freshIp() } }));
    const bodilessText = await bodilessRes.text();
    const bodilessRow = await prisma.newsletterSubscriber.findUnique({ where: { email: bodiless } });
    check(bodilessRes.status === 200 && /^text\/plain/.test(bodilessRes.headers.get("content-type") ?? "") && /^Afgemeld/.test(bodilessText) && !/<html/.test(bodilessText) && bodilessRow?.unsubscribedAt instanceof Date, "A bodiless POST to the one-click URL with a valid token is unsubscribed and answered as a line of text (200), like its 400 and 429: one shape per caller", `bodiless valid: ${bodilessRes.status} ${bodilessRes.headers.get("content-type")} ${bodilessText.slice(0, 120)}`);
    // One-click while Resend is down: still 200, and the line says stored and in force, not "nothing arrives any more"
    audience.mode = "fail";
    const ocDown = email("unsub-oneclick-down");
    await confirmedRow(ocDown);
    const ocDownRes = await afmeldenRoute.POST(unsubReq(newsletter.signNewsletterUnsubscribeToken(ocDown)!, freshIp(), true));
    const ocDownText = await ocDownRes.text();
    await settle();
    audience.mode = "ok";
    check(ocDownRes.status === 200 && /^text\/plain/.test(ocDownRes.headers.get("content-type") ?? "") && /^Afgemeld/.test(ocDownText) && /opgeslagen en gaat direct in/.test(ocDownText) && !/ontvangt geen nieuwsbrieven meer/.test(ocDownText) && noticeTexts().length === 3, "One-click while Resend answers 500: 200, the line says the opt-out is stored and in force (not that nothing arrives any more), and the owner is told", `one-click while down: ${ocDownRes.status} ${ocDownText} notices ${noticeTexts().length}`);

    // The table cannot be written: an honest 503 for the button and for one-click, nothing sent to Resend, no owner notice,
    // the row untouched. The same rule as the sign-up (R2-18): never "afgemeld" for an opt-out that was not stored.
    const dbDown = email("unsub-dbdown");
    await confirmedRow(dbDown);
    const dbDownTok = newsletter.signNewsletterUnsubscribeToken(dbDown)!;
    const noticesBeforeDb = noticeTexts().length;
    const origFind = prisma.newsletterSubscriber.findUnique;
    (prisma.newsletterSubscriber as any).findUnique = async () => { throw new Error("db down"); };
    const dbDownPage = await afmeldenRoute.POST(formReq("/api/newsletter/afmelden", { token: dbDownTok }));
    const dbDownOc = await afmeldenRoute.POST(unsubReq(dbDownTok, freshIp(), true));
    (prisma.newsletterSubscriber as any).findUnique = origFind;
    const dbDownHtml = await dbDownPage.text();
    const dbDownText = await dbDownOc.text();
    await settle();
    const dbDownAfter = await prisma.newsletterSubscriber.findUnique({ where: { email: dbDown } });
    check(dbDownPage.status === 503 && /Afmelden lukt nu niet/.test(dbDownHtml) && /konden je afmelding niet opslaan/.test(dbDownHtml) && !/Je bent afgemeld/.test(dbDownHtml) && dbDownOc.status === 503 && /^text\/plain/.test(dbDownOc.headers.get("content-type") ?? "") && /Afmelden lukt nu niet/.test(dbDownText) && !/^Afgemeld/.test(dbDownText),
      "Database error while storing the opt-out: 503 'Afmelden lukt nu niet' with 'konden je afmelding niet opslaan' for the button, a 503 line of text for one-click, never 'afgemeld' (an opt-out that was not stored is not claimed)", `db down: page ${dbDownPage.status} ${dbDownHtml.slice(0, 300)} / one-click ${dbDownOc.status} ${dbDownText}`);
    check(patches(dbDown).length === 0 && noticeTexts().length === noticesBeforeDb && dbDownAfter?.unsubscribedAt === null && dbDownAfter.confirmedAt instanceof Date,
      "...no Resend call and no owner notice for it (our table comes first; nothing was recorded), and the row is still a subscriber", `db down: patches ${patches(dbDown).length} notices ${noticeTexts().length} (before ${noticesBeforeDb}) row ${JSON.stringify(dbDownAfter)}`);

    // Rate limits. Only a token that does NOT verify counts against the caller (the guard against guessing): perCaller per
    // address and hour, then 429 in the caller's shape (a page for the button; a line of text for a one-click body, and
    // for the one-click URL even without a body). The body is read first, because what counts depends on the token.
    const { perCaller, perAddress } = newsletter.UNSUBSCRIBE_RATE_LIMIT;
    const ip = freshIp();
    const forgedTok = `${uEmail}.${forgedSig}`;
    const statuses: number[] = [];
    for (let i = 0; i < perCaller.max + 1; i++) statuses.push((await afmeldenRoute.POST(unsubReq(forgedTok, ip, i % 2 === 0))).status);
    const limitedPage = await afmeldenRoute.POST(unsubReq(forgedTok, ip));
    const limitedPageText = await limitedPage.text();
    const limitedOneClick = await afmeldenRoute.POST(unsubReq(forgedTok, ip, true));
    const limitedNoBody = await afmeldenRoute.POST(new NextRequest(`http://localhost/api/newsletter/afmelden?token=${encodeURIComponent(forgedTok)}`, { method: "POST", headers: { "x-vercel-forwarded-for": ip } }));
    check(statuses.slice(0, perCaller.max).every((s) => s === 400) && statuses[perCaller.max] === 429 && limitedPage.status === 429 && /<html/.test(limitedPageText) && /Te veel pogingen/.test(limitedPageText) && limitedOneClick.status === 429 && /^text\/plain/.test(limitedOneClick.headers.get("content-type") ?? "") && limitedNoBody.status === 429 && /^text\/plain/.test(limitedNoBody.headers.get("content-type") ?? ""), `Forged tokens are rate limited per caller: ${perCaller.max} per address and hour (400 each), then 429 for one-click and button alike: a page for the button, a line of text for a one-click body and for the one-click URL (a bodiless POST to that URL gets the text too)`, `rate limit statuses: ${statuses.join(",")} then page ${limitedPage.status} (${limitedPage.headers.get("content-type")}), one-click ${limitedOneClick.status} (${limitedOneClick.headers.get("content-type")}), no body ${limitedNoBody.status} (${limitedNoBody.headers.get("content-type")})`);
    // A VALID token from that exhausted caller still works: one-click POSTs arrive from the mail provider's servers, which
    // all its readers share (and readers behind a carrier NAT share one address), and a 429 would be a refused opt-out
    // (Telecommunicatiewet art. 11.7 lid 6) for a request that can only ever unsubscribe its own address (review finding).
    const spared = email("unsub-spared");
    await confirmedRow(spared);
    const sparedTok = newsletter.signNewsletterUnsubscribeToken(spared)!;
    const sparedBtn = await afmeldenRoute.POST(unsubReq(sparedTok, ip));
    const sparedOc = await afmeldenRoute.POST(unsubReq(sparedTok, ip, true));
    const sparedRow = await prisma.newsletterSubscriber.findUnique({ where: { email: spared } });
    check(sparedBtn.status === 200 && /Je bent afgemeld/.test(await sparedBtn.text()) && sparedOc.status === 200 && /^Afgemeld/.test(await sparedOc.text()) && sparedRow?.unsubscribedAt instanceof Date && patches(spared).length === 2,
      "A VALID token from the caller whose forged-token bucket is exhausted is still accepted, button and one-click alike (200, unsubscribed, Resend PATCHed): a valid-token POST never counts against the caller's address, which one-click readers share with their whole mail provider", `valid token past the caller limit: button ${sparedBtn.status}, one-click ${sparedOc.status}, row ${JSON.stringify(sparedRow)}`);
    // What a valid token can cause is bounded per ADDRESS instead: perAddress per hour from any caller, then 429; by then the
    // opt-out was recorded by the first POST, and the Resend calls one token can trigger stop at the same number.
    const hammer = email("unsub-hammer");
    await confirmedRow(hammer);
    const hammerTok = newsletter.signNewsletterUnsubscribeToken(hammer)!;
    const hammerStatuses: number[] = [];
    for (let i = 0; i < perAddress.max + 1; i++) hammerStatuses.push((await afmeldenRoute.POST(unsubReq(hammerTok, freshIp(), i % 2 === 1))).status);
    const hammerRow = await prisma.newsletterSubscriber.findUnique({ where: { email: hammer } });
    check(hammerStatuses.slice(0, perAddress.max).every((s) => s === 200) && hammerStatuses[perAddress.max] === 429 && hammerRow?.unsubscribedAt instanceof Date && patches(hammer).length === perAddress.max,
      `...and a valid token counts against its own address: ${perAddress.max} POSTs per address and hour from any callers, then 429 (the opt-out stands from the first one, and Resend was asked ${perAddress.max} times at most)`, `per-address limit: ${hammerStatuses.join(",")} row ${JSON.stringify(hammerRow)} patches ${patches(hammer).length}`);

    // Re-subscribe after an opt-out: a new sign-up plus a new click clears unsubscribedAt and puts the contact back on the audience.
    // The opt-out was a while ago (a minute): the confirmation token's expiry has second resolution, so an opt-out in the
    // same second as the sign-up would count as later than the link and be kept (the old-link check below).
    await prisma.newsletterSubscriber.update({ where: { email: oc }, data: { unsubscribedAt: new Date(Date.now() - 60_000) } });
    sentMail.length = 0;
    const resubRes = await newsletterRoute.POST(req("/api/newsletter", { method: "POST", body: { email: oc } }));
    const resubMail = sentMail.find((m) => m.template === "newsletter-confirm");
    const resubLink = /href="([^"]*\/api\/newsletter\/confirm\?token=[^"]+)"/.exec(resubMail?.html ?? "")?.[1]?.replace(/&amp;/g, "&");
    const resubTok = resubLink ? new URL(resubLink).searchParams.get("token")! : "";
    const beforeClick = await prisma.newsletterSubscriber.findUnique({ where: { email: oc } });
    audience.calls.length = 0;
    const click = await confirmRoute.POST(formReq("/api/newsletter/confirm", { token: resubTok }));
    const afterClick = await prisma.newsletterSubscriber.findUnique({ where: { email: oc } });
    const resubCalls = audience.calls.filter((c) => c.email === oc || (c.method === "POST" && c.body.email === oc));
    check(resubRes.status === 200 && !!resubTok && beforeClick?.unsubscribedAt instanceof Date && click.status === 200 && afterClick?.unsubscribedAt === null && afterClick.confirmedAt instanceof Date && afterClick.confirmedAt.getTime() > (beforeClick?.confirmedAt?.getTime() ?? 0), "Re-subscribe: the sign-up mails a new confirmation link, the address stays unsubscribed until the click, and the click clears unsubscribedAt with a fresh confirmedAt", `re-subscribe: ${resubRes.status} click ${click.status} before ${JSON.stringify(beforeClick)} after ${JSON.stringify(afterClick)}`);
    check(resubCalls.length === 1 && resubCalls[0].method === "PATCH" && JSON.stringify(resubCalls[0].body) === JSON.stringify({ unsubscribed: false }), "...and the Resend contact is PATCHed back to unsubscribed:false (an existing contact is updated, not created again)", `resend on re-subscribe: ${JSON.stringify(resubCalls)}`);
    // An OLD confirmation link cannot undo a LATER opt-out (AVG art. 21 lid 3): the link's issue time is in the token (the
    // expiry minus the TTL). Timeline: link A mailed a minute ago and clicked (subscribed), opt-out through our link now,
    // then "Ja, meld mij aan" pressed again in the old mail (A stays valid for 7 days): the opt-out stands, the row is not
    // touched, no Resend call, and the page says so. A NEW sign-up (link B, mailed after the opt-out) plus its click clears it.
    const late = email("unsub-late");
    const tA = Date.now() - 60_000;
    const linkA = newsletter.signNewsletterToken(late, tA)!;
    const readA = newsletter.readNewsletterToken(linkA);
    const clickA = await confirmRoute.POST(formReq("/api/newsletter/confirm", { token: linkA }));
    const lateOptOut = await afmeldenRoute.POST(formReq("/api/newsletter/afmelden", { token: newsletter.signNewsletterUnsubscribeToken(late)! }));
    const lateRow1 = await prisma.newsletterSubscriber.findUnique({ where: { email: late } });
    audience.calls.length = 0;
    const clickAgain = await confirmRoute.POST(formReq("/api/newsletter/confirm", { token: linkA }));
    const clickAgainHtml = await clickAgain.text();
    const lateRow2 = await prisma.newsletterSubscriber.findUnique({ where: { email: late } });
    check(!!readA && readA.email === late && readA.issuedAt <= tA && readA.issuedAt > tA - 1000 && clickA.status === 200 && lateOptOut.status === 200 && lateRow1?.unsubscribedAt instanceof Date && lateRow1.confirmedAt instanceof Date,
      "readNewsletterToken(): the address and the link's issue time (to the second); link A (mailed a minute ago) confirms, then the opt-out through our link is recorded", `old link set-up: read ${JSON.stringify(readA)} vs ${tA}, click ${clickA.status}, opt-out ${lateOptOut.status}, row ${JSON.stringify(lateRow1)}`);
    check(clickAgain.status === 200 && /Je afmelding blijft staan/.test(clickAgainHtml) && /meld je dan opnieuw aan/.test(clickAgainHtml) && !/Je bent aangemeld/.test(clickAgainHtml) && lateRow2?.unsubscribedAt?.getTime() === lateRow1?.unsubscribedAt?.getTime() && lateRow2?.confirmedAt?.getTime() === lateRow1?.confirmedAt?.getTime() && audience.calls.length === 0,
      "Pressing the button in the OLD mail after that opt-out does not undo it: 'Je afmelding blijft staan' (sign up again if you want), unsubscribedAt and confirmedAt untouched, no Resend call (before: any valid confirmation token cleared the opt-out and PATCHed the contact back to subscribed)", `old link after opt-out: ${clickAgain.status} row ${JSON.stringify(lateRow2)} resend calls ${JSON.stringify(audience.calls)} html ${clickAgainHtml.slice(0, 300)}`);
    await prisma.newsletterSubscriber.update({ where: { email: late }, data: { unsubscribedAt: new Date(Date.now() - 30_000) } }); // second resolution, as above
    sentMail.length = 0;
    const lateResub = await newsletterRoute.POST(req("/api/newsletter", { method: "POST", body: { email: late } }));
    const linkB = /href="([^"]*\/api\/newsletter\/confirm\?token=[^"]+)"/.exec(sentMail.find((m) => m.template === "newsletter-confirm")?.html ?? "")?.[1]?.replace(/&amp;/g, "&");
    const clickB = await confirmRoute.POST(formReq("/api/newsletter/confirm", { token: linkB ? new URL(linkB).searchParams.get("token")! : "" }));
    const lateRow3 = await prisma.newsletterSubscriber.findUnique({ where: { email: late } });
    check(lateResub.status === 200 && !!linkB && clickB.status === 200 && /Je bent aangemeld/.test(await clickB.text()) && lateRow3?.unsubscribedAt === null && patches(late).some((c) => c.body.unsubscribed === false),
      "...while the NEW link (mailed after the opt-out) plus its click clears the opt-out and PATCHes the contact back to subscribed: a later sign-up is a new consent, an older mail is not", `new link after opt-out: ${lateResub.status} click ${clickB.status} row ${JSON.stringify(lateRow3)} patches ${JSON.stringify(patches(late).map((c) => c.body))}`);
    // The contact is gone from the audience (deleted by the owner, or never there): created instead
    audience.mode = "missing";
    audience.calls.length = 0;
    const fresh = email("aud-fresh");
    const created = await newsletter.addToResendAudience(fresh);
    const freshCalls = audience.calls.map((c) => [c.method, c.email ?? c.body.email, c.body.unsubscribed]);
    audience.mode = "ok";
    check(created.ok === true && JSON.stringify(freshCalls) === JSON.stringify([["PATCH", fresh, false], ["POST", fresh, false]]), "A contact Resend does not know (404 on the update) is created with unsubscribed:false; a known one needs the update only", `resend create path: ${JSON.stringify(created)} ${JSON.stringify(freshCalls)}`);
    // An update refused with a status other than 404 (here 422) still falls through to the create: what Resend answers for a
    // contact it does not know was never verified, and a wrong guess must not stop the audience from growing (review finding)
    audience.mode = "reject";
    audience.calls.length = 0;
    const odd = email("aud-odd");
    const createdOdd = await newsletter.addToResendAudience(odd);
    const oddCalls = audience.calls.map((c) => [c.method, c.email ?? c.body.email, c.body.unsubscribed]);
    check(createdOdd.ok === true && JSON.stringify(oddCalls) === JSON.stringify([["PATCH", odd, false], ["POST", odd, false]]), "...and so is one whose update Resend refuses with 422: ANY non-2xx on the update falls through to the create, not only 404", `resend 422 path: ${JSON.stringify(createdOdd)} ${JSON.stringify(oddCalls)}`);
    // Both calls fail: the confirmation stands, the owner is told once per address (both statuses, row id, no address), after the response
    audience.mode = "fail";
    audience.calls.length = 0;
    const lost = email("aud-lost");
    const lostTok = newsletter.signNewsletterToken(lost)!;
    const lostClick = await confirmRoute.POST(formReq("/api/newsletter/confirm", { token: lostTok }));
    const subNoticesAtAnswer = subscribeNotices().length;
    await settle();
    const lostRow = await prisma.newsletterSubscriber.findUnique({ where: { email: lost } });
    const lostCalls = audience.calls.map((c) => c.method);
    const s1 = subscribeNotices();
    check(lostClick.status === 200 && lostRow?.confirmedAt instanceof Date && JSON.stringify(lostCalls) === JSON.stringify(["PATCH", "POST"]) && s1.length === 1 && /Aanmelding niet doorgegeven aan Resend/.test(s1[0]) && /http_500_then_http_500/.test(s1[0]) && !!lostRow && s1[0].includes(lostRow.id) && !s1[0].includes(lost) && subNoticesAtAnswer === 0, "Both the update and the create fail (500): the confirmation stands (200, confirmedAt set) and the owner is told AFTER the response (both statuses, the row id, never the address)", `both fail: click ${lostClick.status} row ${JSON.stringify(lostRow)} calls ${JSON.stringify(lostCalls)} notices ${JSON.stringify(s1)} at answer ${subNoticesAtAnswer}`);
    const lostAgain = await confirmRoute.POST(formReq("/api/newsletter/confirm", { token: lostTok }));
    await settle();
    check(lostAgain.status === 200 && subscribeNotices().length === 1 && audience.calls.length === 4, "A second confirmation of the same address retries both calls but does not tell the owner again (once per address)", `second confirmation while down: ${lostAgain.status} notices ${subscribeNotices().length} calls ${audience.calls.length}`);
    // The dedupe is per address AND direction: the same address now opts out while Resend is still down. That is the other
    // instruction for the owner (flag the contact unsubscribed, not add it), so it is reported, once; the subscribe notice stays at one.
    const unsubBeforeLost = noticeTexts().length;
    const lostTokOut = newsletter.signNewsletterUnsubscribeToken(lost)!;
    const lostOut = await afmeldenRoute.POST(formReq("/api/newsletter/afmelden", { token: lostTokOut }));
    await settle();
    const lostOutAgain = await afmeldenRoute.POST(formReq("/api/newsletter/afmelden", { token: lostTokOut }));
    await settle();
    const n3 = noticeTexts();
    check(lostOut.status === 200 && lostOutAgain.status === 200 && n3.length === unsubBeforeLost + 1 && /Afmelding niet doorgegeven/.test(n3[n3.length - 1]) && !!lostRow && n3[n3.length - 1].includes(lostRow.id) && subscribeNotices().length === 1,
      "The same address opting out while Resend is still down is reported once more, in the OTHER direction (the owner must flag the contact, not add it); the subscribe notice is not repeated and a second opt-out click adds nothing: the dedupe is per address AND direction", `direction dedupe: opt-out ${lostOut.status}/${lostOutAgain.status} unsubscribe notices ${n3.length} (before ${unsubBeforeLost}) subscribe notices ${subscribeNotices().length}`);
    audience.mode = "ok";
    // A wrong RESEND_AUDIENCE_ID (mistyped, or the audience was recreated): Resend answers 404 for the audience path itself.
    // On a confirmation the CREATE's 404 can only mean that (a contact being created cannot be "not found"), so the owner
    // notice names the variable; on an opt-out a single 404 is silent by design, indistinguishable from "not in the
    // audience", which the docs state: the first confirmation's notice is the owner's signal.
    process.env.RESEND_AUDIENCE_ID = "aud_wrong";
    audience.calls.length = 0;
    const stray = email("aud-stray");
    const strayClick = await confirmRoute.POST(formReq("/api/newsletter/confirm", { token: newsletter.signNewsletterToken(stray)! }));
    await settle();
    const s2 = subscribeNotices();
    const unsubBeforeStray = noticeTexts().length;
    const strayOut = await afmeldenRoute.POST(formReq("/api/newsletter/afmelden", { token: newsletter.signNewsletterUnsubscribeToken(stray)! }));
    await settle();
    const strayCalls = audience.calls.map((c) => [c.method, c.path.split("/")[2]]);
    check(strayClick.status === 200 && s2.length === 2 && /http_404_then_http_404/.test(s2[1]) && /RESEND_AUDIENCE_ID/.test(s2[1]) && !/RESEND_AUDIENCE_ID/.test(s2[0]) && JSON.stringify(strayCalls) === JSON.stringify([["PATCH", "aud_wrong"], ["POST", "aud_wrong"], ["PATCH", "aud_wrong"]]) && strayOut.status === 200 && noticeTexts().length === unsubBeforeStray,
      "A wrong RESEND_AUDIENCE_ID: the confirmation's notice (http_404_then_http_404) names RESEND_AUDIENCE_ID as the thing to check (a 500 notice does not), while the opt-out's own 404 stays silent, as documented: the first confirmation is the signal", `wrong audience id: click ${strayClick.status} notices ${JSON.stringify(s2)} calls ${JSON.stringify(strayCalls)} opt-out ${strayOut.status} unsubscribe notices ${noticeTexts().length} (before ${unsubBeforeStray})`);
    process.env.RESEND_AUDIENCE_ID = "aud_qa";

    // The owner's helper (D20): every subscriber with its link as CSV, for the Resend contact property; admin only
    const csvAddr = email("csv-sub");
    const csvPending = email("csv-pending");
    await confirmedRow(csvAddr);
    await prisma.newsletterSubscriber.create({ data: { email: csvPending, source: "newsletter" } });
    signOut();
    const anonCsv = await afmeldlinksRoute.GET();
    const plainUser = await prisma.user.create({ data: { email: email("csv-user"), clerkId: clerkId(), name: "Gewone klant" } });
    createdUsers.push(plainUser.id);
    signInAs(plainUser);
    const userCsv = await afmeldlinksRoute.GET();
    signOut();
    const adminUser = await prisma.user.create({ data: { email: email("csv-admin"), clerkId: clerkId(), name: "Beheerder", role: "ADMIN" } });
    createdUsers.push(adminUser.id);
    signInAs(adminUser);
    const adminCsv = await afmeldlinksRoute.GET();
    signOut();
    const csv = await adminCsv.text();
    const csvLines = csv.split("\r\n").filter(Boolean);
    const csvRows = csvLines.slice(1).map((l) => /^"([^"]*)","([^"]*)"$/.exec(l)).map((m) => (m ? { email: m[1], url: m[2] } : null));
    const everyLinkWorks = csvRows.length > 0 && csvRows.every((r) => !!r && newsletter.verifyNewsletterUnsubscribeToken(new URL(r.url).searchParams.get("token") ?? "") === r.email && r.url.startsWith("https://shop.qa-privacy.test/api/newsletter/afmelden?token="));
    check(anonCsv.status === 403 && userCsv.status === 403 && !(await anonCsv.text()).includes("@qa-privacy.test") && !(await userCsv.text()).includes("@qa-privacy.test"), "GET /api/newsletter/afmeldlinks: 403 for a visitor and for a signed-in customer, no addresses in the answer", `afmeldlinks: anon ${anonCsv.status}, customer ${userCsv.status}`);
    check(adminCsv.status === 200 && /^text\/csv/.test(adminCsv.headers.get("content-type") ?? "") && /attachment; filename="nieuwsbrief-afmeldlinks-\d{4}-\d{2}-\d{2}\.csv"/.test(adminCsv.headers.get("content-disposition") ?? "") && adminCsv.headers.get("cache-control") === "no-store" && csvLines[0] === "email,afmeldlink", "...and for an admin a CSV download (email,afmeldlink; no-store)", `admin csv: ${adminCsv.status} ${adminCsv.headers.get("content-type")} ${adminCsv.headers.get("content-disposition")} first line ${csvLines[0]}`);
    check(csvRows.some((r) => r?.email === csvAddr && r.url === newsletter.newsletterUnsubscribeUrl(csvAddr)) && csvRows.some((r) => r?.email === oc) && !csv.includes(csvPending) && !csv.includes(addr) && !csv.includes(down) && everyLinkWorks, "The CSV lists exactly the subscribers (confirmed, not unsubscribed: the re-subscribed address is in, the unconfirmed and the unsubscribed ones are out) and every link verifies for its own address", `csv rows: ${JSON.stringify(csvRows.filter((r) => r && /csv-|oneclick|unsub/.test(r.email)))} pending in: ${csv.includes(csvPending)} unsubscribed in: ${csv.includes(addr)}`);

    // The texts people read say the same thing as the code
    const fs = await import("node:fs");
    const modalSrc = fs.readFileSync(path.join(repo, "src/components/ExitIntentModal.tsx"), "utf8");
    const privacySrc2 = fs.readFileSync(path.join(repo, "src/app/privacy/page.tsx"), "utf8");
    check(/Afmelden kan altijd via de link in elke nieuwsbrief/.test(modalSrc) && !/contactpagina/.test(modalSrc), "ExitIntentModal says opting out works through the link in every newsletter (not 'via de contactpagina')", "ExitIntentModal still points to the contact page for opting out");
    check(/Afmelden kan altijd en gratis via de afmeldlink/.test(privacySrc2) && /de afmelding gaat direct in/.test(privacySrc2) && /art\. 21 lid 3 AVG/.test(privacySrc2) && !/opzegging via unsubscribe/.test(privacySrc2), "The privacy page says how to opt out (the link in every newsletter and in the confirmation mail), that it takes effect immediately, and names art. 21(3) AVG", "privacy page does not describe the opt-out");
    const aanvragenSrc = fs.readFileSync(path.join(repo, "src/app/admin/aanvragen/page.tsx"), "utf8");
    check(/href="\/api\/newsletter\/afmeldlinks"/.test(aanvragenSrc) && /afmeldlinks als CSV/.test(aanvragenSrc) && /bevestigde nieuwsbriefabonnees/.test(aanvragenSrc), "The admin page /admin/aanvragen links to the afmeldlinks CSV next to the subscriber count (the route itself is admin-guarded: 403 above)", "admin/aanvragen does not link to /api/newsletter/afmeldlinks next to the subscriber count");

    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_AUDIENCE_ID;
    delete process.env.RESEND_BASE_URL;
    resendFake.closeAllConnections?.();
    await new Promise<void>((r) => resendFake.close(() => r()));
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
