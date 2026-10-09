/**
 * Checkout, guest access to an order, and the cart (bundle S2).
 *
 * Runs against a real Postgres (never mocked). The route handlers are called
 * in-process; Stripe is a stand-in object (no Stripe keys exist here), Slack is
 * a local HTTP server, and the scenarios that need another environment
 * (production without a database, production without a company identity, a
 * demo/member session, no Stripe) run as child processes of this same file.
 *
 *   DATABASE_URL=postgresql://... npx tsx --conditions=react-server scripts/qa-checkout.ts
 *
 * Optional, against a running server (guest = production build; admin = dev server in demo mode):
 *   QA_BASE_URL=http://localhost:3302 QA_EXPECT=guest DATABASE_URL=... npx tsx --conditions=react-server scripts/qa-checkout.ts
 *
 * Checks tagged [guard] protect behaviour that already worked and therefore ALSO pass on the code as
 * it was before this bundle; they exist so a later change cannot break it. The other checks assert
 * behaviour this bundle added or repaired. I did not run every one of them against the old code: the
 * repair round (see the report of that round) wrote the checks for its fixes first and ran them
 * against the unrepaired code before changing it.
 *
 * The HTTP section needs the same fictional COMPANY_* values in THIS process as the server has,
 * because it creates invoices in-process (the IBAN on the confirmation page comes from the invoice
 * snapshot). When they are not set the defaults below are used; the server under test must run with
 * the same values (COMPANY_NAME="WasFix Test B.V." COMPANY_STREET="Teststraat 1"
 * COMPANY_POSTAL_CODE="1011 AB" COMPANY_CITY=Amsterdam COMPANY_KVK=90000001
 * COMPANY_VAT=NL900000010B01 COMPANY_IBAN=NL02ABNA0123456789 COMPANY_EMAIL=qa@qa-checkout.test: the contact address
 * is part of readiness, decision D15, so checkout is closed without it) and, in production mode, with
 * NEXT_PUBLIC_APP_URL set to a non-local address.
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { loadPlaywright } from "./lib/browser";

// The HTTP section creates invoices in this process; without a company identity they would snapshot
// a placeholder IBAN and two checks would fail for a reason that has nothing to do with the code.
const DEFAULT_QA_COMPANY: Record<string, string> = { COMPANY_NAME: "WasFix Test B.V.", COMPANY_STREET: "Teststraat 1", COMPANY_POSTAL_CODE: "1011 AB", COMPANY_CITY: "Amsterdam", COMPANY_KVK: "90000001", COMPANY_VAT: "NL900000010B01", COMPANY_IBAN: "NL02ABNA0123456789", COMPANY_EMAIL: "qa@qa-checkout.test" };
for (const [k, v] of Object.entries(DEFAULT_QA_COMPANY)) if (!process.env[k]) process.env[k] = v;

const DOMAIN = "qa-checkout.test";
const SKU_PREFIX = "QA-CHK-";
const CHILD = process.argv.find((a) => a.startsWith("--child="))?.slice("--child=".length) ?? null;

const log: string[] = [];
const check = (cond: boolean, ok: string, bad: string = ok) => {
  const line = cond ? `✅ ${ok}` : `❌ ${bad}`;
  log.push(line);
  if (CHILD) console.log(`CHK:${line}`);
};

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl) && !CHILD) {
  console.error("Refusing to run: DATABASE_URL must point at a local test database.");
  process.exit(2);
}

// ───────────────────────────── pure checks (no database) ─────────────────────────────
async function pureChecks() {
  const schema = await import("../src/lib/cart-schema");
  const totalsLib = await import("../src/lib/cart-totals");
  const stripeLib = await import("../src/lib/cart-stripe");
  const pricing = await import("../src/lib/cart-pricing");
  const limits = await import("../src/lib/cart-limits");
  const access = await import("../src/app/bestelling/_lib/access");
  const { money } = await import("../src/lib/invoicing");

  const base = {
    email: "  Mixed.Case@Example.NL ", name: "  Piet   Jansen ", phone: " 06 1234 5678 ",
    address: { street: " hoofdstraat ", houseNumber: " 42a ", postalCode: " 1234ab ", city: " den haag " },
  };
  const ok = schema.CheckoutFormSchema.safeParse(base);
  check(
    ok.success && ok.data.email === "mixed.case@example.nl" && ok.data.address.postalCode === "1234 AB" && ok.data.address.city === "Den Haag" && ok.data.name === "Piet Jansen" && ok.data.address.country === "NL",
    "Schema: e-mail is trimmed + lower-cased, postcode becomes '1234 AB', city is tidied, name collapsed, country is NL",
    `Schema normalisation: ${JSON.stringify(ok.success ? ok.data : ok.error.issues)}`,
  );
  const bad = (over: Record<string, unknown>) => {
    const r = schema.CheckoutFormSchema.safeParse({ ...base, ...over });
    return r.success ? {} : schema.fieldErrorsOf(r.error);
  };
  check(/postcode/i.test(bad({ address: { ...base.address, postalCode: "12345" } }).postalCode ?? ""), "Schema: postcode 12345 -> a message about the postcode, on the postalCode field", "Schema: postcode error missing");
  check(/postcode/i.test(bad({ address: { ...base.address, postalCode: "2000" } }).postalCode ?? ""), "Schema: a Belgian postcode (2000) is refused with the postcode message", "Schema: BE postcode accepted");
  check(/Nederland/.test(bad({ address: { ...base.address, country: "BE" } }).country ?? ""), "Schema: country BE is refused ('alleen in Nederland'); DE too", "Schema: country BE accepted");
  check(/telefoon/i.test(bad({ phone: "" }).phone ?? "") && /telefoon/i.test(bad({ phone: "abc" }).phone ?? "") && /telefoon/i.test(bad({ phone: "123" }).phone ?? ""), "Schema: an empty, non-numeric or too short phone number is refused with a phone message", "Schema: phone not validated");
  check(/e-mail/i.test(bad({ email: "a@b" }).email ?? ""), "Schema: 'a@b' -> e-mail message", "Schema: e-mail 'a@b' accepted");
  check(/naam/i.test(bad({ name: "A" }).name ?? ""), "Schema: 1-letter name -> name message", "Schema: short name accepted");
  check(/btw/i.test(bad({ vatNumber: "12" }).vatNumber ?? ""), "Schema: btw-nummer '12' -> btw message", "Schema: bad btw accepted");
  check(schema.CheckoutFormSchema.safeParse({ ...base, vatNumber: "", customerNote: "" }).success, "Schema: blank optional fields (btw-nummer, opmerking) are fine", "Schema: blank optional field refused");
  check(schema.CheckoutFormSchema.safeParse({ ...base, vatNumber: "nl 1234.56.789 b01" }).success && schema.CheckoutFormSchema.parse({ ...base, vatNumber: "nl123456789b01" }).vatNumber === "NL123456789B01", "Schema: btw-nummer is upper-cased", "Schema: btw-nummer not normalised");
  const reqBase = { ...base, items: [{ sku: "X", quantity: 1 }], paymentMethod: "bank_transfer" };
  check(schema.CheckoutRequestSchema.safeParse(reqBase).success, "Schema: a complete request parses", "Schema: complete request refused");
  check(!schema.CheckoutRequestSchema.safeParse({ ...reqBase, paymentMethod: undefined }).success, "Schema: the payment method has no default (no silent choice)", "Schema: payment method defaulted");
  check(!schema.CheckoutRequestSchema.safeParse({ ...reqBase, items: [{ sku: "X", quantity: limits.MAX_QTY_PER_LINE + 1 }] }).success, `Schema: quantity above ${limits.MAX_QTY_PER_LINE} per line is refused (was 99)`, "Schema: oversized quantity accepted");
  check(!schema.CheckoutRequestSchema.safeParse({ ...reqBase, items: Array.from({ length: limits.MAX_LINES_PER_ORDER + 1 }, (_, i) => ({ sku: `S${i}`, quantity: 1 })) }).success, `Schema: more than ${limits.MAX_LINES_PER_ORDER} lines is refused`, "Schema: too many lines accepted");

  // A refused order must always tell the customer WHY: errors for keys that are not inputs used to be dropped.
  const split = schema.splitServerErrors;
  const capErr = "Maximaal 50 stuks per bestelling. Heb je er meer nodig? Neem contact met ons op.";
  const s1 = split?.({ items: "Te veel stuks" }, capErr);
  check(!!s1 && Object.keys(s1.fields).length === 0 && s1.form === capErr, "Server errors: an error for 'items' (too many units) has no input, so the server's sentence is shown above the button", `Server errors, items: ${JSON.stringify(s1)}`);
  const s2 = split?.({ quantity: "Maximaal 20 stuks per onderdeel" }, "Maximaal 20 stuks per onderdeel");
  check(s2?.form === "Maximaal 20 stuks per onderdeel", "Server errors: an error for 'quantity' is shown as the form message", `Server errors, quantity: ${JSON.stringify(s2)}`);
  const s3 = split?.({ postalCode: "Ongeldige postcode (bv. 1234 AB)" }, "Ongeldige postcode (bv. 1234 AB)");
  check(s3?.fields.postalCode === "Ongeldige postcode (bv. 1234 AB)" && s3.form === undefined, "[guard] Server errors: a postcode error stays under its input and adds no form message", `Server errors, postcode: ${JSON.stringify(s3)}`);
  const s4 = split?.({ postalCode: "Ongeldige postcode (bv. 1234 AB)", country: "We leveren voorlopig alleen in Nederland" }, "Ongeldige postcode (bv. 1234 AB)");
  check(s4?.fields.postalCode !== undefined && s4.form === "We leveren voorlopig alleen in Nederland", "Server errors: a field error AND a non-input error are both shown", `Server errors, mixed: ${JSON.stringify(s4)}`);
  const s5 = split?.(undefined, undefined);
  check(!!s5?.form && /niets afgeschreven/.test(s5.form), "Server errors: a 400 with no details still shows a message", `Server errors, empty: ${JSON.stringify(s5)}`);

  // cartTotals: the one arithmetic.
  const t = totalsLib.cartTotals(49.5, 0);
  check(t.shippingEur === 5.95 && t.totalEur === 55.45 && t.toFreeShippingEur === 0.5, "Totals: EUR 49,50 pays shipping 5,95 (threshold is 50,00 after discount), 0,50 short of free", `Totals at 49,50: ${JSON.stringify(t)}`);
  const t2 = totalsLib.cartTotals(50, 0);
  check(t2.shippingEur === 0 && t2.totalEur === 50 && t2.toFreeShippingEur === 0, "Totals: [guard] EUR 50,00 ships free", `Totals at 50: ${JSON.stringify(t2)}`);
  const t3 = totalsLib.cartTotals(57, 0.05);
  check(t3.discountEur === 2.85 && t3.totalEur === 54.15 && t3.shippingEur === 0, "Totals: the free-shipping threshold is applied after the member discount", `Totals 57 @5%: ${JSON.stringify(t3)}`);
  check(t.vatEur === money(55.45 * (0.21 / 1.21)), "Totals: VAT is the part contained in the total", "Totals: VAT wrong");

  // The cent-exact Stripe line items, over every quantity and discount tier (the old "3440 cart" check, re-created).
  const prices = [0.99, 6.5, 9, 10.15, 12.34, 19.95, 28.5, 33.33, 49.99, 169];
  let carts = 0;
  const miss: string[] = [];
  for (const p of prices) {
    for (let qty = 1; qty <= limits.MAX_QTY_PER_LINE; qty++) {
      for (const d of [0, 0.05, 0.1, 0.15]) {
        carts++;
        const tt = totalsLib.cartTotals(money(p * qty), d);
        const items = stripeLib.discountedLineItems([{ name: "x", sku: "s", unitCents: Math.round(p * 100), quantity: qty }], Math.round((tt.subtotalEur - tt.discountEur) * 100));
        const sum = items.reduce((n, li) => n + li.price_data.unit_amount * li.quantity, 0) + Math.round(tt.shippingEur * 100);
        if (sum !== Math.round(tt.totalEur * 100)) miss.push(`${p}x${qty}@${d}`);
      }
    }
  }
  check(miss.length === 0, `Stripe line items: the sum is cent-exact for ${carts} single-SKU carts (10 prices x qty 1..${limits.MAX_QTY_PER_LINE} x 4 tiers)`, `Stripe line items off for ${miss.length}: ${miss.slice(0, 5).join(", ")}`);
  let multi = 0;
  const multiMiss: string[] = [];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let n = 0; n < 1500; n++) {
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, i) => ({ name: `n${i}`, sku: `s${i}`, unitCents: 50 + Math.floor(rnd() * 20000), quantity: 1 + Math.floor(rnd() * 12) }));
    const d = [0, 0.05, 0.1, 0.15][Math.floor(rnd() * 4)];
    const sub = money(lines.reduce((s, l) => s + (l.unitCents / 100) * l.quantity, 0));
    const tt = totalsLib.cartTotals(sub, d);
    const items = stripeLib.discountedLineItems(lines, Math.round((tt.subtotalEur - tt.discountEur) * 100));
    multi++;
    if (items.reduce((s, li) => s + li.price_data.unit_amount * li.quantity, 0) !== Math.round((tt.subtotalEur - tt.discountEur) * 100)) multiMiss.push(String(n));
  }
  check(multiMiss.length === 0, `Stripe line items: ${multi} random multi-line carts at every tier add up to the discounted subtotal to the cent`, `Stripe line items off for ${multiMiss.length} multi-line carts`);

  // evaluateCart
  const live = (o: Partial<import("../src/lib/cart-pricing").LivePart>) => ({ id: "id", sku: "S", name: "N", brand: "B", imageUrl: null, priceEur: 10, stock: 5, isOriginal: true, costEur: 4, costSource: "ESTIMATE", ...o });
  const ev1 = pricing.evaluateCart([{ sku: "S", quantity: 2 }], [live({})], { totalEur: 25.95, lines: [{ sku: "S", unitPriceEur: 10, quantity: 2 }] });
  check(!ev1.changed && ev1.orderable.length === 1, "Evaluate: [guard] an unchanged cart is not 'changed'", "Evaluate: false positive");
  const ev2 = pricing.evaluateCart([{ sku: "S", quantity: 2 }], [live({ priceEur: 11 })], { totalEur: 25.95, lines: [{ sku: "S", unitPriceEur: 10, quantity: 2 }] });
  check(ev2.changed && ev2.lines[0].previousUnitPriceEur === 10 && ev2.lines[0].part?.priceEur === 11, "Evaluate: a changed price is flagged with the price the customer saw", "Evaluate: price change missed");
  const ev3 = pricing.evaluateCart([{ sku: "S", quantity: 9 }], [live({ stock: 3 })]);
  check(ev3.changed && ev3.lines[0].status === "reduced" && ev3.lines[0].quantity === 3, "Evaluate: quantity above stock is 'reduced' to the stock", "Evaluate: stock cap missed");
  const ev4 = pricing.evaluateCart([{ sku: "S", quantity: 1 }], [live({ stock: 0 })]);
  check(ev4.changed && ev4.lines[0].status === "sold_out" && ev4.orderable.length === 0, "Evaluate: stock 0 is 'sold_out' and not orderable", "Evaluate: sold-out missed");
  const ev5 = pricing.evaluateCart([{ sku: "GONE", quantity: 1 }], []);
  check(ev5.changed && ev5.lines[0].status === "removed", "Evaluate: an unknown SKU is 'removed'", "Evaluate: removed missed");
  const ev6 = pricing.evaluateCart([{ sku: "S", quantity: 15 }, { partId: "id", quantity: 15 }], [live({ stock: 100 })]);
  check(ev6.lines.length === 1 && ev6.lines[0].quantity === limits.MAX_QTY_PER_LINE && ev6.lines[0].status === "reduced", "Evaluate: listing a part twice cannot get around the per-line cap (merged first)", "Evaluate: duplicate lines escaped the cap");
  const pub = JSON.stringify(pricing.publicLine(ev1.lines[0]));
  check(!/cost|supplier/i.test(pub), "Public line: no cost price or supplier in what the client sees", `Public line leaks: ${pub}`);

  // Access decision (D2): token OR owner OR admin, nobody else.
  const order = { userId: "u1", accessToken: "a".repeat(48) };
  const d = access.decideOrderAccess;
  check(d(order, null, null) === null, "Access: anonymous without token -> no access", "Access: anonymous allowed");
  check(d(order, null, "b".repeat(48)) === null && d(order, null, "") === null && d(order, null, "a".repeat(47)) === null, "Access: wrong, empty and truncated token -> no access", "Access: bad token allowed");
  check(d(order, null, "a".repeat(48)) === "token", "Access: the right token -> access without a session", "Access: right token refused");
  check(d(order, { id: "u1", role: "CONSUMER" }, null) === "owner", "Access: the signed-in owner -> access without a token", "Access: owner refused");
  check(d(order, { id: "u2", role: "CONSUMER" }, null) === null && d(order, { id: "u2", role: "CONSUMER" }, "zzz") === null, "Access: another signed-in customer -> no access", "Access: stranger allowed");
  check(d(order, { id: "u9", role: "ADMIN" }, null) === "admin", "Access: an admin -> access", "Access: admin refused");
  check(d({ userId: "u1", accessToken: null }, null, "anything") === null && d({ userId: "u1", accessToken: null }, null, null) === null, "Access: an order without a token (pre-migration row) cannot be opened with any token", "Access: tokenless order opened");
  check(access.tokenFromParam(["x", "y"]) === "x" && access.tokenFromParam("x".repeat(201)) === null && access.tokenFromParam(undefined) === null, "Access: the ?t= parameter is reduced to one bounded string", "Access: tokenFromParam wrong");
}

// ───────────────────────────── in-process scenarios ─────────────────────────────
type Json = Record<string, any>;

async function inProcessScenarios(kind: "guest" | "member" | "nostripe" | "stripe-nowebhook" | "prod-noemail" | "prod-baddb" | "prod-nocompany" | "prod-dbdown" | "prod-ok" | "prod-nourl" | "prod-localurl") {
  const slackBodies: string[] = [];
  // A slow webhook is how a sweep that runs inside a customer's request shows itself.
  let slackDelayMs = 0;
  const slack = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { slackBodies.push(body); setTimeout(() => { res.statusCode = 200; res.end("ok"); }, slackDelayMs); });
  });
  await new Promise<void>((r) => slack.listen(0, "127.0.0.1", r));
  process.env.SLACK_WEBHOOK_URL = `http://127.0.0.1:${(slack.address() as AddressInfo).port}/hook`;
  delete process.env.RESEND_API_KEY;
  delete process.env.DISCORD_WEBHOOK_URL;
  delete process.env.ORDER_NOTIFY_EMAIL;

  if (kind === "guest" || kind === "nostripe" || kind === "stripe-nowebhook" || kind === "prod-noemail" || kind === "prod-ok" || kind === "prod-nocompany" || kind === "prod-dbdown" || kind === "prod-baddb" || kind === "prod-nourl" || kind === "prod-localurl") {
    // Clerk keys present and DEMO_MODE unset = not demo mode, so nobody is signed in: a guest.
    process.env.CLERK_SECRET_KEY = "sk_test_qa";
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_qa";
    delete process.env.DEMO_MODE;
  }
  if (kind === "member") process.env.DEMO_MODE = "true";
  // Stripe is offered only with BOTH keys (stripeCheckoutAvailable, rehearsal R2-04); "stripe-nowebhook" has just the secret key.
  if (kind === "nostripe") { delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_WEBHOOK_SECRET; }
  else if (kind === "stripe-nowebhook") { process.env.STRIPE_SECRET_KEY = "sk_test_qa_fake"; delete process.env.STRIPE_WEBHOOK_SECRET; }
  else { process.env.STRIPE_SECRET_KEY = "sk_test_qa_fake"; process.env.STRIPE_WEBHOOK_SECRET = "whsec_qa_fake"; }

  const company = { COMPANY_NAME: "WasFix Test B.V.", COMPANY_STREET: "Teststraat 1", COMPANY_POSTAL_CODE: "1011 AB", COMPANY_CITY: "Amsterdam", COMPANY_KVK: "90000001", COMPANY_VAT: "NL900000010B01", COMPANY_IBAN: "NL02ABNA0123456789", COMPANY_EMAIL: "qa@qa-checkout.test" };
  if (kind === "prod-nocompany" || kind === "prod-baddb") for (const k of Object.keys(company)) delete process.env[k];
  else if (kind === "prod-noemail") { Object.assign(process.env, company); delete process.env.COMPANY_EMAIL; }
  else Object.assign(process.env, company);

  const { PrismaClient } = await import("@prisma/client");
  // The harness reads the real test database even when the route under test is pointed at a broken one.
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.QA_REAL_DATABASE_URL ?? process.env.DATABASE_URL } } });
  const { NextRequest } = await import("next/server");
  const route = await import("../src/app/api/checkout/route");
  const validate = await import("../src/app/api/cart/validate/route");
  const inv = await import("../src/lib/invoicing");
  const expiry = await import("../src/lib/cart-expiry");
  const limits = await import("../src/lib/cart-limits");
  const { getStripe } = await import("../src/lib/stripe");

  let ipCounter = 0;
  const freshIp = () => `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${++ipCounter & 255}`;
  let mailCounter = 0;
  const freshEmail = (tag = "buyer") => `${tag}${++mailCounter}.${Date.now().toString(36)}@${DOMAIN}`;
  let skuCounter = 0;
  const mkPart = (stock: number, price = 10.15, extra: Record<string, unknown> = {}) =>
    prisma.part.create({ data: { sku: `${SKU_PREFIX}${Date.now().toString(36)}-${++skuCounter}`, name: `QA onderdeel ${skuCounter}`, brand: "QA", category: "OTHER", priceEur: price, costEur: price / 2, stock, ...extra } });

  // An order written straight into the test database: a reservation somebody else holds, an expired
  // invoice, an abandoned Stripe attempt. `registered` gives its owner a Clerk id (an account, not a guest).
  const mkOpenOrder = async (totalEur: number, o: { registered?: boolean; status?: string; stripe?: boolean; ageHours?: number; dueInDays?: number; partId?: string; userId?: string; email?: string } = {}) => {
    const user = o.userId
      ? await prisma.user.findUniqueOrThrow({ where: { id: o.userId } })
      : await prisma.user.create({ data: { email: o.email ?? freshEmail("filler"), name: "Filler", ...(o.registered ? { clerkId: `user_qa_${Date.now()}_${++mailCounter}` } : {}) } });
    const vat = inv.splitVatInclusive(totalEur);
    const bank = !o.stripe;
    return prisma.order.create({
      data: {
        userId: user.id, email: o.userId ? freshEmail("owned") : user.email, status: o.status ?? (bank ? "OPENSTAAND" : "PENDING"), paymentMethod: bank ? "BANK_TRANSFER" : "STRIPE",
        subtotalEur: totalEur, shippingEur: 0, totalEur, vatRate: vat.vatRate, vatEur: vat.vatEur, accessToken: inv.newAccessToken(), phone: "06 12345678",
        dueAt: bank ? new Date(Date.now() + (o.dueInDays ?? 14) * 86400000) : null,
        ...(o.ageHours ? { createdAt: new Date(Date.now() - o.ageHours * 3600000) } : {}),
        shippingAddress: JSON.stringify({ name: "Piet Jansen", street: "Teststraat", houseNumber: "1", postalCode: "1011 AB", city: "Amsterdam", country: "NL" }),
        ...(o.partId ? { items: { create: [{ partId: o.partId, quantity: 1, unitPrice: totalEur }] } } : {}),
      },
    });
  };
  // The reservations of earlier checks would otherwise eat the shared pools these checks measure.
  const resetOpenReservations = () => prisma.order.updateMany({ where: { email: { endsWith: `@${DOMAIN}` }, status: "OPENSTAAND" }, data: { status: "CANCELLED" } });

  const body = (over: Json = {}): Json => ({
    email: freshEmail(), name: "Piet Jansen", phone: "06 12345678", paymentMethod: "bank_transfer",
    address: { street: "Teststraat", houseNumber: "1", postalCode: "1011 AB", city: "Amsterdam" }, ...over,
  });
  const call = async (b: Json, o: { ip?: string; key?: string | null } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", "x-vercel-forwarded-for": o.ip ?? freshIp() };
    if (o.key) headers["idempotency-key"] = o.key;
    const res = await route.POST(new NextRequest("http://localhost/api/checkout", { method: "POST", headers, body: JSON.stringify(b) }));
    const json = (await res.json().catch(() => ({}))) as Json;
    return { status: res.status, json };
  };
  const callValidate = async (b: Json) => {
    const res = await validate.POST(new NextRequest("http://localhost/api/cart/validate", { method: "POST", headers: { "content-type": "application/json", "x-vercel-forwarded-for": freshIp() }, body: JSON.stringify(b) }));
    return { status: res.status, text: await res.text() };
  };
  const key = () => `qa${Math.random().toString(36).slice(2)}${Date.now().toString(36)}abcdef`;

  const counts = async (emailLike?: string) => ({
    orders: await prisma.order.count({ where: emailLike ? { email: { contains: emailLike } } : { email: { endsWith: `@${DOMAIN}` } } }),
    invoices: await prisma.invoice.count({ where: { order: { email: { endsWith: `@${DOMAIN}` } } } }),
  });
  const stockOf = async (id: string) => (await prisma.part.findUniqueOrThrow({ where: { id } })).stock;
  const invoiceSeq = async () => (await prisma.invoiceSequence.findMany()).reduce((n, r) => n + r.last, 0);
  const slackTexts = () => slackBodies.map((b) => { try { return String(JSON.parse(b).text); } catch { return b; } });
  const settle = () => new Promise((r) => setTimeout(r, 300));

  const cleanup = async () => {
    const orders = await prisma.order.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { id: true } });
    const ids = orders.map((o) => o.id);
    await prisma.creditNote.deleteMany({ where: { invoice: { orderId: { in: ids } } } });
    await prisma.invoice.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { id: { in: ids } } });
    await prisma.part.deleteMany({ where: { sku: { startsWith: SKU_PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await prisma.user.deleteMany({ where: { email: "gastbestellingen@guest.invalid", orders: { none: {} } } });
    // This is a test database: rewind the sequences to what really exists, as if the test invoices had never been issued.
    for (const { year } of await prisma.invoiceSequence.findMany()) {
      const rows = await prisma.invoice.findMany({ where: { year }, select: { number: true } });
      const max = rows.reduce((m, r) => Math.max(m, Number(r.number.slice(-5))), 0);
      await prisma.invoiceSequence.update({ where: { year }, data: { last: max } });
    }
    for (const { year } of await prisma.creditNoteSequence.findMany()) {
      if (year === 2999) continue;
      const rows = await prisma.creditNote.findMany({ where: { year }, select: { number: true } });
      const max = rows.reduce((m, r) => Math.max(m, Number(r.number.slice(-5))), 0);
      await prisma.creditNoteSequence.update({ where: { year }, data: { last: max } });
    }
  };

  // Stripe stand-in
  const stripeCalls: { params: Json; opts: Json }[] = [];
  let stripeMode: "ok" | "fail" = "ok";
  const stripe = getStripe();
  if (stripe) {
    let n = 0;
    (stripe.checkout.sessions as any).create = async (params: Json, opts: Json) => {
      stripeCalls.push({ params, opts });
      if (stripeMode === "fail") throw Object.assign(new Error("connect ECONNREFUSED secret-detail"), { type: "StripeConnectionError", code: "econnrefused" });
      n++;
      return { id: `cs_test_${Date.now()}_${n}`, url: `https://checkout.stripe.test/c/${n}`, status: "open" };
    };
    (stripe.checkout.sessions as any).retrieve = async (id: string) => ({ id, status: "open", url: `https://checkout.stripe.test/c/retrieved-${id}` });
  }

  /** The four ways a bank-transfer order is refused for volume; what each tells the customer depends on whether Stripe is on. */
  const capScenarios = async () => {
    await resetOpenReservations();
    const cheap = await mkPart(200, 5);
    const email = freshEmail("capw");
    for (let i = 0; i < 2; i++) await call(body({ email, items: [{ sku: cheap.sku, quantity: 1 }] }));
    const address = await call(body({ email, items: [{ sku: cheap.sku, quantity: 1 }] }));
    const dear = await mkPart(50, 300);
    const value = await call(body({ items: [{ sku: dear.sku, quantity: 2 }] }));
    const ip = freshIp();
    // The daily allowance per address is 10 (D17) while the hourly one for any order is also 10: use 7 places up through the route's own counter.
    const { rateLimit: spend } = await import("../src/lib/ratelimit");
    for (let i = 0; i < limits.MAX_BANK_TRANSFER_ORDERS_PER_IP_PER_DAY - 3; i++) await spend(`checkout-bank-ip:${ip}`, limits.MAX_BANK_TRANSFER_ORDERS_PER_IP_PER_DAY, 24 * 60 * 60 * 1000);
    for (let i = 0; i < 3; i++) await call(body({ items: [{ sku: cheap.sku, quantity: 1 }] }), { ip });
    const ipRes = await call(body({ items: [{ sku: cheap.sku, quantity: 1 }] }), { ip });
    const filler = await mkOpenOrder(2990, { registered: true });
    const pool = await call(body({ items: [{ sku: cheap.sku, quantity: 1 }] }));
    await prisma.order.delete({ where: { id: filler.id } });
    return { address, value, ip: ipRes, pool };
  };

  try {
    await cleanup();

    // ─────────────────────────── production fail-closed child scenarios ───────────────────────────
    if (kind === "prod-baddb" || kind === "prod-dbdown" || kind === "prod-nocompany" || kind === "prod-noemail" || kind === "prod-nourl" || kind === "prod-localurl") {
      const part = kind === "prod-nocompany" || kind === "prod-noemail" || kind === "prod-nourl" || kind === "prod-localurl" ? await mkPart(5, 12) : null;
      const before = await counts();
      const r = await call(body({ items: [{ sku: part?.sku ?? "WF-PUMP-01", quantity: 1 }], paymentMethod: "bank_transfer" }));
      const r2 = await call(body({ items: [{ sku: part?.sku ?? "WF-PUMP-01", quantity: 1 }], paymentMethod: "stripe" }));
      const text = JSON.stringify(r.json) + JSON.stringify(r2.json);
      check(r.status === 503 && r2.status === 503, `[${kind}] production: POST /api/checkout answers 503 for bank transfer and for Stripe`, `[${kind}] production answered ${r.status} / ${r2.status}: ${text.slice(0, 200)}`);
      check(!/demo/i.test(text) && !/bedankt/i.test(text) && !r.json.orderId, `[${kind}] production: the answer carries no orderId, no 'demo', no 'bedankt'`, `[${kind}] production: answer looks like success: ${text.slice(0, 200)}`);
      check(/niet mogelijk/i.test(String(r.json.error)) && !/DATABASE|COMPANY|IBAN|KvK|env/i.test(String(r.json.error)), `[${kind}] the message tells the customer nothing about the configuration`, `[${kind}] message leaks configuration: ${r.json.error}`);
      if (kind === "prod-nocompany" || kind === "prod-noemail" || kind === "prod-nourl" || kind === "prod-localurl") {
        const after = await counts();
        check(after.orders === before.orders && after.invoices === before.invoices && (await stockOf(part!.id)) === 5, `[${kind}] no order, no invoice and no stock change were made`, `[${kind}] something was written`);
      }
      await settle();
      check(slackTexts().some((t) => /checkout blocked|Fout/i.test(t)), `[${kind}] the owner was notified`, `[${kind}] the owner heard nothing: ${slackTexts().join(" | ").slice(0, 200)}`);
      // The page gate: same decision before the customer fills the form.
      const gate = await import("../src/lib/cart-gate");
      const g = gate.checkoutBlockedReason();
      // The page gate knows about configuration, not about a database that is configured but down: that case is the 503 above.
      const wantCode = kind === "prod-nocompany" || kind === "prod-noemail" ? "company" : kind === "prod-nourl" || kind === "prod-localurl" ? "app_url" : "database";
      check(kind === "prod-dbdown" ? g === null : g !== null && g.code === wantCode && g.missing.length > 0, `[${kind}] checkoutBlockedReason() (used by the /checkout page): ${g ? `${g.code} (${g.missing.join(",")})` : "null: configured, the outage is caught by the 503 above"}`, `[${kind}] page gate wrong: ${JSON.stringify(g)}`);
      if (kind === "prod-noemail") {
        // Decision D15 / rehearsal D1+R2-05: all seven fiscal fields are fine, only the contact address is missing. Before: checkout was OPEN and invoices said support@wasfix.nl.
        check(g?.missing.join() === "email", "[prod-noemail] the gate names exactly the missing field ('email'), never a value", `[prod-noemail] gate: ${JSON.stringify(g)}`);
        const { companyReadiness: readiness } = await import("../src/lib/plans");
        const { COMPANY: co } = await import("../src/lib/plans");
        check(readiness().ready === false && co.email === "" && !/support@wasfix\.nl/.test(JSON.stringify(co)), "[prod-noemail] COMPANY.email is empty, not the old built-in support@wasfix.nl (and not ready)", `[prod-noemail] COMPANY.email: ${JSON.stringify(co.email)}`);
      }
      if (kind === "prod-nourl" || kind === "prod-localurl") {
        check(!/localhost|NEXT_PUBLIC|APP_URL/i.test(JSON.stringify(r.json)), `[${kind}] the customer is told nothing about the address configuration`, `[${kind}] message leaks the configuration: ${JSON.stringify(r.json)}`);
      }
      return;
    }

    if (kind === "prod-ok") {
      const part = await mkPart(5, 12);
      const r = await call(body({ items: [{ sku: part.sku, quantity: 1 }] }));
      check(r.status === 200 && !!r.json.orderId && !r.json.demo, "[prod-ok] production with a ready company identity and a database: a real order, not a demo", `[prod-ok] production order: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
      const gate = await import("../src/lib/cart-gate");
      check(gate.checkoutBlockedReason() === null, "[prod-ok] checkoutBlockedReason() is null when everything (database, company, public NEXT_PUBLIC_APP_URL) is configured", "[prod-ok] gate blocks a ready deployment");
      await settle();
      const warn = slackTexts().filter((t) => /Bedrijfsgegevens zien er niet echt uit/.test(t));
      check(warn.length === 1, "[prod-ok] the company identity has test numbers: the owner got the one warning (warnAboutUnrealCompany)", `[prod-ok] expected one 'niet echt' warning, got ${warn.length}`);
      return;
    }

    if (kind === "stripe-nowebhook") {
      // R2-04: STRIPE_SECRET_KEY without STRIPE_WEBHOOK_SECRET. Every payment would succeed at Stripe while the webhook answers 503 and
      // the order stays PENDING until the daily reconcile: so iDEAL/kaart is not offered and not accepted.
      const gate = await import("../src/lib/cart-gate");
      const part = await mkPart(5, 12);
      const before = await counts();
      const r = await call(body({ items: [{ sku: part.sku, quantity: 1 }], paymentMethod: "stripe" }));
      const after = await counts();
      check(gate.stripeCheckoutAvailable() === false && r.status === 400 && r.json.code === "payment_method_unavailable" && after.orders === before.orders && stripeCalls.length === 0 && (await stockOf(part.id)) === 5, "[stripe-nowebhook] secret key but no webhook secret: Stripe is refused (payment_method_unavailable), no order, no Stripe session created", `[stripe-nowebhook] ${r.status} ${JSON.stringify(r.json).slice(0, 160)} available=${gate.stripeCheckoutAvailable()} stripe calls ${stripeCalls.length}`);
      const ok = await call(body({ items: [{ sku: part.sku, quantity: 1 }], paymentMethod: "bank_transfer" }));
      check(ok.status === 200 && ok.json.paymentMethod === "bank_transfer", "[stripe-nowebhook] [guard] bank transfer still works", `[stripe-nowebhook] bank transfer: ${ok.status}`);
      // The cap refusal must not point at a method that is not offered.
      const caps = await capScenarios();
      check(caps.address.status === 429 && !/iDEAL|kaart/i.test(String(caps.address.json.error)), "[stripe-nowebhook] a cap refusal does not send the customer to iDEAL/kaart (it is not offered)", `[stripe-nowebhook] cap message: ${caps.address.json.error}`);
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_qa_fake";
      const env = (await import("../src/lib/env")).env as unknown as Record<string, string | undefined>;
      env.STRIPE_WEBHOOK_SECRET = "whsec_qa_fake";
      check(gate.stripeCheckoutAvailable() === true, "[stripe-nowebhook] with both keys the same gate says Stripe is available", "[stripe-nowebhook] gate still false with both keys");
      return;
    }

    if (kind === "nostripe") {
      const part = await mkPart(5, 12);
      const before = await counts();
      const r = await call(body({ items: [{ sku: part.sku, quantity: 1 }], paymentMethod: "stripe" }));
      const after = await counts();
      check(r.status === 400 && r.json.code === "payment_method_unavailable" && after.orders === before.orders && after.invoices === before.invoices && (await stockOf(part.id)) === 5, "[nostripe] Stripe chosen but not configured: refused with a message; NO silent switch to bank transfer (no order, no invoice, no reservation)", `[nostripe] ${r.status} ${JSON.stringify(r.json).slice(0, 200)} orders ${before.orders}->${after.orders}`);
      const ok = await call(body({ items: [{ sku: part.sku, quantity: 1 }], paymentMethod: "bank_transfer" }));
      check(ok.status === 200 && ok.json.paymentMethod === "bank_transfer", "[nostripe] [guard] bank transfer still works when Stripe is not configured", `[nostripe] bank transfer: ${ok.status}`);
      const noMethod = await call(body({ items: [{ sku: part.sku, quantity: 1 }], paymentMethod: undefined }));
      check(noMethod.status === 400 && /betaalmethode/i.test(String(noMethod.json.error)), "[nostripe] a request without a payment method is refused (there is no default that could fall back)", `[nostripe] missing method: ${noMethod.status} ${noMethod.json.error}`);
      // Until Stripe is live bank transfer is the ONLY method: a refusal must not send the customer to one that does not exist.
      const caps = await capScenarios();
      for (const [label, r, code] of [["per address", caps.address, "bank_transfer_limit_orders"], ["value", caps.value, "bank_transfer_limit_value"], ["per network", caps.ip, "bank_transfer_limit_ip"], ["global pool", caps.pool, "bank_transfer_unavailable"]] as const) {
        const msg = String(r.json.error);
        check(r.status === 429 && r.json.code === code && !/iDEAL|kaart/i.test(msg) && /account|contact|later|morgen|betaal die eerst/i.test(msg), `[nostripe] cap refusal (${label}) names no payment method that is not offered, and gives a way out: "${msg.slice(0, 110)}"`, `[nostripe] cap refusal (${label}): ${r.status} ${r.json.code} "${msg}"`);
      }
      return;
    }

    // ─────────────────────────── member (demo session = signed in) ───────────────────────────
    if (kind === "member") {
      const user = await prisma.user.findUnique({ where: { email: "jdahoe@hotmail.nl" } });
      check(!!user && user.plan === "BEDRIJF", "[member] the demo session is the seeded BEDRIJF account (15% discount)", "[member] no demo user");
      const parts = await Promise.all([mkPart(100, 28.5), mkPart(100, 9.95), mkPart(100, 169)]);
      // Stripe: the session must charge exactly the discounted order total, to the cent.
      let exact = 0;
      const wrong: string[] = [];
      const cases: [number, number, number][] = [[7, 0, 0], [3, 0, 1], [1, 5, 2], [2, 2, 2], [20, 13, 1], [11, 7, 4]];
      for (const [a, b, c] of cases) {
        const items = [{ sku: parts[0].sku, quantity: a || 1 }, ...(b ? [{ sku: parts[1].sku, quantity: b }] : []), ...(c ? [{ sku: parts[2].sku, quantity: c }] : [])];
        const sub = inv.money(items.reduce((s, i) => s + (parts.find((p) => p.sku === i.sku)!.priceEur) * i.quantity, 0));
        const dsc = inv.money(sub * 0.15);
        const expectedTotal = inv.money(sub - dsc + (sub - dsc >= 50 ? 0 : 5.95));
        stripeCalls.length = 0;
        const r = await call(body({ items, paymentMethod: "stripe", expected: { totalEur: expectedTotal } }));
        const li = stripeCalls[0]?.params.line_items as { price_data: { unit_amount: number }; quantity: number }[] | undefined;
        const charged = li ? li.reduce((s, x) => s + x.price_data.unit_amount * x.quantity, 0) : -1;
        const order = r.json.orderId ? await prisma.order.findUnique({ where: { id: r.json.orderId } }) : null;
        if (r.status === 200 && charged === Math.round(expectedTotal * 100) && order && Math.round(order.totalEur * 100) === charged && order.discountEur === dsc) exact++;
        else wrong.push(`${JSON.stringify(items.map((i) => i.quantity))}: ${r.status} charged ${charged} expected ${Math.round(expectedTotal * 100)} ${JSON.stringify(r.json).slice(0, 80)}`);
      }
      check(exact === cases.length, `[member] Stripe session at 15% member discount: line items = order total = expected total to the cent (${exact}/${cases.length} carts)`, `[member] cents differ: ${wrong.join(" ; ")}`);

      // Member limits are higher than guest limits: 3 open bank-transfer orders pass where a guest gets 2.
      const email = freshEmail("member");
      const results: number[] = [];
      for (let i = 0; i < 4; i++) results.push((await call(body({ email, items: [{ sku: parts[1].sku, quantity: 1 }] }))).status);
      check(results.slice(0, 3).every((s) => s === 200), `[member] [guard] a signed-in account may hold more than 2 open bank-transfer orders (results ${results.join(",")})`, `[member] member limited like a guest: ${results.join(",")}`);

      // The discount that disappeared (client expected a member price, the order is placed as a different state): 409 with partsDiscount.
      const stale = await call(body({ items: [{ sku: parts[1].sku, quantity: 1 }], expected: { totalEur: 9.95 } }));
      check(stale.status === 409 && stale.json.code === "cart_changed" && stale.json.partsDiscount === 0.15 && stale.json.totals?.discountEur === 1.49, "[member] an expected total without the member discount is refused with 409 and the server's discount rate and totals", `[member] discount 409: ${stale.status} ${JSON.stringify(stale.json).slice(0, 200)}`);

      // Members have a higher limit, not none: a hard ceiling over ALL open reservations (throw-away accounts cannot get around it).
      await prisma.order.updateMany({ where: { email: { endsWith: `@${DOMAIN}` }, status: "OPENSTAAND" }, data: { status: "CANCELLED" } });
      const ceilingEur: number = (limits as unknown as { MAX_OPEN_BANK_TRANSFER_VALUE_EUR?: number }).MAX_OPEN_BANK_TRANSFER_VALUE_EUR ?? 10000;
      const room = await call(body({ items: [{ sku: parts[1].sku, quantity: 1 }] }));
      check(room.status === 200, "[member] [guard] below the ceiling a member's bank-transfer order is accepted", `[member] below the ceiling: ${room.status} ${JSON.stringify(room.json).slice(0, 120)}`);
      const filler = await mkOpenOrder(ceilingEur - 10, { registered: true });
      const over = await call(body({ items: [{ sku: parts[1].sku, quantity: 1 }] }));
      check(over.status === 429 && over.json.code === "bank_transfer_unavailable", `[member] with EUR ${(ceilingEur - 10).toFixed(0)} open under other accounts a member order is refused by the ceiling of EUR ${ceilingEur} (${over.status} ${over.json.code}); members were not checked at all`, `[member] ceiling not enforced: ${over.status} ${JSON.stringify(over.json).slice(0, 150)}`);
      await prisma.order.delete({ where: { id: filler.id } });

      // The access decision for a signed-in NON-admin owner, through the real session lookup (demo session), not just the pure function.
      const access = await import("../src/app/bestelling/_lib/access");
      const me = await prisma.user.findUniqueOrThrow({ where: { email: "jdahoe@hotmail.nl" } });
      const mine = await mkOpenOrder(40, { userId: me.id });
      const theirs = await mkOpenOrder(40, {});
      try {
        await prisma.user.update({ where: { id: me.id }, data: { role: "CONSUMER" } });
        const [own, own2, foreign, foreignTok] = [await access.loadOrderForViewer(mine.id, null), await access.loadOrderForViewer(mine.id, "x".repeat(48)), await access.loadOrderForViewer(theirs.id, null), await access.loadOrderForViewer(theirs.id, theirs.accessToken)];
        check(own?.via === "owner" && own2?.via === "owner" && foreign === null && foreignTok?.via === "token", "[member] [guard] access, signed in as a NON-admin (through the real session lookup, not only the pure function): own order -> owner (also with a wrong token), someone else's order -> 404, someone else's order WITH its token -> token", `[member] non-admin access: own ${own?.via} / ${own2?.via}, foreign ${foreign?.via}, foreign+token ${foreignTok?.via}`);
        await prisma.user.update({ where: { id: me.id }, data: { role: "ADMIN" } });
        const asAdmin = await access.loadOrderForViewer(theirs.id, null);
        check(asAdmin?.via === "admin", "[member] access, signed in as an admin: someone else's order -> admin", `[member] admin access: ${asAdmin?.via}`);
      } finally {
        await prisma.user.update({ where: { id: me.id }, data: { role: "ADMIN" } });
      }
      return;
    }

    // ─────────────────────────── guest scenarios ───────────────────────────
    const stripeEnabled = !!stripe;
    const beforeSeq = await invoiceSeq();

    // G1 happy path, bank transfer
    {
      const part = await mkPart(10, 28.5);
      const email = freshEmail("Mixed.Case");
      const key1 = key();
      const r = await call(body({ email: email.toUpperCase().replace("@QA-CHECKOUT.TEST", "@QA-CHECKOUT.TEST"), items: [{ sku: part.sku, quantity: 2 }], expected: { totalEur: 57, lines: [{ sku: part.sku, unitPriceEur: 28.5, quantity: 2 }] }, customerNote: "  bel aan bij de buren " }), { key: key1 });
      const order = r.json.orderId ? await prisma.order.findUnique({ where: { id: r.json.orderId }, include: { invoice: true, items: true } }) : null;
      check(r.status === 200 && r.json.paymentMethod === "bank_transfer" && !!order, `Bank transfer: 200 with an order (${r.status})`, `Bank transfer failed: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
      if (order) {
        check(order.status === "OPENSTAAND" && order.paymentMethod === "BANK_TRANSFER" && order.totalEur === 57 && (order.dueAt?.getTime() ?? 0) > Date.now() + 13 * 86400000, "Bank transfer: OPENSTAAND, total 57,00 (2 x 28,50, free shipping from 50,00), due in 14 days", `Bank transfer fields: ${order.status} ${order.totalEur} ${order.dueAt}`);
        check(!!order.invoice && r.json.invoiceNumber === order.invoice.number, `Bank transfer: the invoice (${order.invoice?.number}) was issued with the order and is in the answer`, "Bank transfer: invoice missing");
        check(typeof order.accessToken === "string" && /^[0-9a-f]{48}$/.test(order.accessToken), "Bank transfer: the order has a 48-hex access token", `Bank transfer: access token ${order.accessToken}`);
        check(r.json.redirectUrl === `/bestelling/${order.id}?t=${order.accessToken}&success=1`, "Bank transfer: the answer redirects to the tokenised confirmation page (relative URL, no mail claim without a sent mail)", `Bank transfer redirect: ${String(r.json.redirectUrl).replace(order.accessToken ?? "", "<token>")}`);
        check(r.json.emailSent === false && !String(r.json.redirectUrl).includes("&m=1"), "Bank transfer: with no RESEND_API_KEY the e-mail is reported as NOT sent and the redirect carries no 'mail sent' flag", `Bank transfer mail flag: ${r.json.emailSent} ${r.json.redirectUrl}`);
        check(order.phone === "06 12345678" && order.customerNote === "bel aan bij de buren", "Bank transfer: phone and the (trimmed) delivery note are stored", `Bank transfer phone/note: ${order.phone} / ${order.customerNote}`);
        check(order.idempotencyKey !== null && order.idempotencyKey !== key1 && /^[0-9a-f]{64}$/.test(order.idempotencyKey ?? ""), "Bank transfer: the idempotency key is stored as a hash, not as the client's value", "Bank transfer: raw idempotency key stored");
        check((await stockOf(part.id)) === 8, "Bank transfer: the 2 units are reserved (stock 10 -> 8)", `Bank transfer stock: ${await stockOf(part.id)}`);
        check(order.email === email.toLowerCase(), "Bank transfer: the e-mail on the order is lower-case", `Bank transfer e-mail: ${order.email}`);
        const addr = JSON.parse(order.shippingAddress);
        check(addr.postalCode === "1011 AB" && addr.country === "NL", "Bank transfer: address stored normalised with country NL", `Address: ${order.shippingAddress}`);
        await settle();
        const notice = slackTexts().filter((t) => t.includes(order.id.slice(0, 8).toUpperCase()));
        check(notice.length >= 1 && notice.every((t) => !t.includes(email.toLowerCase()) && !/Piet|Teststraat|06 12345678/i.test(t)), "Owner notice 'order placed' sent, with no customer name, address, phone or e-mail", `Owner notice: ${notice.length} ${notice.join("|").slice(0, 200)}`);
        check(notice.some((t) => /57[.,]00/.test(t)), "Owner notice carries the total", "Owner notice lacks the total");
      }
    }

    // G1b D8: Order.costEur only from QUOTE costs; an estimate must not turn into a booked margin
    {
      const quote = await mkPart(10, 20, { costEur: 8, costSource: "QUOTE" });
      const estimate = await mkPart(10, 20, { costEur: 10, costSource: "ESTIMATE" });
      const q = await call(body({ items: [{ sku: quote.sku, quantity: 2 }] }));
      const e = await call(body({ items: [{ sku: estimate.sku, quantity: 1 }] }));
      const m = await call(body({ items: [{ sku: quote.sku, quantity: 1 }, { sku: estimate.sku, quantity: 1 }] }));
      const cost = async (r: { json: Json }) => (r.json.orderId ? (await prisma.order.findUniqueOrThrow({ where: { id: r.json.orderId } })).costEur : "no order");
      const [cq, ce, cm] = [await cost(q), await cost(e), await cost(m)];
      check(cq === 16, "[guard] Cost provenance (D8): an order of QUOTE-priced parts snapshots its cost (2 x 8,00 = 16,00)", `Cost of a QUOTE order: ${cq}`);
      check(ce === null && cm === null, "Cost provenance (D8): an order with any ESTIMATE cost stores NO cost (the admin margin tile must not book an invented margin)", `Cost of an ESTIMATE / mixed order: ${ce} / ${cm}`);
    }

    // G2 atomicity: an invoice that cannot be issued rolls back order, stock AND the invoice number
    {
      const part = await mkPart(4, 12);
      await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION qa_fail_invoice() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'qa: invoice insert refused'; END; $$ LANGUAGE plpgsql`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER qa_fail_invoice BEFORE INSERT ON "Invoice" FOR EACH ROW EXECUTE FUNCTION qa_fail_invoice()`);
      const seqBefore = await invoiceSeq();
      const email = freshEmail("atomic");
      let r;
      try {
        r = await call(body({ email, items: [{ sku: part.sku, quantity: 3 }] }));
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS qa_fail_invoice ON "Invoice"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS qa_fail_invoice()`);
      }
      const rows = await prisma.order.count({ where: { email } });
      check(r.status === 503 && r.json.code === "not_stored" && !r.json.orderId && /niets besteld/i.test(String(r.json.error)), "Invoice failure: 503 'niets besteld', no order id in the answer", `Invoice failure answer: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
      check(rows === 0 && (await stockOf(part.id)) === 4 && (await invoiceSeq()) === seqBefore, "Invoice failure: no order row, stock untouched, invoice number not burned (order + stock + invoice are one transaction)", `Invoice failure left traces: orders ${rows}, stock ${await stockOf(part.id)}, seq ${seqBefore}->${await invoiceSeq()}`);
    }

    // G3 Stripe path
    if (stripeEnabled) {
      const part = await mkPart(10, 28.5);
      stripeCalls.length = 0;
      const email = freshEmail("stripe");
      const key1 = key();
      const r = await call(body({ email, items: [{ sku: part.sku, quantity: 7 }], paymentMethod: "stripe", expected: { totalEur: 199.5 } }), { key: key1 });
      const order = r.json.orderId ? await prisma.order.findUnique({ where: { id: r.json.orderId }, include: { invoice: true } }) : null;
      const call0 = stripeCalls[0];
      check(r.status === 200 && r.json.checkoutUrl?.startsWith("https://checkout.stripe.test/") && order?.status === "PENDING", "Stripe: 200 with the payment URL; the order is PENDING", `Stripe path: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
      check(!!order && order.invoice === null && (await stockOf(part.id)) === 10, "Stripe: no invoice yet and no stock taken (the webhook does that on payment)", "Stripe: invoice or stock changed at order creation");
      check(JSON.stringify(call0?.params.payment_method_types) === JSON.stringify(["card", "ideal"]), "Stripe: payment_method_types is exactly [card, ideal] (no Bancontact)", `Stripe methods: ${JSON.stringify(call0?.params.payment_method_types)}`);
      check(!!order && call0?.params.success_url === `${(await import("../src/lib/env")).env.APP_URL}/bestelling/${order.id}?t=${order.accessToken}&success=1` && call0.params.cancel_url.endsWith("/checkout"), "Stripe: success_url is the tokenised confirmation page", `Stripe success_url: ${String(call0?.params.success_url).replace(order?.accessToken ?? "~", "<token>")}`);
      check(JSON.stringify(Object.keys(call0?.params.metadata ?? {})) === JSON.stringify(["orderId"]) && call0?.params.metadata.orderId === order?.id && call0?.opts.idempotencyKey === `checkout-${order?.id}`, "Stripe: metadata keys unchanged (orderId, refVisitorId only when known) and the Stripe idempotency key is per order", `Stripe metadata: ${JSON.stringify(call0?.params.metadata)}`);
      const li = call0?.params.line_items as { price_data: { unit_amount: number }; quantity: number }[];
      const charged = li.reduce((s, x) => s + x.price_data.unit_amount * x.quantity, 0);
      check(charged === 19950 && order?.totalEur === 199.5, `Stripe: line items add up to the order total to the cent (${charged} = 19950; 7 x 28,50 ships free)`, `Stripe cents: ${charged}`);
      check(!!order?.stripePaymentId?.startsWith("cs_test_"), "Stripe: the session id is stored on the order", "Stripe: session id not stored");
      // replay of a Stripe order gives the same order and a payment URL again, and creates no second order
      stripeCalls.length = 0;
      const again = await call(body({ email, items: [{ sku: part.sku, quantity: 7 }], paymentMethod: "stripe" }), { key: key1 });
      check(again.status === 200 && again.json.orderId === order?.id && again.json.replayed === true && String(again.json.checkoutUrl).includes("retrieved-") && stripeCalls.length === 0 && (await prisma.order.count({ where: { email } })) === 1, "Stripe replay: same order, the open session's URL, no second Stripe session, no second order", `Stripe replay: ${again.status} ${JSON.stringify(again.json).slice(0, 200)}`);
      await settle();
      check(!!order && slackTexts().every((t) => !t.includes(order.id.slice(0, 8).toUpperCase())), "Stripe: an unpaid (PENDING) attempt does NOT ping the owner (the 'betaling ontvangen' notice is the webhook's); it used to ping for every abandoned checkout", "Stripe: the owner was pinged for an unpaid attempt");
    } else {
      log.push("⚠️ Stripe stand-in not available; Stripe checks skipped");
    }

    // G4 Stripe failure: stay on checkout, no order, owner told
    if (stripeEnabled) {
      const part = await mkPart(10, 12);
      const email = freshEmail("stripefail");
      const before = await counts();
      const seqBefore = await invoiceSeq();
      slackBodies.length = 0;
      stripeMode = "fail";
      const r = await call(body({ email, items: [{ sku: part.sku, quantity: 2 }], paymentMethod: "stripe" }));
      stripeMode = "ok";
      const after = await counts();
      check(r.status === 503 && r.json.code === "stripe_unavailable" && /bankoverschrijving/i.test(String(r.json.error)) && !r.json.orderId, "Stripe failure: 503 with a clear message that offers bank transfer as the customer's own choice; no order id", `Stripe failure answer: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
      check(after.orders === before.orders && after.invoices === before.invoices && (await prisma.order.count({ where: { email } })) === 0 && (await stockOf(part.id)) === 10 && (await invoiceSeq()) === seqBefore, "Stripe failure: NO order, NO invoice, NO reservation, invoice number not burned (it used to silently become an OPENSTAAND bank-transfer order)", `Stripe failure left traces: orders ${before.orders}->${after.orders}, invoices ${before.invoices}->${after.invoices}`);
      await settle();
      const texts = slackTexts();
      check(texts.length >= 1 && texts.some((t) => /iDEAL|kaart/i.test(t)) && texts.every((t) => !t.includes(email) && !/secret-detail|ECONNREFUSED/.test(t)), "Stripe failure: the owner was notified (error type only, no customer data, no error text that could echo a secret)", `Stripe failure owner notice: ${texts.join(" | ").slice(0, 300)}`);
    }

    // G5-G8 refusals that create nothing
    {
      const part = await mkPart(10, 28.5);
      const email = freshEmail("stale");
      const before = await counts();
      const seqBefore = await invoiceSeq();
      await prisma.part.update({ where: { id: part.id }, data: { priceEur: 31 } });
      const r = await call(body({ email, items: [{ sku: part.sku, quantity: 2 }], expected: { totalEur: 57, lines: [{ sku: part.sku, unitPriceEur: 28.5, quantity: 2 }] } }));
      check(r.status === 409 && r.json.changed === true && r.json.code === "cart_changed", "Stale price: 409 {changed:true}", `Stale price: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
      const line = (r.json.lines ?? [])[0];
      check(line?.unitPriceEur === 31 && line?.previousUnitPriceEur === 28.5 && line?.quantity === 2 && r.json.totals?.totalEur === 62 && r.json.previousTotalEur === 57, "Stale price: the answer carries the new price (31,00), the price the customer saw (28,50), and the new total 62,00", `Stale price body: ${JSON.stringify(r.json).slice(0, 300)}`);
      const after = await counts();
      check(after.orders === before.orders && after.invoices === before.invoices && (await stockOf(part.id)) === 10 && (await invoiceSeq()) === seqBefore, "Stale price: NOTHING was created (no order, invoice, reservation, burned invoice number). Before: order+invoice for 62,00 while 57,00 was shown", "Stale price created something");
      check(!/cost|supplier/i.test(JSON.stringify(r.json)), "Stale price: the 409 body contains no cost price or supplier", "409 leaks cost");

      // stock cut below what the customer has in the cart
      await prisma.part.update({ where: { id: part.id }, data: { stock: 1 } });
      const s = await call(body({ items: [{ sku: part.sku, quantity: 2 }], expected: { totalEur: 62, lines: [{ sku: part.sku, unitPriceEur: 31, quantity: 2 }] } }));
      const sl = (s.json.lines ?? [])[0];
      check(s.status === 409 && sl?.status === "reduced" && sl?.quantity === 1 && sl?.stock === 1 && sl?.requestedQuantity === 2, "Stock cut: 409, the line is 'reduced' to the 1 available (it used to be a toast and an unchanged cart)", `Stock cut: ${s.status} ${JSON.stringify(s.json).slice(0, 300)}`);
      // sold out
      await prisma.part.update({ where: { id: part.id }, data: { stock: 0 } });
      const so = await call(body({ items: [{ sku: part.sku, quantity: 1 }] }));
      check(so.status === 409 && (so.json.lines ?? [])[0]?.status === "sold_out" && so.json.totals === null, "Sold out: 409 with status sold_out and no totals", `Sold out: ${so.status} ${JSON.stringify(so.json).slice(0, 200)}`);
      // part deleted
      const gone = await mkPart(3, 5);
      await prisma.part.delete({ where: { id: gone.id } });
      const rm = await call(body({ items: [{ sku: gone.sku, quantity: 1 }] }));
      check(rm.status === 409 && (rm.json.lines ?? [])[0]?.status === "removed", "Removed part: 409 with status removed (the cart can drop it; it used to say 'vernieuw de pagina')", `Removed part: ${rm.status} ${JSON.stringify(rm.json).slice(0, 200)}`);
      // total-only mismatch
      await prisma.part.update({ where: { id: part.id }, data: { stock: 10 } });
      const tm = await call(body({ items: [{ sku: part.sku, quantity: 1 }], expected: { totalEur: 1 } }));
      check(tm.status === 409 && tm.json.totals?.totalEur === 36.95 && tm.json.previousTotalEur === 1, "Expected total differs while every line is fine: still 409 (nothing is charged that was not shown)", `Total mismatch: ${tm.status} ${JSON.stringify(tm.json).slice(0, 200)}`);
      // and the same cart with the right numbers goes through
      const good = await call(body({ items: [{ sku: part.sku, quantity: 1 }], expected: { totalEur: 36.95, lines: [{ sku: part.sku, unitPriceEur: 31, quantity: 1 }] } }));
      check(good.status === 200, "The re-confirmed cart (new price, new total) is accepted", `Re-confirmed cart refused: ${good.status} ${JSON.stringify(good.json).slice(0, 200)}`);
    }

    // G9 idempotency
    {
      const part = await mkPart(10, 15);
      const email = freshEmail("idem");
      const k = key();
      const seq0 = await invoiceSeq();
      const first = await call(body({ email, items: [{ sku: part.sku, quantity: 2 }] }), { key: k });
      const second = await call(body({ email, items: [{ sku: part.sku, quantity: 2 }] }), { key: k });
      check(first.status === 200 && second.status === 200 && first.json.orderId === second.json.orderId && second.json.replayed === true, "Idempotent replay: the same key returns the SAME order", `Replay: ${first.json.orderId} vs ${second.json.orderId}`);
      check((await prisma.order.count({ where: { email } })) === 1 && (await stockOf(part.id)) === 8 && (await invoiceSeq()) === seq0 + 1, "Idempotent replay: one order, stock taken once, one invoice number consumed (was: a second order and invoice)", `Replay created more: orders ${await prisma.order.count({ where: { email } })}, stock ${await stockOf(part.id)}`);
      check(second.json.redirectUrl === first.json.redirectUrl.replace("&m=1", ""), "Idempotent replay: the redirect to the confirmation page is the same", "Replay redirect differs");
      // parallel
      const email2 = freshEmail("idem2");
      const k2 = key();
      const parallel = await Promise.all(Array.from({ length: 6 }, () => call(body({ email: email2, items: [{ sku: part.sku, quantity: 1 }] }), { key: k2 })));
      const ids = new Set(parallel.filter((x) => x.status === 200).map((x) => x.json.orderId));
      check(ids.size === 1 && (await prisma.order.count({ where: { email: email2 } })) === 1 && (await stockOf(part.id)) === 7, `Idempotent, 6 parallel requests with one key: exactly 1 order (${parallel.map((x) => x.status).join(",")}), stock taken once`, `Parallel replay: ids ${[...ids].length}, orders ${await prisma.order.count({ where: { email: email2 } })}, statuses ${parallel.map((x) => x.status)}`);
      const other = await call(body({ email: freshEmail("idem3"), items: [{ sku: part.sku, quantity: 1 }] }), { key: k });
      check(other.status === 409 && other.json.code === "idempotency_conflict", "Idempotency: the same key with a different e-mail address is refused (it cannot read someone else's order)", `Foreign key: ${other.status} ${JSON.stringify(other.json).slice(0, 150)}`);
      const badKey = await call(body({ items: [{ sku: part.sku, quantity: 1 }] }), { key: "short" });
      check(badKey.status === 400, "Idempotency: a malformed key is refused", `Bad key: ${badKey.status}`);

      // The same key with a DIFFERENT order must not quietly hand back the old one.
      const k3 = key();
      const email3 = freshEmail("idem4");
      const orig = { email: email3, items: [{ sku: part.sku, quantity: 1 }], expected: { totalEur: 20.95 } };
      const o1 = await call(body(orig), { key: k3 });
      check(o1.status === 200, "Idempotency payload: the original request is accepted", `Original: ${o1.status} ${JSON.stringify(o1.json).slice(0, 150)}`);
      const variants: [string, Json][] = [
        ["more units (and the matching expected total)", { items: [{ sku: part.sku, quantity: 3 }], expected: { totalEur: 50.95 } }],
        ["another street", { address: { street: "Andere straat", houseNumber: "1", postalCode: "1011 AB", city: "Amsterdam" } }],
        ["another house number", { address: { street: "Teststraat", houseNumber: "2", postalCode: "1011 AB", city: "Amsterdam" } }],
        ["another name", { name: "Klaas Bakker" }],
        ["another phone number", { phone: "06 99999999" }],
        ["a btw-nummer added", { vatNumber: "NL123456789B01" }],
        ["another delivery note", { customerNote: "achterom" }],
        ["another payment method", { paymentMethod: "stripe" }],
        ["another expected total", { expected: { totalEur: 99 } }],
      ];
      const refused: string[] = [];
      for (const [label, over] of variants) {
        const v = await call(body({ ...orig, ...over }), { key: k3 });
        if (!(v.status === 409 && v.json.code === "idempotency_conflict" && !v.json.orderId)) refused.push(`${label}: ${v.status} ${v.json.code}`);
      }
      check(refused.length === 0, `Idempotency payload: the same key with ${variants.length} different requests (units, street, number, name, phone, btw, note, method, expected total) is refused with 409 idempotency_conflict, never answered with the old order`, `Idempotency payload: answered instead of refused: ${refused.join(" ; ")}`);
      const byId = await call(body({ ...orig, items: [{ partId: part.id, quantity: 1 }] }), { key: k3 });
      check(byId.status === 200 && byId.json.replayed === true && byId.json.orderId === o1.json.orderId, "[guard] Idempotency payload: the SAME request written with partId instead of sku is still a replay", `Same request via partId: ${byId.status} ${JSON.stringify(byId.json).slice(0, 150)}`);
      const noExpected = await call(body({ email: email3, items: [{ sku: part.sku, quantity: 1 }] }), { key: k3 });
      check(noExpected.status === 200 && noExpected.json.replayed === true, "[guard] Idempotency payload: a retry that leaves out the optional `expected` is still a replay", `Retry without expected: ${noExpected.status}`);
      check((await prisma.order.count({ where: { email: email3 } })) === 1, "Idempotency payload: the refused requests created nothing (still one order)", "Idempotency payload: extra orders exist");
    }

    // G10 caps
    {
      slackBodies.length = 0;
      const part = await mkPart(500, 5);
      const many = await call(body({ items: Array.from({ length: limits.MAX_LINES_PER_ORDER + 1 }, (_, i) => ({ sku: `${SKU_PREFIX}X${i}`, quantity: 1 })) }));
      check(many.status === 400 && /Maximaal/.test(String(many.json.error)), `Caps: ${limits.MAX_LINES_PER_ORDER + 1} lines -> 400 'Maximaal ...'`, `Caps lines: ${many.status} ${many.json.error}`);
      const big = await call(body({ items: [{ sku: part.sku, quantity: limits.MAX_QTY_PER_LINE + 1 }] }));
      check(big.status === 400 && /Maximaal/.test(String(big.json.error)), `Caps: quantity ${limits.MAX_QTY_PER_LINE + 1} on one line -> 400 (the old limit was 99)`, `Caps qty: ${big.status} ${big.json.error}`);
      const parts = await Promise.all(Array.from({ length: 4 }, () => mkPart(100, 1)));
      const units = await call(body({ items: parts.map((p) => ({ sku: p.sku, quantity: limits.MAX_QTY_PER_LINE })) }));
      check(units.status === 400 && /Maximaal \d+ stuks/.test(String(units.json.error)), `Caps: 80 units over 4 lines -> 400 (max ${limits.MAX_UNITS_PER_ORDER} per order)`, `Caps units: ${units.status} ${units.json.error}`);
      const dup = await call(body({ items: [{ sku: part.sku, quantity: 20 }, { sku: part.sku, quantity: 20 }] }));
      check(dup.status === 409 && (dup.json.lines ?? [])[0]?.quantity === limits.MAX_QTY_PER_LINE && (dup.json.lines ?? []).length === 1, "Caps: the same SKU listed twice (2 x 20) is merged and cannot exceed the per-line cap of 20", `Caps duplicate lines: ${dup.status} ${JSON.stringify(dup.json).slice(0, 200)}`);

      // per e-mail: sequential
      const email = freshEmail("capmail");
      const seq: number[] = [];
      for (let i = 0; i < 4; i++) seq.push((await call(body({ email, items: [{ sku: part.sku, quantity: 1 }] }))).status);
      check(seq.join(",") === "200,200,429,429", `Caps per e-mail: a guest may hold ${limits.OPEN_BANK_TRANSFER_LIMITS.guest.orders} open bank-transfer orders, the 3rd and 4th get 429 (${seq.join(",")})`, `Caps per e-mail sequence: ${seq.join(",")}`);
      const capped = await call(body({ email, items: [{ sku: part.sku, quantity: 1 }] }));
      check(capped.status === 429 && /openstaande bestellingen op rekening/.test(String(capped.json.error)) && capped.json.code === "bank_transfer_limit_orders", "Caps per e-mail: a clear Dutch message", `Cap message: ${capped.json.error}`);
      check((await prisma.order.count({ where: { email } })) === 2, "Caps per e-mail: exactly 2 orders exist for the address", "Caps per e-mail: wrong order count");
      await settle();
      const capNotices = slackTexts().filter((t) => /Bestellimiet/i.test(t) && /bank_transfer_open_orders/.test(t));
      check(capNotices.length === 1 && !capNotices[0].includes(email), "Caps: the same limit hit repeatedly -> the owner gets ONE notice for it (not one per refusal), without the address", `Cap notices for open orders: ${capNotices.length}: ${capNotices.join("|").slice(0, 200)}`);
      check(slackTexts().every((t) => !t.includes(email)), "Caps: no owner notice contains the buyer's e-mail address", "A cap notice leaked the address");
      // same address in another case counts as the same buyer
      const caseVariant = await call(body({ email: email.toUpperCase(), items: [{ sku: part.sku, quantity: 1 }] }));
      check(caseVariant.status === 429, "Caps per e-mail: MIXED-CASE spelling of the same address does not get around the cap", `Case variant: ${caseVariant.status}`);
      // parallel: 8 at once for one fresh address
      const email2 = freshEmail("capmail2");
      const par = await Promise.all(Array.from({ length: 8 }, () => call(body({ email: email2, items: [{ sku: part.sku, quantity: 1 }] }))));
      const okCount = par.filter((x) => x.status === 200).length;
      check(okCount === 2 && (await prisma.order.count({ where: { email: email2 } })) === 2, `Caps per e-mail under concurrency: 8 parallel requests -> exactly ${okCount} accepted, 2 orders in the database (advisory lock)`, `Concurrent cap: accepted ${okCount}, orders ${await prisma.order.count({ where: { email: email2 } })}, statuses ${par.map((x) => x.status)}`);
      // value cap
      const exp = await mkPart(50, 300);
      const val = await call(body({ items: [{ sku: exp.sku, quantity: 2 }] }));
      check(val.status === 429 && val.json.code === "bank_transfer_limit_value" && /iDEAL of kaart/.test(String(val.json.error)), `Caps value: a guest bank-transfer order above EUR ${limits.OPEN_BANK_TRANSFER_LIMITS.guest.valueEur} -> 429 with the way out (Stripe is on, so iDEAL/kaart is offered)`, `Value cap: ${val.status} ${JSON.stringify(val.json).slice(0, 200)}`);
      // per IP per day. Decision D17 / rehearsal D12: 10, not 3. The hourly cap for any order is also 10, so to reach the DAILY one with
      // real requests the allowance is first used up through the same counter the route uses (rateLimit "checkout-bank-ip:<ip>"),
      // leaving exactly 3 places; the next request after those 3 must be refused by the daily cap.
      const { rateLimit } = await import("../src/lib/ratelimit");
      const DAYMS = 24 * 60 * 60 * 1000;
      const N = limits.MAX_BANK_TRANSFER_ORDERS_PER_IP_PER_DAY;
      check(N === 10, "Caps per IP: the daily bank-transfer allowance per address is 10 (decision D17; it was 3 and refused households, offices and mobile networks)", `Caps per IP: constant is ${N}`);
      const ip = "203.0.113.77";
      for (let i = 0; i < N - 3; i++) await rateLimit(`checkout-bank-ip:${ip}`, N, DAYMS);
      const ipRes: number[] = [];
      for (let i = 0; i < 4; i++) ipRes.push((await call(body({ items: [{ sku: part.sku, quantity: 1 }] }), { ip })).status);
      check(ipRes.slice(0, 3).every((s) => s === 200) && ipRes[3] === 429, `Caps per IP: after ${N - 3} of the ${N} daily places were used, the next 3 orders from the address pass and the one after is refused (${ipRes.join(",")})`, `Caps per IP: ${ipRes.join(",")}`);

      // The counter counts ORDERS. A request refused for another reason (here: the per-address cap) must not
      // use up the allowance, and the refusal that follows must be true about how many orders were placed.
      const ip2 = "203.0.113.88";
      for (let i = 0; i < N - 3; i++) await rateLimit(`checkout-bank-ip:${ip2}`, N, DAYMS);
      const [ea, eb, ec] = [freshEmail("ipa"), freshEmail("ipb"), freshEmail("ipc")];
      const one = (e: string) => call(body({ email: e, items: [{ sku: part.sku, quantity: 1 }] }), { ip: ip2 });
      const seq2 = [(await one(ea)).status, (await one(ea)).status, (await one(ea)).status, (await one(eb)).status];
      const last2 = await one(ec);
      const placed = await prisma.order.count({ where: { email: { in: [ea, eb, ec] } } });
      check(seq2.join(",") === "200,200,429,200" && last2.status === 429 && last2.json.code === "bank_transfer_limit_ip" && placed === 3, `Caps per IP: a refusal for another reason does not burn the allowance (${seq2.join(",")}, then ${last2.status} after ${placed} real orders)`, `Caps per IP counts refused attempts: ${seq2.join(",")} then ${last2.status} ${last2.json.code}; ${placed} orders`);
      check(new RegExp(`maximum van ${N} bestellingen`).test(String(last2.json.error)) && placed === 3, `Caps per IP: the refusal quotes the real daily maximum ('${N} bestellingen') and exactly the 3 remaining places were used`, `Caps per IP message: "${last2.json.error}" with ${placed} orders`);
    }

    // G10c the attacker: try to reserve everything
    {
      const attackParts = await Promise.all(Array.from({ length: 12 }, () => mkPart(100, 40)));
      const totalValue = attackParts.reduce((s, p) => s + p.stock * p.priceEur, 0);
      let accepted = 0;
      let refused = 0;
      await resetOpenReservations();
      const startOpen = (await prisma.order.aggregate({ where: { status: "OPENSTAAND", paymentMethod: "BANK_TRANSFER" }, _sum: { totalEur: true } }))._sum.totalEur ?? 0;
      for (let i = 0; i < 80; i++) {
        // a fresh address and a fresh IP every time: the per-address and per-IP caps cannot stop this
        const p = attackParts[i % attackParts.length];
        const r = await call(body({ email: freshEmail("attacker"), items: [{ sku: p.sku, quantity: 12 }] }), { ip: `198.51.100.${(i % 250) + 1}` });
        if (r.status === 200) accepted++;
        else refused++;
      }
      const reserved = attackParts.reduce((s, p) => s + p.stock * p.priceEur, 0) - (await Promise.all(attackParts.map(async (p) => (await stockOf(p.id)) * p.priceEur))).reduce((a, b) => a + b, 0);
      const open = (await prisma.order.aggregate({ where: { status: "OPENSTAAND", paymentMethod: "BANK_TRANSFER" }, _sum: { totalEur: true } }))._sum.totalEur ?? 0;
      check(open - startOpen <= limits.MAX_OPEN_GUEST_BANK_TRANSFER_VALUE_EUR + 0.01 && refused > 0, `Attacker (80 orders, new address and new IP each time, 12 units each): reserved EUR ${reserved.toFixed(2)} of ${totalValue.toFixed(2)} (${((reserved / totalValue) * 100).toFixed(1)}%), ${accepted} accepted / ${refused} refused; open guest value stayed within the EUR ${limits.MAX_OPEN_GUEST_BANK_TRANSFER_VALUE_EUR} global cap`, `Attacker reserved ${reserved} (open value ${open - startOpen}), accepted ${accepted}`);
      const lastRefusal = await call(body({ email: freshEmail("late"), items: [{ sku: attackParts[0].sku, quantity: 12 }] }), { ip: "192.0.2.200" });
      check(lastRefusal.status === 429 && lastRefusal.json.code === "bank_transfer_unavailable", "Global cap: once the guest pool is used up, a further bank-transfer order gets a clear 'tijdelijk niet beschikbaar' (pay by iDEAL/kaart)", `After the attack: ${lastRefusal.status} ${JSON.stringify(lastRefusal.json).slice(0, 150)}`);
      // The pool is released when the unpaid orders are cancelled
      const open1 = await prisma.order.findMany({ where: { email: { startsWith: "attacker" }, status: "OPENSTAAND" }, select: { id: true }, take: 3 });
      for (const o of open1) await inv.cancelOrder(o.id, { reason: "qa", actor: "admin", notifyCustomer: false });
      const afterRelease = await call(body({ email: freshEmail("late2"), items: [{ sku: attackParts[0].sku, quantity: 12 }] }), { ip: "192.0.2.201" });
      check(afterRelease.status === 200, "Global cap: cancelling unpaid orders frees the pool again", `After release: ${afterRelease.status}`);
    }

    // G11 identity: one person, one user row
    {
      const part = await mkPart(50, 5);
      const base = `person${Date.now().toString(36)}@${DOMAIN}`;
      // three spellings; the per-address cap would stop the third, so use Stripe-free fresh IPs and separate buyers' caps via cancel
      const first = await call(body({ email: base.replace("person", "Person"), items: [{ sku: part.sku, quantity: 1 }] }));
      const second = await call(body({ email: ` ${base} `, items: [{ sku: part.sku, quantity: 1 }] }));
      const users = await prisma.user.findMany({ where: { email: { equals: base, mode: "insensitive" } } });
      check(first.status === 200 && second.status === 200 && users.length === 1 && users[0].email === base, "E-mail identity: 'Person@..' and ' person@.. ' are ONE user row, stored lower-case (it used to be three rows)", `E-mail identity: ${users.length} rows ${users.map((u) => u.email)}`);
      // a legacy mixed-case row is reused, not duplicated
      const legacy = `Legacy${Date.now().toString(36)}@${DOMAIN}`;
      const row = await prisma.user.create({ data: { email: legacy, name: "Legacy" } });
      const viaLegacy = await call(body({ email: legacy.toLowerCase(), items: [{ sku: part.sku, quantity: 1 }] }));
      const ord = viaLegacy.json.orderId ? await prisma.order.findUnique({ where: { id: viaLegacy.json.orderId } }) : null;
      check(ord?.userId === row.id && (await prisma.user.count({ where: { email: { equals: legacy, mode: "insensitive" } } })) === 1, "E-mail identity: an existing mixed-case user row is reused for the lower-case address", "E-mail identity: legacy row duplicated");
    }

    // G11b decision D16 / rehearsal R2-12: a guest order is attached to an existing REAL account (one with a Clerk id) only when the
    // placer is signed in as that account. Typing somebody's address must not put the order in their dashboard or block their erasure.
    {
      const part = await mkPart(50, 5);
      const { GUEST_HOLDER_EMAIL } = await import("../src/lib/checkout-user");
      const memberEmail = freshEmail("member-real");
      const member = await prisma.user.create({ data: { email: memberEmail, name: "Echte klant", clerkId: `user_qa_real_${Date.now()}_${++mailCounter}` } });
      const stranger = await call(body({ email: memberEmail.toUpperCase().replace("@QA-CHECKOUT.TEST", "@QA-CHECKOUT.TEST"), items: [{ sku: part.sku, quantity: 1 }] }));
      const sOrder = stranger.json.orderId ? await prisma.order.findUnique({ where: { id: stranger.json.orderId }, include: { user: true } }) : null;
      check(stranger.status === 200 && !!sOrder && sOrder.userId !== member.id && sOrder.user.clerkId === null && sOrder.user.email === GUEST_HOLDER_EMAIL && sOrder.email === memberEmail, "Guest attach: a guest typing the address of a REAL account gets a guest order on the placeholder row (the order keeps the typed address), NOT on that account", `Guest attach: ${stranger.status} order user ${sOrder?.userId} vs member ${member.id}, holder ${sOrder?.user.email}`);
      check((await prisma.order.count({ where: { userId: member.id } })) === 0, "Guest attach: the real account's dashboard (orders of that user) stays empty", "Guest attach: the stranger's order is in the member's account");
      // ...so the member can erase their account (the 21-day block of rehearsal R2-12 is gone)
      const { ordersBlockingErasure } = await import("../src/lib/erasure");
      check((await ordersBlockingErasure(prisma, member.id)).length === 0, "Guest attach: the stranger's open order does not block the real account's erasure", "Guest attach: erasure of the member is still blocked");
      // ...and the guest still has their way in: the token on the answer opens exactly that order
      const access = await import("../src/app/bestelling/_lib/access");
      const tok = new URL(`http://x${stranger.json.redirectUrl}`).searchParams.get("t");
      const viaToken = sOrder ? await access.loadOrderForViewer(sOrder.id, tok) : null;
      check(viaToken?.via === "token", "Guest attach: the guest reaches their order with the token (guest access, decision D2)", `Guest attach: token access ${viaToken?.via}`);
      // The per-address cap still counts the TYPED address, whatever row holds the orders.
      const second = await call(body({ email: memberEmail, items: [{ sku: part.sku, quantity: 1 }] }));
      const third = await call(body({ email: memberEmail, items: [{ sku: part.sku, quantity: 1 }] }));
      check(second.status === 200 && third.status === 429 && third.json.code === "bank_transfer_limit_orders", "Guest attach: the guest limit (2 open orders) still counts by the typed address on the placeholder row", `Guest attach caps: ${second.status}/${third.status} ${third.json.code}`);
      // A guest row WITHOUT a Clerk id (created by an earlier checkout) keeps today's behaviour: reused, claimed by the verified owner at first sign-in.
      const guestEmail = freshEmail("guest-row");
      const guestRow = await prisma.user.create({ data: { email: guestEmail, name: "Eerdere gast" } });
      const again = await call(body({ email: guestEmail, items: [{ sku: part.sku, quantity: 1 }] }));
      const aOrder = again.json.orderId ? await prisma.order.findUnique({ where: { id: again.json.orderId } }) : null;
      check(aOrder?.userId === guestRow.id, "Guest attach: a guest-created row without a Clerk id is still reused (claimed by the verified owner at first sign-in)", `Guest attach: guest row not reused: ${aOrder?.userId} vs ${guestRow.id}`);
      await resetOpenReservations();
    }

    // G12 field errors
    {
      const part = await mkPart(5, 5);
      const r = await call(body({ items: [{ sku: part.sku, quantity: 1 }], address: { street: "Teststraat", houseNumber: "1", postalCode: "12345", city: "Amsterdam" } }));
      check(r.status === 400 && /postcode/i.test(String(r.json.error)) && /postcode/i.test(r.json.details?.fieldErrors?.postalCode ?? ""), "Validation: postcode 12345 -> 400 with the postcode message in 'error' and under fieldErrors.postalCode (it used to be 'Ongeldige bestelgegevens')", `Validation: ${r.status} ${JSON.stringify(r.json).slice(0, 250)}`);
      const be = await call(body({ items: [{ sku: part.sku, quantity: 1 }], address: { street: "Rue", houseNumber: "1", postalCode: "1000", city: "Brussel", country: "BE" } }));
      check(be.status === 400 && /Nederland/.test(JSON.stringify(be.json)), "Belgium: a Belgian address is refused with 'alleen in Nederland' (not a vague postcode error)", `Belgium: ${be.status} ${JSON.stringify(be.json).slice(0, 200)}`);
      const nophone = await call(body({ items: [{ sku: part.sku, quantity: 1 }], phone: "" }));
      check(nophone.status === 400 && /telefoon/i.test(String(nophone.json.error)), "Phone is required: an empty phone -> 400 with a phone message", `Phone: ${nophone.status} ${nophone.json.error}`);
      const multi = await call(body({ items: [{ sku: part.sku, quantity: 1 }], email: "a@b", name: "A", phone: "1" }));
      const fe = multi.json.details?.fieldErrors ?? {};
      check(multi.status === 400 && !!fe.email && !!fe.name && !!fe.phone, "Validation: several mistakes at once are all reported by field", `Multi: ${JSON.stringify(fe)}`);
    }

    // G13 last unit, two buyers
    {
      const part = await mkPart(1, 20);
      const results = await Promise.all([call(body({ items: [{ sku: part.sku, quantity: 1 }] })), call(body({ items: [{ sku: part.sku, quantity: 1 }] }))]);
      const wins = results.filter((r) => r.status === 200).length;
      check(wins === 1 && results.some((r) => r.status === 409) && (await stockOf(part.id)) === 0, `Last unit, two buyers: exactly one order (${results.map((r) => r.status).join(",")}), stock 0 not negative`, `Last unit: ${results.map((r) => r.status)} stock ${await stockOf(part.id)}`);
    }

    // G14 expiry sweep issues a credit note (D4)
    {
      const part = await mkPart(10, 20);
      const r = await call(body({ items: [{ sku: part.sku, quantity: 3 }] }));
      const id = r.json.orderId as string;
      await prisma.order.update({ where: { id }, data: { dueAt: new Date(Date.now() - (limits.BANK_TRANSFER_GRACE_DAYS + 1) * 86400000) } });
      const fresh = await mkPart(10, 20);
      const res = await expiry.releaseExpiredBankTransferOrders({ limit: 100 });
      const order = await prisma.order.findUniqueOrThrow({ where: { id }, include: { invoice: { include: { creditNotes: true } } } });
      check(res.cancelled >= 1 && order.status === "CANCELLED" && (await stockOf(part.id)) === 10, "Expiry: an unpaid invoice past due + grace is cancelled and its 3 units go back on the shelf", `Expiry: ${JSON.stringify(res)} ${order.status} stock ${await stockOf(part.id)}`);
      check(order.invoice?.creditNotes.length === 1 && /^CN-\d{4}-\d{5}$/.test(order.invoice.creditNotes[0].number) && order.invoice.creditNotes[0].totalEur === order.invoice.totalEur, `Expiry: the invoice stays and a full credit note (${order.invoice?.creditNotes[0]?.number}) was issued (it used to cancel with no credit note)`, "Expiry: no credit note");
      void fresh;
    }

    // G14b the expiry sweep must not run inside a customer's request
    {
      const held = await mkPart(100, 20);
      const past = new Date(Date.now() - (limits.BANK_TRANSFER_GRACE_DAYS + 2) * 86400000);
      const sweepUser = await prisma.user.create({ data: { email: `sweeper@${DOMAIN}`, name: "Sweep" } });
      const mkExpired = (i: number, partId: string) => mkOpenOrder(25.95, { userId: sweepUser.id, partId }).then((o) => prisma.order.update({ where: { id: o.id }, data: { dueAt: past, email: `sweep${i}@${DOMAIN}` } }));
      for (let i = 0; i < 25; i++) await mkExpired(i, held.id);
      await prisma.part.update({ where: { id: held.id }, data: { stock: 75 } });
      const fresh = await mkPart(5, 12);
      slackDelayMs = 300;
      const t0 = Date.now();
      const r = await call(body({ items: [{ sku: fresh.sku, quantity: 1 }] }));
      const took = Date.now() - t0;
      slackDelayMs = 0;
      check(r.status === 200 && took < 1500, `Expiry sweep: a customer's checkout does not wait for it (25 expired reservations, 300 ms webhook: ${took} ms; it took about 8 s when the sweep ran inline)`, `Expiry sweep holds the request: ${r.status} in ${took} ms`);
      await new Promise((res) => setTimeout(res, 3500));
      const cancelledNow = await prisma.order.count({ where: { email: { startsWith: "sweep" }, status: "CANCELLED" } });
      check(cancelledNow >= 1 && cancelledNow <= 3, `Expiry sweep: one checkout request releases at most 3 expired reservations, in the background (${cancelledNow} of 25)`, `Expiry sweep after one request: ${cancelledNow} of 25 cancelled`);
      await prisma.order.deleteMany({ where: { email: { startsWith: "sweep" } } });

      // ...but a customer is never refused a unit that only an expired reservation is holding.
      const last = await mkPart(0, 20);
      const holder = await mkExpired(99, last.id);
      const rr = await call(body({ items: [{ sku: last.sku, quantity: 1 }] }));
      const holderAfter = await prisma.order.findUniqueOrThrow({ where: { id: holder.id } });
      check(rr.status === 200 && holderAfter.status === "CANCELLED" && (await stockOf(last.id)) === 0, "[guard] Expiry sweep: the last unit is held by an unpaid invoice past its grace period -> the customer still gets it (the stale reservation is released first, only because the stock was short)", `Short stock held by an expired reservation: ${rr.status} ${JSON.stringify(rr.json).slice(0, 150)} holder ${holderAfter.status} stock ${await stockOf(last.id)}`);
    }

    // G16a what the customer is told when Stripe IS on: the way out is iDEAL / kaart
    {
      const caps = await capScenarios();
      for (const [label, r, code] of [["per address", caps.address, "bank_transfer_limit_orders"], ["value", caps.value, "bank_transfer_limit_value"], ["per network", caps.ip, "bank_transfer_limit_ip"], ["global pool", caps.pool, "bank_transfer_unavailable"]] as const) {
        check(r.status === 429 && r.json.code === code && /iDEAL of kaart/.test(String(r.json.error)), `Cap refusal (${label}) with Stripe on offers iDEAL of kaart: "${String(r.json.error).slice(0, 100)}"`, `Cap refusal (${label}) with Stripe on: ${r.status} ${r.json.code} "${r.json.error}"`);
      }
    }

    // G16 the guest pool covers every open reservation, whoever holds it
    {
      await resetOpenReservations();
      const p = await mkPart(50, 150);
      const reg = await mkOpenOrder(2900, { registered: true });
      const refused = await call(body({ items: [{ sku: p.sku, quantity: 1 }] }));
      check(refused.status === 429 && refused.json.code === "bank_transfer_unavailable", `Global pool: EUR 2900 held under a REGISTERED account counts against a guest too; a EUR 150 guest order is refused (${refused.status} ${refused.json.code}). Before, only accounts without a Clerk id were counted`, `Global pool ignores registered holders: ${refused.status} ${JSON.stringify(refused.json).slice(0, 150)}`);
      await prisma.order.delete({ where: { id: reg.id } });
      const freed = await call(body({ items: [{ sku: p.sku, quantity: 1 }] }));
      check(freed.status === 200, "[guard] Global pool: the same order is accepted once the reservation is gone", `After release: ${freed.status}`);

      // The attack the reviewer measured: type the e-mail address of a registered account (20 of them) so the order hangs on that account.
      await resetOpenReservations();
      const regs = await Promise.all(Array.from({ length: 14 }, (_, i) => mkOpenOrder(1, { registered: true, status: "CANCELLED" }).then((o) => ({ email: o.email, i }))));
      const big = await mkPart(500, 480);
      let accepted = 0;
      for (const r of regs) for (let k = 0; k < 2; k++) if ((await call(body({ email: r.email, items: [{ sku: big.sku, quantity: 1 }] }))).status === 200) accepted++;
      const held = (await prisma.order.aggregate({ where: { email: { endsWith: `@${DOMAIN}` }, status: "OPENSTAAND", paymentMethod: "BANK_TRANSFER" }, _sum: { totalEur: true } }))._sum.totalEur ?? 0;
      check(held <= limits.MAX_OPEN_GUEST_BANK_TRANSFER_VALUE_EUR + 0.01 && accepted > 0 && accepted < 28, `Global pool: 28 guest orders typed with the addresses of 14 registered accounts hold EUR ${held.toFixed(2)} (${accepted} accepted), within the EUR ${limits.MAX_OPEN_GUEST_BANK_TRANSFER_VALUE_EUR} pool. Before: all 28, EUR 13440`, `Global pool bypassed with registered addresses: ${accepted} accepted, EUR ${held} held`);
      await resetOpenReservations();

      // ...and in parallel: the pool is counted under a lock, so a burst cannot all pass the same count.
      const burst = await Promise.all(Array.from({ length: 14 }, (_, i) => call(body({ email: regs[i % regs.length].email, items: [{ sku: big.sku, quantity: 1 }] }))));
      const heldBurst = (await prisma.order.aggregate({ where: { email: { endsWith: `@${DOMAIN}` }, status: "OPENSTAAND", paymentMethod: "BANK_TRANSFER" }, _sum: { totalEur: true } }))._sum.totalEur ?? 0;
      check(heldBurst <= limits.MAX_OPEN_GUEST_BANK_TRANSFER_VALUE_EUR + 0.01 && burst.some((x) => x.status === 200) && burst.some((x) => x.status === 429), `Global pool: a burst of 14 parallel guest orders holds EUR ${heldBurst.toFixed(2)} (${burst.filter((x) => x.status === 200).length} accepted), within the EUR ${limits.MAX_OPEN_GUEST_BANK_TRANSFER_VALUE_EUR} pool`, `Global pool under a parallel burst: EUR ${heldBurst} held, statuses ${burst.map((x) => x.status)}`);
      await resetOpenReservations();
    }

    // G17 abandoned Stripe attempts expire quietly
    {
      const expireFn = (expiry as unknown as { expireAbandonedStripeOrders?: (o?: { now?: Date }) => Promise<{ cancelled: number }> }).expireAbandonedStripeOrders;
      const oldOne = await mkOpenOrder(30, { stripe: true, ageHours: 72 });
      const newOne = await mkOpenOrder(30, { stripe: true, ageHours: 2 });
      slackBodies.length = 0;
      const res = typeof expireFn === "function" ? await expireFn() : null;
      const [oldAfter, newAfter] = [await prisma.order.findUniqueOrThrow({ where: { id: oldOne.id } }), await prisma.order.findUniqueOrThrow({ where: { id: newOne.id } })];
      check(!!res && oldAfter.status === "CANCELLED" && !!oldAfter.cancelledAt && newAfter.status === "PENDING", "Abandoned Stripe attempts: a PENDING order older than 48 h is cancelled, a fresh one is left alone", `Abandoned sweep: ${res ? JSON.stringify(res) : "function missing"} old ${oldAfter.status} new ${newAfter.status}`);
      await settle();
      check(slackBodies.length === 0, "Abandoned Stripe attempts: expiring them sends no owner notice and no customer mail (nobody paid, nothing to refund)", `Abandoned sweep pinged: ${slackTexts().join("|").slice(0, 150)}`);
    }

    // G15 validate route
    {
      const part = await mkPart(3, 12.5);
      const dead = await mkPart(1, 5);
      await prisma.part.delete({ where: { id: dead.id } });
      const r = await callValidate({ items: [{ sku: part.sku, quantity: 9 }, { sku: dead.sku, quantity: 1 }] });
      const j = JSON.parse(r.text);
      const l0 = j.lines.find((l: Json) => l.sku === part.sku);
      const l1 = j.lines.find((l: Json) => l.sku === dead.sku);
      check(r.status === 200 && l0?.quantity === 3 && l0?.stock === 3 && l0?.status === "reduced" && l1?.status === "removed" && j.changed === true, "Cart validate: quantity capped at stock (9 -> 3), a dead SKU is reported as removed", `Validate: ${r.status} ${r.text.slice(0, 300)}`);
      check(j.totals?.subtotalEur === 37.5 && j.totals?.shippingEur === 5.95 && j.totals?.totalEur === 43.45, "Cart validate: totals are for what can be ordered (3 x 12,50 + 5,95)", `Validate totals: ${JSON.stringify(j.totals)}`);
      check(!/"cost|supplier/i.test(r.text), "Cart validate: no cost price or supplier in the JSON", `Validate leaks: ${r.text.slice(0, 200)}`);
      const get = await validate.GET(new NextRequest(`http://localhost/api/cart/validate?sku=${part.sku}&sku=NOPE`, { headers: { "x-vercel-forwarded-for": freshIp() } }));
      const gj = (await get.json()) as Json;
      check(get.status === 200 && gj.lines.length === 2 && gj.lines.find((l: Json) => l.sku === "NOPE")?.status === "removed", "Cart validate GET: looks up SKUs without quantities", `Validate GET: ${get.status} ${JSON.stringify(gj).slice(0, 200)}`);
      const bad = await callValidate({ items: [] });
      check(bad.status === 400, "Cart validate: an empty cart is a 400", `Validate empty: ${bad.status}`);
      // the totals agree with what an order gets (two copies of the arithmetic, one result)
      const t = (await import("../src/lib/cart-totals")).cartTotals(37.5, 0);
      const o = await call(body({ items: [{ sku: part.sku, quantity: 3 }] }));
      const row = o.json.orderId ? await prisma.order.findUnique({ where: { id: o.json.orderId } }) : null;
      check(!!row && row.totalEur === t.totalEur && row.vatEur === t.vatEur && row.shippingEur === t.shippingEur, "cartTotals() equals the total, shipping and VAT of a real order", `cartTotals vs order: ${JSON.stringify(t)} vs ${row?.totalEur}/${row?.vatEur}`);
    }

    void beforeSeq;
  } finally {
    await cleanup().catch((e) => console.error("cleanup failed", e));
    await prisma.$disconnect();
    slack.close();
  }
}

// ───────────────────────────── cart store (client module, no database) ─────────────────────────────
async function cartChecks() {
  // The store persists to localStorage; give it an in-memory one so the checks run in plain node.
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  (globalThis as any).localStorage = storage;
  (globalThis as any).window = { localStorage: storage };
  const cart = await import("../src/components/cart-provider");
  const limits = await import("../src/lib/cart-limits");
  const attempt = await import("../src/lib/cart-attempt");
  const line = (sku: string, quantity: number, stock?: number) => ({ sku, quantity, ...(stock !== undefined ? { stock } : {}) });
  const item = (sku: string, stock?: number) => ({ partId: `id-${sku}`, sku, name: sku, brand: "QA", priceEur: 10, ...(stock !== undefined ? { stock } : {}) });

  // The reviewer's case: stepper at 30, part has 77 in stock, the cap per part is 20.
  const a1 = cart.planAdd([], "A", 77, 30);
  check(a1.added === 20 && a1.limit === "line" && /Maximaal 20 per onderdeel/.test(a1.message ?? "") && !/niet beschikbaar/.test(a1.message ?? ""), `Add to cart: 30 asked, stock 77 -> 20 added and the message names the per-part cap: "${a1.message}"`, `Add to cart cap message: ${JSON.stringify(a1)}`);
  const a2 = cart.planAdd([line("A", 20, 77)], "A", 77, 30);
  check(a2.added === 0 && a2.limit === "line" && /al het maximum/.test(a2.message ?? ""), `Add to cart: a second add at the cap adds 0 and says so: "${a2.message}"`, `Add to cart at cap: ${JSON.stringify(a2)}`);
  const a3 = cart.planAdd([], "B", 3, 5);
  check(a3.added === 3 && a3.limit === "stock" && /voorraad/.test(a3.message ?? ""), `Add to cart: stock 3 -> 3 added, message names the stock: "${a3.message}"`, `Add to cart stock: ${JSON.stringify(a3)}`);
  const a4 = cart.planAdd([line("A", 20), line("B", 20)], "C", 100, 20);
  check(a4.added === 10 && a4.limit === "units" && new RegExp(`Maximaal ${limits.MAX_UNITS_PER_ORDER} stuks per bestelling`).test(a4.message ?? ""), `Add to cart: the order-wide unit cap (${limits.MAX_UNITS_PER_ORDER}) is enforced in the cart (10 of 20 added): "${a4.message}"`, `Add to cart units: ${JSON.stringify(a4)}`);
  const full = Array.from({ length: limits.MAX_LINES_PER_ORDER }, (_, i) => line(`S${i}`, 1));
  const a5 = cart.planAdd(full, "NEW", 100, 1);
  check(a5.added === 0 && a5.limit === "lines" && /verschillende onderdelen/.test(a5.message ?? ""), `Add to cart: a ${limits.MAX_LINES_PER_ORDER + 1}th different part is refused with a message: "${a5.message}"`, `Add to cart lines: ${JSON.stringify(a5)}`);
  const a6 = cart.planAdd(full, "S3", 100, 2);
  check(a6.added === 2 && a6.message === null, "[guard] Add to cart: more of a part already in a full cart is fine", `Add to cart existing line in a full cart: ${JSON.stringify(a6)}`);

  // The real store, including setQty (the drawer's + button).
  const { useCart } = cart;
  useCart.getState().clear();
  const added = useCart.getState().add(item("A", 77), 30);
  check(added === 20 && useCart.getState().items[0].quantity === 20, "Cart store: add() returns how many were really added (20) so callers can toast the truth", `Cart store add: returned ${added}, holds ${useCart.getState().items[0]?.quantity}`);
  useCart.getState().add(item("B", 100), 20);
  useCart.getState().add(item("C", 100), 20);
  const units = () => useCart.getState().items.reduce((n, i) => n + i.quantity, 0);
  check(units() === limits.MAX_UNITS_PER_ORDER, `Cart store: three lines of 20 stop at ${limits.MAX_UNITS_PER_ORDER} units in total (was: 60 accepted, then refused by the server with no message)`, `Cart store units: ${units()}`);
  useCart.getState().setQty("id-C", 99);
  check(units() === limits.MAX_UNITS_PER_ORDER, "Cart store: setQty() cannot push the cart past the unit cap either", `Cart store setQty units: ${units()}`);
  useCart.getState().setQty("id-A", 5);
  useCart.getState().setQty("id-C", 99);
  check(useCart.getState().items.find((i) => i.sku === "C")?.quantity === 20 && units() === 45, "Cart store: room freed on one line can be used on another (A 5 -> C back to 20; 45 units)", `Cart store room: ${JSON.stringify(useCart.getState().items.map((i) => [i.sku, i.quantity]))}`);
  const capA = cart.cartCapFor({ stock: 77 }, [line("B", 20), line("C", 20)]);
  check(capA.cap === 10 && capA.limit === "units", "cartCapFor(): the drawer's + button knows the cap is the unit cap (10 left)", `cartCapFor: ${JSON.stringify(capA)}`);
  useCart.getState().clear();

  // A stored cart can exceed what the server accepts; the checkout page says so before the button.
  check(cart.cartOverLimit([line("A", 20), line("B", 20), line("C", 20)]) !== null && /60 stuks/.test(cart.cartOverLimit([line("A", 20), line("B", 20), line("C", 20)]) ?? ""), "cartOverLimit(): 3 x 20 units is reported (with the count) so /checkout can say it before the order button", "cartOverLimit missed 60 units");
  check(cart.cartOverLimit(Array.from({ length: limits.MAX_LINES_PER_ORDER + 1 }, (_, i) => line(`S${i}`, 1))) !== null, "cartOverLimit(): more than the allowed number of lines is reported", "cartOverLimit missed 16 lines");
  check(cart.cartOverLimit([line("A", 20), line("B", 20)]) === null, "[guard] cartOverLimit(): a normal cart is fine", "cartOverLimit refused a normal cart");

  // The Idempotency-Key survives a second tab and a reload, but not a different order or half an hour.
  const k1 = attempt.newAttemptKey();
  attempt.writeSharedAttempt("fp-1", k1, 1_000);
  check(attempt.readSharedAttempt("fp-1", 2_000) === k1, "Idempotency-Key: a second tab submitting the same order reads the same key", "Idempotency-Key: not shared");
  check(attempt.readSharedAttempt("fp-OTHER", 2_000) === null, "Idempotency-Key: a different order (other address, cart or method) does not reuse it", "Idempotency-Key: reused for a different order");
  check(attempt.readSharedAttempt("fp-1", 1_000 + attempt.ATTEMPT_TTL_MS + 1) === null, "Idempotency-Key: forgotten after 30 minutes", "Idempotency-Key: never expires");
  attempt.clearSharedAttempt();
  check(attempt.readSharedAttempt("fp-1", 2_000) === null, "Idempotency-Key: cleared when the confirmation page opens", "Idempotency-Key: clear() did nothing");
}

// ───────────────────────────── middleware ─────────────────────────────
async function middlewareChecks() {
  process.env.CLERK_SECRET_KEY = "sk_test_qa";
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_qa";
  delete process.env.DEMO_MODE;
  const { NextRequest } = await import("next/server");
  const mw = (await import("../src/middleware")).default;
  const run = (url: string) => mw(new NextRequest(url), { waitUntil() {} } as never) as Promise<Response>;
  for (const path of ["/onderdelen/%ZZ", "/foutcodes/%E0%A4%A", "/merken/%ZZ", "/merken/Bosch/%ZZ"]) {
    const res = await run(`http://localhost:3000${path}`);
    check(res.status === 400, `Middleware: ${path} -> 400 (was a 500 on a production build)`, `Middleware: ${path} -> ${res.status}`);
  }
  const ok = await run("http://localhost:3000/onderdelen/WF-PUMP-01");
  check(ok.status === 200, "Middleware: [guard] a normal path passes through (200)", `Middleware: normal path -> ${ok.status}`);
  const order = await run("http://localhost:3000/bestelling/abc123?t=secret");
  check(order.status !== 307 && order.status !== 308 && order.status !== 401, `Middleware: /bestelling/<id> is no longer sent to sign-in (${order.status}); a guest can reach the page`, `Middleware: /bestelling redirected/denied (${order.status})`);
  check(order.headers.get("referrer-policy") === "no-referrer" && /noindex/.test(order.headers.get("x-robots-tag") ?? "") && /no-store/.test(order.headers.get("cache-control") ?? ""), "Middleware: /bestelling responses carry Referrer-Policy no-referrer, X-Robots-Tag noindex and no-store", `Middleware order headers: ${[...order.headers].map(([k, v]) => `${k}=${v}`).join(";")}`);
  // Exact outcome, not "anything >= 300" (a 500 would have passed that): without a valid session a protected
  // page redirects to /inloggen and a protected API answers 401 JSON.
  const dash = await run("http://localhost:3000/dashboard");
  check(dash.status === 307 && new URL(dash.headers.get("location") ?? "", "http://localhost:3000").pathname === "/inloggen", "Middleware: [guard] /dashboard is still protected (307 to /inloggen)", `Middleware: dashboard -> ${dash.status} ${dash.headers.get("location")}`);
  const adm = await run("http://localhost:3000/admin");
  check(adm.status === 307 && new URL(adm.headers.get("location") ?? "", "http://localhost:3000").pathname === "/inloggen", "Middleware: [guard] /admin is still protected (307 to /inloggen)", `Middleware: admin -> ${adm.status} ${adm.headers.get("location")}`);
  const apiOrders = await run("http://localhost:3000/api/orders");
  check(apiOrders.status === 401, "Middleware: [guard] /api/orders without a session answers 401", `Middleware: /api/orders -> ${apiOrders.status}`);
  check(!order.headers.has("referrer-policy") === false && !(await run("http://localhost:3000/onderdelen")).headers.get("x-robots-tag"), "Middleware: the order-page headers are not added to other pages", "Middleware: headers leak to other pages");
}

// ───────────────────────────── HTTP checks against a running server ─────────────────────────────
async function httpChecks(base: string, expect: "guest" | "admin") {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const inv = await import("../src/lib/invoicing");
  const tag = `[http ${expect}]`;
  const ids: string[] = [];
  try {
    const user = await prisma.user.upsert({ where: { email: `owner@${DOMAIN}` }, update: {}, create: { email: `owner@${DOMAIN}`, name: "QA Owner" } });
    const part = await prisma.part.create({ data: { sku: `${SKU_PREFIX}HTTP-${Date.now().toString(36)}`, name: "QA HTTP onderdeel", brand: "QA", category: "OTHER", priceEur: 20, stock: 50 } });
    const mk = async (status: string, method: "BANK_TRANSFER" | "STRIPE") => {
      const total = 20 + 5.95;
      const vat = inv.splitVatInclusive(total);
      const order = await prisma.order.create({
        data: {
          userId: user.id, email: `buyer${Math.random().toString(36).slice(2, 7)}@${DOMAIN}`, status, paymentMethod: method, subtotalEur: 20, shippingEur: 5.95, totalEur: total, vatRate: vat.vatRate, vatEur: vat.vatEur,
          accessToken: inv.newAccessToken(), phone: "06 12345678", dueAt: method === "BANK_TRANSFER" ? new Date(Date.now() + 14 * 86400000) : null,
          shippingAddress: JSON.stringify({ name: "Piet Jansen", street: "Teststraat", houseNumber: "1", postalCode: "1011 AB", city: "Amsterdam", country: "NL" }),
          items: { create: [{ partId: part.id, quantity: 1, unitPrice: 20 }] },
        },
      });
      ids.push(order.id);
      if (status !== "PENDING") await inv.issueInvoiceForOrder(order.id);
      return prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { invoice: true } });
    };
    const get = async (path: string) => {
      const res = await fetch(base + path, { redirect: "manual" });
      return { status: res.status, headers: res.headers, text: await res.text() };
    };
    const bank = await mk("OPENSTAAND", "BANK_TRANSFER");
    const paidCard = await mk("PAID", "STRIPE");
    const pendingCard = await mk("PENDING", "STRIPE");
    const wantsAccess = expect === "admin";

    for (const [label, path, expected] of [
      ["no token", `/bestelling/${bank.id}`, wantsAccess ? 200 : 404],
      ["wrong token", `/bestelling/${bank.id}?t=${"0".repeat(48)}`, wantsAccess ? 200 : 404],
      ["token of another order", `/bestelling/${bank.id}?t=${paidCard.accessToken}`, wantsAccess ? 200 : 404],
      ["right token", `/bestelling/${bank.id}?t=${bank.accessToken}`, 200],
      ["invoice, no token", `/bestelling/${bank.id}/factuur`, wantsAccess ? 200 : 404],
      ["invoice, wrong token", `/bestelling/${bank.id}/factuur?t=${"f".repeat(48)}`, wantsAccess ? 200 : 404],
      ["invoice, right token", `/bestelling/${bank.id}/factuur?t=${bank.accessToken}`, 200],
      ["unknown order", `/bestelling/cl0000000000000000000000x?t=${bank.accessToken}`, 404],
    ] as const) {
      const r = await get(path);
      check(r.status === expected, `${tag} access matrix: ${label} -> ${r.status}`, `${tag} access matrix: ${label} -> ${r.status}, expected ${expected}`);
    }
    // The 404 for "not yours" and for "does not exist" looks the same.
    if (!wantsAccess) {
      const a = await get(`/bestelling/${bank.id}`);
      const b = await get(`/bestelling/cl0000000000000000000000x`);
      const strip = (t: string) => t.replace(/<script[\s\S]*?<\/script>/g, "").replace(/\s+/g, " ").replace(/"[^"]*cl0000000000000000000000x[^"]*"/g, "").slice(0, 2000);
      check(a.status === 404 && b.status === 404 && /niet gevonden/i.test(a.text) && /niet gevonden/i.test(b.text), `${tag} a wrong token and a nonexistent order get the same 404 page (no oracle for which ids exist)`, `${tag} oracle: ${a.status}/${b.status}`);
      void strip;
    }

    const page = await get(`/bestelling/${bank.id}?t=${bank.accessToken}&success=1`);
    const html = page.text;
    const plain = html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
    const seller = JSON.parse(bank.invoice!.sellerJson);
    check(plain.includes(bank.invoice!.number) && plain.includes(seller.iban) && /25,95/.test(plain) && plain.includes("Betaal uiterlijk"), `${tag} the confirmation page shows invoice number, IBAN, total 25,95 and due date FROM THE DATABASE`, `${tag} payment details missing on the confirmation page`);
    check(/Betalingskenmerk/.test(plain) && /verzenden pas/i.test(plain) && /betaling bij ons binnen is/i.test(plain), `${tag} the page says the order ships after the payment arrives, and names the reference`, `${tag} shipping-after-payment wording missing`);
    check(!/We hebben een bevestiging gestuurd/i.test(plain) && !/hebben deze gegevens ook naar/i.test(plain), `${tag} no 'we sent a confirmation' claim when no mail was handed over (no ?m=1)`, `${tag} the page claims a mail that was never sent`);
    const withMail = (await get(`/bestelling/${bank.id}?t=${bank.accessToken}&success=1&m=1`)).text.replace(/<[^>]+>/g, " ");
    check(/hebben deze gegevens ook naar/i.test(withMail), `${tag} with ?m=1 (mail handed over) the page says so`, `${tag} ?m=1 not honoured`);
    const reload = (await get(`/bestelling/${bank.id}?t=${bank.accessToken}`)).text.replace(/<[^>]+>/g, " ");
    check(reload.includes(seller.iban) && reload.includes(bank.invoice!.number), `${tag} reload without the success flag: the payment details are still there`, `${tag} payment details lost on reload`);
    check(page.headers.get("referrer-policy") === "no-referrer" && /noindex/.test(page.headers.get("x-robots-tag") ?? "") && /<meta name="robots" content="[^"]*noindex/.test(html) && /<meta name="referrer" content="no-referrer"/.test(html), `${tag} the order page sends Referrer-Policy no-referrer + noindex (header and meta)`, `${tag} order page headers: rp=${page.headers.get("referrer-policy")} robots=${page.headers.get("x-robots-tag")}`);
    check(new RegExp(`href="/bestelling/${bank.id}/factuur\\?t=${bank.accessToken}"`).test(html), `${tag} the invoice link carries the token`, `${tag} invoice link without token`);

    const invoice = (await get(`/bestelling/${bank.id}/factuur?t=${bank.accessToken}`)).text.replace(/<[^>]+>/g, " ");
    check(/Vervaldatum/.test(invoice) && /IBAN/.test(invoice) && /Betalingskenmerk/.test(invoice) && /Openstaand/.test(invoice), `${tag} the invoice shows Vervaldatum, a labelled IBAN, Betalingskenmerk and the stamp Openstaand`, `${tag} invoice lacks due date / IBAN label / reference / stamp`);
    const paidInvoice = (await get(`/bestelling/${paidCard.id}/factuur?t=${paidCard.accessToken}`)).text.replace(/<[^>]+>/g, " ");
    check(/Betaald/.test(paidInvoice) && /iDEAL of kaart/.test(paidInvoice) && !/Betalingskenmerk/.test(paidInvoice), `${tag} a paid card order's invoice is stamped Betaald with no payment instruction`, `${tag} paid invoice wrong`);
    const pend = (await get(`/bestelling/${pendingCard.id}?t=${pendingCard.accessToken}&success=1`)).text.replace(/<[^>]+>/g, " ");
    check(/We verwerken je betaling/.test(pend) && !/Bedankt, je betaling is ontvangen/.test(pend), `${tag} back from Stripe but still PENDING: the page says it is processing, not 'paid'`, `${tag} PENDING order page claims payment`);
    const paid = (await get(`/bestelling/${paidCard.id}?t=${paidCard.accessToken}&success=1`)).text.replace(/<[^>]+>/g, " ");
    check(/Bedankt, je betaling is ontvangen/.test(paid) && !/We hebben een bevestiging gestuurd/.test(paid), `${tag} a PAID order says so, with no unverifiable mail claim`, `${tag} PAID order wording wrong`);
    const demo = await get("/bestelling/demo-ABC123");
    check(wantsAccess ? demo.status === 200 : demo.status === 404, `${tag} a demo- order id: ${wantsAccess ? "labelled demo page outside production" : "404 in production"} (${demo.status})`, `${tag} demo id answered ${demo.status}`);

    // checkout page wording (static)
    const checkout = await get("/checkout");
    const cplain = checkout.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    check(checkout.status === 200, `${tag} /checkout answers 200`, `${tag} /checkout ${checkout.status}`);
    if (!/niet mogelijk/.test(cplain)) {
      check(/Vooruitbetalen per bankoverschrijving/.test(cplain) && !/Op rekening/i.test(cplain), `${tag} checkout: 'Vooruitbetalen per bankoverschrijving', no 'Op rekening'`, `${tag} checkout wording`);
      check(!/Bancontact|Belgi/i.test(cplain) && !/\bBE\b/.test(cplain), `${tag} checkout: no Belgium / Bancontact wording`, `${tag} checkout mentions Belgium/Bancontact`);
      check(/Verzendkosten/.test(cplain) && /gratis vanaf/i.test(cplain) && /incl\. btw|inclusief btw/i.test(cplain), `${tag} checkout: shipping cost, free-shipping threshold and incl. btw are stated at the top`, `${tag} checkout lacks shipping/btw statement`);
      check(/href="\/voorwaarden"/.test(checkout.text) && /href="\/privacy"/.test(checkout.text) && /href="\/retourvoorwaarden"/.test(checkout.text), `${tag} checkout: links to voorwaarden, privacy and retourvoorwaarden next to the order button`, `${tag} checkout lacks the legal links`);
      check(/Telefoonnummer/.test(cplain) && /Opmerking voor de bezorger/.test(cplain), `${tag} checkout asks for a phone number and an optional delivery note`, `${tag} checkout lacks phone/note`);
      check(/Bestelling met betalingsverplichting/.test(cplain), `${tag} checkout: the button states the payment obligation`, `${tag} button label changed`);
      // The stored cart exists only in the browser: the server HTML must print the placeholder for every
      // amount (an empty cart would print "Totaal 5,95" with shipping and mismatch the client render).
      const summary = /Jouw bestelling([\s\S]*?)Bestelling met betalingsverplichting/.exec(cplain)?.[1] ?? "";
      check(summary.length > 0 && !/\d,\d\d/.test(summary) && (summary.match(/—/g) ?? []).length >= 4, `${tag} checkout SSR: the order summary prints "—" for subtotal, shipping, btw and total and no amount at all (hydration)`, `${tag} checkout SSR summary prints an amount: ${summary.slice(0, 200)}`);
    }

    // Decision D15 / rehearsal D1+R2-05: no invented contact address anywhere; every address comes from COMPANY_EMAIL.
    // QA_COMPANY_EMAIL = the COMPANY_EMAIL the server was started with (default: the one in DEFAULT_QA_COMPANY);
    // QA_EXPECT_EMAIL=none when the server was BUILT and started WITHOUT it (then the pages say "volgt na inschrijving"). Both: the legal pages
    // are prerendered at build time with the COMPANY_* values of that build (rehearsal R2-19), so a server built with the address and started
    // without it still prints the address on them; only /contact, which reads the query string, follows the runtime value.
    {
      // Neither variable set (the CI job starts its server without COMPANY_EMAIL): ask the running server what it was started with.
      // /contact follows the runtime value. The checks below stay meaningful either way: with an address EVERY page must print it,
      // without one every page must say 'volgt na inschrijving' and carry no mailto.
      const explicitMail = process.env.QA_COMPANY_EMAIL !== undefined || process.env.QA_EXPECT_EMAIL !== undefined;
      const detected = explicitMail ? null : /href="mailto:([^"?]+)/.exec((await get("/contact")).text)?.[1] ?? null;
      const serverMail = process.env.QA_COMPANY_EMAIL ?? detected ?? DEFAULT_QA_COMPANY.COMPANY_EMAIL;
      const noMail = process.env.QA_EXPECT_EMAIL === "none" || (!explicitMail && detected === null);
      const MAIL_PAGES = ["/contact", "/privacy", "/voorwaarden", "/retourvoorwaarden", "/garantie", "/klachten", "/pers", "/help/klacht-indienen", "/help/is-mijn-data-veilig", "/help/garantie-uitleg", "/help/abonnement-opzeggen", "/help/levertijden-verzending", "/help/welk-onderdeel-heb-ik-nodig"];
      const wrong: string[] = [];
      const missing: string[] = [];
      for (const path of MAIL_PAGES) {
        const r = await get(path);
        // React puts <!-- --> between adjacent text nodes (the help renderer emits one node per character): drop them first.
        const html = r.text.replace(/<!--[\s\S]*?-->/g, "");
        const text = html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
        const hits = [...(html.match(/[A-Za-z0-9._-]+@(?:[A-Za-z0-9-]+\.)*wasfix\.nl/gi) ?? [])];
        if (r.status !== 200 || hits.length > 0 || /contact-formulier|Formulier:|contact\?onderwerp=klacht/i.test(text)) wrong.push(`${path}: ${r.status} ${hits.join(",")}`);
        if (noMail ? !/volgt na inschrijving/.test(text) || r.text.includes("mailto:") : !text.includes(serverMail)) missing.push(path);
      }
      check(wrong.length === 0, `${tag} ${MAIL_PAGES.length} pages (contact, privacy, voorwaarden, retour, garantie, klachten, pers, help articles) print no @wasfix.nl mailbox and refer to no contact form`, `${tag} invented mailbox or form reference: ${wrong.join(" ; ")}`);
      check(missing.length === 0, noMail ? `${tag} without COMPANY_EMAIL every one of those pages says 'volgt na inschrijving' and has no mailto link` : `${tag} every one of those pages prints COMPANY_EMAIL (${serverMail})`, `${tag} COMPANY_EMAIL ${noMail ? "placeholder missing" : "not printed"} on: ${missing.join(", ")}`);
      const retour = (await get("/retourvoorwaarden")).text.replace(/<[^>]+>/g, " ");
      check(noMail ? /volgt na inschrijving/.test(retour) : retour.includes(serverMail), `${tag} the model withdrawal form on /retourvoorwaarden carries the configured address`, `${tag} withdrawal form address wrong`);
      // R2-20: copy that promised what nothing does
      const vs = (await get("/vs/monteur")).text.replace(/<[^>]+>/g, " ");
      const klachten = (await get("/klachten")).text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      const voorwaarden = (await get("/voorwaarden")).text.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
      const helpKlacht = (await get("/help/klacht-indienen")).text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      const predictive = (await get("/tools/predictive")).text.replace(/<[^>]+>/g, " ");
      check(!/Vandaag besteld = morgen/.test(vs) && /betaling binnen is/.test(vs), `${tag} /vs/monteur no longer promises 'Vandaag besteld = morgen' (a bank-transfer order ships after the wire)`, `${tag} /vs/monteur still promises next-day`);
      check(!/24\s?u/.test(klachten) && /binnen 7 werkdagen/.test(klachten) && /binnen 7 werkdagen/.test(voorwaarden) && /binnen 7 werkdagen/.test(helpKlacht) && /30 dagen/.test(klachten) && /30 dagen/.test(helpKlacht) && !/binnen 14 dagen/.test(klachten), `${tag} ONE response time (7 werkdagen) and ONE resolution time (30 dagen) on /klachten, /voorwaarden and the help article (it was 24 u, 2 werkdagen, 14 dagen and 7 werkdagen)`, `${tag} response times differ: klachten ${(klachten.match(/\d+ ?(u|werkdagen|dagen)/g) ?? []).join(",")} help ${(helpKlacht.match(/\d+ ?(u|werkdagen|dagen)/g) ?? []).join(",")}`);
      // The same promise on EVERY page that makes one (/help said 24u next to 7 werkdagen, /retourvoorwaarden promised the RMA number in 24u, /garantie said 5 werkdagen).
      const promisePages: Record<string, string> = {};
      for (const pth of ["/help", "/retourvoorwaarden", "/garantie", "/help/retour-en-restitutie", "/help/garantie-uitleg"]) promisePages[pth] = (await get(pth)).text.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      const stray = Object.entries(promisePages).filter(([, t]) => /\b(24 ?(u|uur)|48 ?uur|[1-6] werkdagen)\b/.test(t)).map(([k, t]) => `${k}: ${(t.match(/\b(24 ?(u|uur)|48 ?uur|[1-6] werkdagen)\b/) ?? [""])[0]}`);
      check(stray.length === 0 && /binnen 7 werkdagen/.test(promisePages["/help"]) && /binnen 7 werkdagen/.test(promisePages["/retourvoorwaarden"]) && /binnen 7 werkdagen/.test(promisePages["/garantie"]) && /binnen 7 werkdagen/.test(promisePages["/help/retour-en-restitutie"]) && /Versie 2\.2/.test(klachten) && /9 oktober 2026/.test(klachten),
        `${tag} the response time is 7 werkdagen on /help, /retourvoorwaarden (RMA number), /garantie (assessment) and the help articles too, with no 24u / 48 uur / 5 werkdagen left, and /klachten carries the bumped version label`,
        `${tag} other promises left: ${stray.join(" ; ")} klachten label ${(klachten.match(/Laatste update[^·]*· Versie [\d.]+/) ?? [""])[0]}`);
      check(!/aanmaning|veertiendagenbrief|handelsrente|netto na bevestigingsmail|MONTEUR_PRO|BEDRIJF,/.test(voorwaarden) && /geen incassokosten/.test(voorwaarden) && /pas nadat de betaling/.test(voorwaarden), `${tag} the terms no longer describe aanmaning, incassokosten or net-14 credit that nothing does, and say shipping follows payment; no raw plan ids`, `${tag} terms 7.2/7.3 still describe collection/credit or plan ids`);
      check(!/bekende failure-rates/.test(predictive) && /vuistregels/.test(predictive) && !/90%/.test((await get("/tools/predictive")).text), `${tag} the predictive tool does not claim 'bekende failure-rates' or an unsourced 90%`, `${tag} predictive tool copy`);
      // D7: the member price asks /api/user/plan on behalf of every visitor. The middleware answers a guest with a 401 (unchanged, the
      // post-payment poll relies on it), so the page must not ASK when nobody can be signed in: no Clerk in a production build.
      const planGuest = await fetch(`${base}/api/user/plan`);
      const memberPrice = fs.readFileSync(path.join(process.cwd(), "src/components/member-price.tsx"), "utf8");
      // A demo-mode dev server (expect=admin) makes every visitor the superadmin, so /api/user/plan answers 200 there; the 401 is the production guest contract.
      check((expect === "admin" || planGuest.status === 401) && /process\.env\.NEXT_PUBLIC_CLERK_ENABLED !== "true"\) return process\.env\.NODE_ENV === "production"/.test(memberPrice), `${tag} /api/user/plan still answers a guest 401 (the poll relies on it), and member-price.tsx no longer asks when no session can exist (no Clerk in a production build)`, `${tag} D7: plan ${planGuest.status}`);
      // D7, behaviour: a real browser on the production build requests /api/user/* zero times as a guest (the check above only reads source).
      // Only meaningful for the production build the guest run is made against (no Clerk there); a dev/demo server can legitimately ask.
      if (expect === "guest") {
        const pw = loadPlaywright();
        if (!pw) {
          if (process.env.QA_REQUIRE_BROWSER === "1") check(false, `${tag} D7 browser check: Chromium/Playwright not found`);
          else log.push(`ℹ️  SKIPPED the D7 browser check: Chromium/Playwright not found`);
        } else {
          const browser = await pw.chromium.launch();
          try {
            const page = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
            const asked: string[] = [];
            page.on("request", (rq: { url: () => string }) => { if (/\/api\/user\//.test(rq.url())) asked.push(rq.url()); });
            for (const pth of ["/", "/onderdelen", "/onderdelen/WF-PUMP-01", "/checkout"]) {
              await page.goto(`${base}${pth}`, { waitUntil: "networkidle" });
              await page.waitForTimeout(400);
            }
            check(asked.length === 0, `${tag} a guest browsing /, /onderdelen, a part page and /checkout in a real browser (375 px) makes ZERO requests to /api/user/* (no 401 in the console of every visitor)`, `${tag} D7: the browser asked ${asked.join(", ")}`);
          } finally {
            await browser.close();
          }
        }
      }
      // /contact?onderwerp= is a plain object lookup in the page: inherited names must not reach the page as a function (500 on every hit)
      const hostile = await Promise.all(["constructor", "__proto__", "toString", "hasOwnProperty", "klacht", "monteur-demo"].map(async (v) => [v, (await get(`/contact?onderwerp=${v}`)).status] as const));
      const demoSubject = (await get("/contact?onderwerp=monteur-demo")).text;
      check(hostile.every(([, s]) => s === 200) && /Demo aanvragen voor mijn bedrijf/.test(demoSubject), `${tag} /contact?onderwerp=constructor, __proto__, toString, hasOwnProperty, an unknown subject and the real one all answer 200 (the first four were a 500), and the real subject still shows`, `${tag} /contact statuses: ${hostile.map(([v, s]) => `${v}=${s}`).join(" ")}`);
      // R2-06: the share image
      const og = await fetch(`${base}/opengraph-image`);
      const ogBytes = Buffer.from(await og.arrayBuffer());
      check(og.status === 200 && /image\/png/.test(og.headers.get("content-type") ?? "") && ogBytes.length > 5000 && ogBytes.subarray(1, 4).toString() === "PNG" && ogBytes.readUInt32BE(16) === 1200 && ogBytes.readUInt32BE(20) === 630, `${tag} /opengraph-image is a 1200x630 PNG (${ogBytes.length} bytes; what is drawn on it is only checked in source, qa-platform, and by eye)`, `${tag} /opengraph-image: ${og.status} ${og.headers.get("content-type")} ${ogBytes.length}`);
    }
    // R2-04: iDEAL/card is offered only when the server has BOTH Stripe keys. QA_EXPECT_STRIPE=on|off says which the server was started with.
    if (process.env.QA_EXPECT_STRIPE) {
      const on = process.env.QA_EXPECT_STRIPE === "on";
      check(on ? /Direct betalen met iDEAL of kaart/.test(cplain) : !/Direct betalen met iDEAL of kaart/.test(cplain) && /Vooruitbetalen per bankoverschrijving/.test(cplain), `${tag} the checkout page ${on ? "offers" : "does NOT offer"} iDEAL/kaart (QA_EXPECT_STRIPE=${process.env.QA_EXPECT_STRIPE})`, `${tag} checkout page Stripe offer wrong for QA_EXPECT_STRIPE=${process.env.QA_EXPECT_STRIPE}`);
    }

    // malformed escapes
    for (const path of ["/onderdelen/%ZZ", "/foutcodes/%E0%A4%A", "/merken/%ZZ", "/merken/Bosch/%ZZ"]) {
      const r = await get(path);
      check(r.status === 400, `${tag} ${path} -> ${r.status} (expected 400)`, `${tag} ${path} -> ${r.status}`);
    }

    // cart validate over HTTP
    const v = await fetch(`${base}/api/cart/validate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ sku: part.sku, quantity: 99 }, { sku: "NOPE-SKU", quantity: 1 }] }) });
    const vj = (await v.json()) as Json;
    check(v.status === 200 && vj.lines.find((l: Json) => l.sku === part.sku)?.quantity === 20 && vj.lines.find((l: Json) => l.sku === "NOPE-SKU")?.status === "removed", `${tag} POST /api/cart/validate caps the quantity and reports a dead SKU`, `${tag} validate: ${v.status} ${JSON.stringify(vj).slice(0, 200)}`);
    // orders API never shows cost
    const apiOrder = await fetch(`${base}/api/orders/${bank.id}`);
    const apiText = await apiOrder.text();
    check(wantsAccess ? !/"costEur"|"supplier"/.test(apiText) : apiOrder.status === 401 || apiOrder.status === 307, `${tag} /api/orders/<id>: ${wantsAccess ? "no costEur/supplier in the JSON" : "refused without a session"} (${apiOrder.status})`, `${tag} /api/orders leaks cost or is open: ${apiOrder.status} ${apiText.slice(0, 120)}`);
  } finally {
    await prisma.creditNote.deleteMany({ where: { invoice: { orderId: { in: ids } } } });
    await prisma.invoice.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { id: { in: ids } } });
    await prisma.part.deleteMany({ where: { sku: { startsWith: SKU_PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    for (const { year } of await prisma.invoiceSequence.findMany()) {
      const rows = await prisma.invoice.findMany({ where: { year }, select: { number: true } });
      const max = rows.reduce((m, r) => Math.max(m, Number(r.number.slice(-5))), 0);
      await prisma.invoiceSequence.update({ where: { year }, data: { last: max } });
    }
    await prisma.$disconnect();
  }
}

// ───────────────────────────── driver ─────────────────────────────
function runChild(name: string, env: Record<string, string | undefined>, conditions = true) {
  // The middleware imports Clerk, which needs the normal (non react-server) React build.
  const res = spawnSync("npx", ["tsx", ...(conditions ? ["--conditions=react-server"] : []), __filename, `--child=${name}`], {
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 240_000,
  });
  const lines = (res.stdout ?? "").split("\n").filter((l) => l.startsWith("CHK:")).map((l) => l.slice(4));
  if (lines.length === 0) log.push(`❌ child ${name} produced no results: ${(res.stderr ?? "").slice(-400)} ${(res.stdout ?? "").slice(-300)}`);
  log.push(...lines);
  if (res.status !== 0 && lines.length > 0 && !lines.some((l) => l.startsWith("❌"))) log.push(`❌ child ${name} exited with ${res.status}: ${(res.stderr ?? "").slice(-300)}`);
}

async function main() {
  if (CHILD === "middleware") {
    await middlewareChecks();
    return;
  }
  if (CHILD === "pure") {
    await pureChecks();
    return;
  }
  if (CHILD === "cart") {
    await cartChecks();
    return;
  }
  if (CHILD) {
    const kind = CHILD as Parameters<typeof inProcessScenarios>[0];
    await inProcessScenarios(kind);
    return;
  }

  // Every group runs in its own process: src/lib/env.ts reads process.env once, at import,
  // so each group needs its environment in place before the first import.
  const base = { DATABASE_URL: dbUrl, QA_REAL_DATABASE_URL: dbUrl };
  runChild("pure", base);
  runChild("cart", base, false);
  runChild("middleware", base, false);
  runChild("guest", base);
  runChild("member", { ...base, DEMO_MODE: "true" });
  runChild("nostripe", { ...base, STRIPE_SECRET_KEY: "" });
  // R2-04: a Stripe secret key without a webhook secret does not make iDEAL/kaart available.
  runChild("stripe-nowebhook", base);
  const prod = { ...base, NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://shop.qa-checkout.test" };
  runChild("prod-ok", prod);
  // Without a public address every link in a mail and every owner notice would point at localhost (the Stripe branch already refused).
  runChild("prod-nourl", { ...prod, NEXT_PUBLIC_APP_URL: "" });
  runChild("prod-localurl", { ...prod, NEXT_PUBLIC_APP_URL: "http://localhost:3000" });
  runChild("prod-nocompany", prod);
  // D15: every fiscal field set, only COMPANY_EMAIL missing: checkout is closed.
  runChild("prod-noemail", prod);
  runChild("prod-baddb", { ...prod, DATABASE_URL: "postgresql://postgres:[YOUR-PASSWORD]@db.x.supabase.co:5432/postgres" });
  runChild("prod-dbdown", { ...prod, DATABASE_URL: "postgresql://wasfix:wasfix@127.0.0.1:1/none?connect_timeout=2" });

  const baseUrl = process.env.QA_BASE_URL;
  if (baseUrl) await httpChecks(baseUrl.replace(/\/$/, ""), process.env.QA_EXPECT === "admin" ? "admin" : "guest");
  else log.push("⚠️  QA_BASE_URL not set: the HTTP checks (access matrix on a live server, checkout wording) were skipped");
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    log.push(`❌ FATAL: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (CHILD) return;
    console.log(log.join("\n"));
    const failures = log.filter((l) => l.startsWith("❌")).length;
    const checks = log.filter((l) => l.startsWith("✅") || l.startsWith("❌")).length;
    console.log(`\n${checks - failures}/${checks} checks passed`);
    if (failures > 0) process.exitCode = 1;
    process.exit();
  });
