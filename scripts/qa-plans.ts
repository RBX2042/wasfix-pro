/**
 * Plans, gating, API keys, sign-in rules, monteur approval, referral rules.
 *
 * Runs the REAL code (auth.ts, the route handlers, the server actions) against
 * a real Postgres. Only two things are stand-ins: the identity provider (Clerk)
 * behind the small IdentityReader seam in src/lib/auth.ts, and Stripe (the local
 * fake in scripts/lib/fake-stripe.ts). Nothing here proves how real Clerk or
 * real Stripe behave; it proves what OUR code does with the answers they give.
 *
 * Sections
 *   1  ADMIN bootstrap: verified/unverified x listed/unlisted, claim rules, hot path, make-admin
 *   2  Plan matrix: every plan/status/role against every gated surface
 *   3  Trial discount (D13) through the real /api/checkout
 *   4  API: 1000/hour proof, plan-bound keys, account-wide allowance, metering after validation
 *   5  Monteur approval grants nothing and mails the applicant
 *   6  Referral rules (programme ON), then the programme OFF by default (child process)
 *   7  Clerk user.deleted ends the Stripe subscription; account erasure kills old order links
 *   8  Banner / consent / copy that must agree with the code
 *
 * Usage:  DATABASE_URL=postgresql://... npx tsx scripts/qa-plans.ts
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";

const repo = path.resolve(__dirname, "..");
const PHASE = process.env.QA_PLANS_PHASE ?? "main";
const RUN = Date.now().toString(36);
const DOMAIN = "qa-plans.test";

const log: string[] = [];
const check = (cond: boolean, ok: string, bad: string) => log.push(cond ? `✅ ${ok}` : `❌ ${bad}`);
const section = (title: string) => log.push(`\n── ${title}`);

// ─── Environment: not demo mode, no Stripe/Resend unless a section adds them ───
if (PHASE === "noclerk") {
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
} else {
  process.env.CLERK_SECRET_KEY = "sk_test_qa_plans";
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_qa_plans";
}
delete process.env.DEMO_MODE;
// "off": explicitly false. "unset": the variable does not exist at all, which is what a fresh deployment looks like.
if (PHASE === "unset") delete process.env.NEXT_PUBLIC_FEATURE_REFERRAL;
else process.env.NEXT_PUBLIC_FEATURE_REFERRAL = PHASE === "off" ? "false" : "true";
delete process.env.RESEND_API_KEY;
// The address the Clerk webhook test promotes (section 9); env.ts reads ADMIN_EMAILS once, at import.
const WEBHOOK_ADMIN = `webhook-admin-${RUN}@${DOMAIN}`;
process.env.ADMIN_EMAILS = WEBHOOK_ADMIN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.DISCORD_WEBHOOK_URL;
delete process.env.ORDER_NOTIFY_EMAIL;
delete process.env.CLERK_WEBHOOK_SECRET;
delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
process.env.CLERK_WEBHOOK_ALLOW_UNSIGNED = "true";
// The subscribe route refuses to start without a configured price per plan (env.ts reads these once, at import).
process.env.STRIPE_PRICE_PARTICULIER = "price_qa_plans_particulier";
process.env.STRIPE_PRICE_MONTEUR = "price_qa_plans_monteur";
process.env.STRIPE_PRICE_BEDRIJF = "price_qa_plans_bedrijf";
Object.assign(process.env, {
  COMPANY_NAME: "WasFix Test B.V.", COMPANY_STREET: "Teststraat 1", COMPANY_POSTAL_CODE: "1011 AB", COMPANY_CITY: "Amsterdam",
  COMPANY_KVK: "90000001", COMPANY_VAT: "NL900000010B01", COMPANY_IBAN: "NL02ABNA0123456789", COMPANY_EMAIL: `qa@${DOMAIN}`,
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function main() {
  // ── Module loading: no server-only, no real cache revalidation, a captured e-mail ──
  const M = Module as unknown as { _load: (...a: unknown[]) => unknown; _resolveFilename: (...a: unknown[]) => string };
  const origLoad = M._load;
  const emailPath = path.join(repo, "src/lib/email.ts");
  const sentMail: { template: string; to: string; subject: string; html: string }[] = [];
  let mailOk = false;
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
      return { ...real, sendMail: async (o: { template: string; to: string; subject: string; html: string }) => { sentMail.push(o); return mailOk ? { ok: true } : { ok: false, error: "qa" }; } };
    }
    return origLoad.apply(this, args);
  };

  // Slack stand-in: what the owner is told.
  const slackBodies: string[] = [];
  const slack = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { slackBodies.push(body); res.statusCode = 200; res.end("ok"); });
  });
  await new Promise<void>((r) => slack.listen(0, "127.0.0.1", r));
  process.env.SLACK_WEBHOOK_URL = `http://127.0.0.1:${(slack.address() as AddressInfo).port}/hook`;

  // Capture the application's own log lines (promotion log, warnings).
  const captured: string[] = [];
  for (const k of ["log", "info", "warn", "error", "debug"] as const) {
    (console as unknown as Record<string, (...a: unknown[]) => void>)[k] = (...a: unknown[]) => { captured.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };
  }
  const realLog = (s: string) => process.stdout.write(s + "\n");

  // tsx compiles .tsx with the classic JSX transform (tsconfig has jsx: preserve), which needs React in scope.
  (globalThis as unknown as { React: unknown }).React = await import("react");
  const { NextRequest } = await import("next/server");
  const { prisma } = await import("../src/lib/prisma");
  const auth = await import("../src/lib/auth");
  const apiAuth = await import("../src/lib/api-auth");
  const subscription = await import("../src/lib/subscription");
  const plansLib = await import("../src/lib/plans");
  const entitlements = await import("../src/lib/entitlements");
  const referrals = await import("../src/lib/referrals");
  const makeAdminScript = await import("./make-admin");
  const approval = await import("../src/lib/monteur-approval");
  const { notifyError, _resetNotifyStateForTests } = await import("../src/lib/notify");
  void notifyError;

  let counter = 0;
  const email = (tag: string) => `${tag}${++counter}.${RUN}@${DOMAIN}`;
  let clerkSeq = 0;
  const clerkId = () => `user_qa_${RUN}_${++clerkSeq}`;
  let ipSeq = 0;
  const freshIp = () => `10.77.${(ipSeq >> 8) & 255}.${++ipSeq & 255}`;
  const settle = () => new Promise((r) => setTimeout(r, 250));

  // The identity the "browser" is signed in as.
  let identity: import("../src/lib/auth").ClerkIdentity | null = null;
  auth._setIdentityReaderForTests(async () => identity);
  const signInAs = (row: { clerkId: string | null; email: string }, over: Partial<import("../src/lib/auth").ClerkIdentity> = {}) => {
    identity = { clerkId: row.clerkId ?? clerkId(), email: row.email, emailVerified: true, name: "QA Gebruiker", ...over };
  };
  const signOut = () => { identity = null; };

  const mkUser = (o: { plan?: string; role?: string; status?: string | null; periodEnd?: Date | null; cancelAtPeriodEnd?: boolean; tag?: string; stripeSubId?: string; stripeCustomerId?: string } = {}) =>
    prisma.user.create({
      data: {
        email: email(o.tag ?? "u"), clerkId: clerkId(), name: "QA Gebruiker", role: o.role ?? "CONSUMER", plan: o.plan ?? "FREE",
        stripeSubStatus: o.status ?? null, stripeCurrentPeriodEnd: o.periodEnd ?? null, stripeCancelAtPeriodEnd: o.cancelAtPeriodEnd ?? false,
        stripeSubId: o.stripeSubId ?? null, stripeCustomerId: o.stripeCustomerId ?? null,
      },
    });
  const DAY = 86_400_000;
  const days = (n: number) => new Date(Date.now() + n * DAY);

  /** Every React element in a rendered (not yet expanded) tree that matches; walks props.children and other props that hold elements. */
  type El = { type: unknown; props: Record<string, unknown> };
  const findElements = (node: unknown, pred: (el: El) => boolean, out: El[] = []): El[] => {
    if (Array.isArray(node)) { node.forEach((n) => findElements(n, pred, out)); return out; }
    if (node && typeof node === "object" && "props" in node && "type" in node) {
      const el = node as El;
      if (pred(el)) out.push(el);
      for (const v of Object.values(el.props ?? {})) if (v && typeof v === "object") findElements(v, pred, out);
    }
    return out;
  };

  const apiKeyOf = async (userId: string) => {
    const full = apiAuth.generateApiKey("live");
    await prisma.apiKey.create({ data: { userId, name: "qa", prefix: apiAuth.keyPrefix(full), hash: apiAuth.hashApiKey(full), scopes: apiAuth.DEFAULT_SCOPES.join(","), rateLimit: 1000 } });
    return full;
  };
  const req = (url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    new NextRequest(`http://localhost${url}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", "x-vercel-forwarded-for": freshIp(), ...(init.headers ?? {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

  const keysRoute = await import("../src/app/api/dashboard/api-keys/route");
  const planRoute = await import("../src/app/api/user/plan/route");
  const validateRoute = await import("../src/app/api/cart/validate/route");
  const partsRoute = await import("../src/app/api/v1/parts/[sku]/route");
  const codesRoute = await import("../src/app/api/v1/errorcodes/[brand]/[code]/route");
  const diagnoseRoute = await import("../src/app/api/v1/diagnose/route");
  const healthRoute = await import("../src/app/api/v1/health/route");

  const part = await prisma.part.create({ data: { sku: `QAP-${RUN}`, name: "QA onderdeel", brand: "QA", category: "OTHER", priceEur: 20, costEur: 8, costSource: "QUOTE", stock: 500 } });
  const cleanupParts = async () => { await prisma.part.deleteMany({ where: { sku: { startsWith: `QAP-${RUN}` } } }).catch(() => null); };

  // ════════════════════════ 1. ADMIN bootstrap ════════════════════════
  section("1. ADMIN bootstrap (decision D7)");
  {
    // Run-specific: a fixed address left behind by an interrupted run made the next run fail its first check.
    const admins = [`owner-${RUN}@` + DOMAIN];
    const sync = (id: import("../src/lib/auth").ClerkIdentity) => auth.syncSignedInUser(id, { adminEmails: admins });
    const listed = `owner-${RUN}@${DOMAIN}`;

    check(JSON.stringify(auth.parseAdminEmails(" A@x.nl, b@y.nl;C@Z.nl  nope, ,d@e.nl ")) === JSON.stringify(["a@x.nl", "b@y.nl", "c@z.nl", "d@e.nl"]), "ADMIN_EMAILS: comma/semicolon/space separated, lower-cased, non-addresses ignored", "ADMIN_EMAILS parse wrong");

    // verified + listed -> ADMIN, logged with the user id and without the address
    captured.length = 0;
    const a = await sync({ clerkId: clerkId(), email: `  ${listed.toUpperCase()} `, emailVerified: true, name: "Eigenaar" });
    const promoLog = captured.filter((l) => /ADMIN_EMAILS promotion/.test(l));
    check(a.role === "ADMIN" && a.email === listed, "Verified + listed (new account, e-mail typed in capitals with spaces): ADMIN, address stored normalised", `verified+listed gave ${a.role} / ${a.email}`);
    check(promoLog.length === 1 && promoLog[0].includes(a.id) && !promoLog[0].toLowerCase().includes(listed) && promoLog[0].includes("[WARN]"), "Promotion is logged once, at warn level, with the user id and NOT the address", `promotion log: ${JSON.stringify(promoLog)}`);

    // unverified + listed -> no promotion; address not stored (placeholder)
    const listed2 = `owner2-${RUN}@${DOMAIN}`;
    const unv = await auth.syncSignedInUser({ clerkId: clerkId(), email: listed2, emailVerified: false, name: "Nep" }, { adminEmails: [listed2] });
    check(unv.role === "CONSUMER" && auth.isPlaceholderEmail(unv.email) && !unv.email.includes("owner2-"), "Unverified + listed: stays CONSUMER, and the typed address is not stored (placeholder row)", `unverified+listed gave ${unv.role} / ${unv.email}`);

    // verified + unlisted -> CONSUMER
    const vu = await sync({ clerkId: clerkId(), email: email("plain"), emailVerified: true, name: "x" });
    check(vu.role === "CONSUMER", "Verified + not listed: CONSUMER", `verified+unlisted gave ${vu.role}`);

    // listed but row already ADMIN -> no write, no log (updatedAt unchanged)
    const before = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    captured.length = 0;
    await new Promise((r) => setTimeout(r, 15));
    const again = await auth.syncSignedInUser({ clerkId: before.clerkId!, email: listed, emailVerified: true, name: before.name }, { adminEmails: admins });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    check(again.role === "ADMIN" && captured.filter((l) => /promotion/.test(l)).length === 0, "Listed but already ADMIN: no second promotion log", `second promotion logged: ${captured.length}`);
    check(after.updatedAt.getTime() === before.updatedAt.getTime(), "Hot path: an unchanged sign-in writes nothing (updatedAt untouched; one SELECT)", `row was rewritten: ${before.updatedAt.toISOString()} -> ${after.updatedAt.toISOString()}`);
    // A real change is written
    const renamed = await auth.syncSignedInUser({ clerkId: before.clerkId!, email: listed, emailVerified: true, name: "Nieuwe Naam" }, { adminEmails: admins });
    check(renamed.name === "Nieuwe Naam", "A changed name is written", "name change lost");

    // Claim of an existing guest row: verified vs unverified
    const guest = await prisma.user.create({ data: { email: email("guest"), name: "Gast" } });
    const guestOrder = await prisma.order.create({ data: { userId: guest.id, email: guest.email, status: "CANCELLED", paymentMethod: "BANK_TRANSFER", subtotalEur: 10, shippingEur: 0, totalEur: 10, vatRate: 0.21, vatEur: 1.74, shippingAddress: "{}" } });
    const stranger = await sync({ clerkId: clerkId(), email: guest.email, emailVerified: false, name: "Vreemde" });
    const guestAfterStranger = await prisma.user.findUniqueOrThrow({ where: { id: guest.id } });
    const strangerOrders = await prisma.order.count({ where: { userId: stranger.id } });
    check(stranger.id !== guest.id && guestAfterStranger.clerkId === null && strangerOrders === 0 && auth.isPlaceholderEmail(stranger.email), "Claim, UNVERIFIED address: the guest row stays unclaimed and its order history is not reachable", `unverified claim leaked: stranger ${stranger.id} guest clerk ${guestAfterStranger.clerkId} orders ${strangerOrders}`);
    const owner = await sync({ clerkId: clerkId(), email: ` ${guest.email.toUpperCase()}`, emailVerified: true, name: "Echte eigenaar" });
    const ownerOrders = await prisma.order.count({ where: { userId: owner.id } });
    check(owner.id === guest.id && owner.clerkId !== null && ownerOrders === 1, "Claim, VERIFIED address (capitals + space): the guest row is claimed with its order history", `verified claim failed: ${owner.id} vs ${guest.id}, orders ${ownerOrders}`);

    // Verified address held by ANOTHER sign-in: not taken over
    const third = await sync({ clerkId: clerkId(), email: guest.email, emailVerified: true, name: "Derde" });
    check(third.id !== guest.id && auth.isPlaceholderEmail(third.email), "Claim of a row that already belongs to another sign-in: refused (separate account)", `took over a claimed row: ${third.id}`);

    // Unverified first, verified later: the account follows to the row that holds the address
    const guest2 = await prisma.user.create({ data: { email: email("late"), name: "Laat" } });
    const cid = clerkId();
    const first = await sync({ clerkId: cid, email: guest2.email, emailVerified: false, name: "Laat" });
    const second = await sync({ clerkId: cid, email: guest2.email, emailVerified: true, name: "Laat" });
    const placeholderAfter = await prisma.user.findUniqueOrThrow({ where: { id: first.id } });
    check(second.id === guest2.id && placeholderAfter.clerkId === null, "Unverified, then verified: the sign-in is moved to the row that holds the address", `late verification: ${second.id} vs ${guest2.id}`);

    // verified user with no row and a free address: plain create
    const fresh = await sync({ clerkId: clerkId(), email: email("fresh"), emailVerified: true, name: "Nieuw" });
    check(fresh.role === "CONSUMER" && fresh.plan === "FREE" && !auth.isPlaceholderEmail(fresh.email), "New verified user: CONSUMER/FREE with the verified address", "plain signup wrong");

    // no primary address at all -> never trusted
    const noPrimary = await sync({ clerkId: clerkId(), email: null, emailVerified: false, name: null });
    check(auth.isPlaceholderEmail(noPrimary.email) && noPrimary.role === "CONSUMER", "No e-mail address at all: placeholder row, nothing claimed", "no-address user wrong");

    // make-admin.ts: before first login
    const target = email("future-admin");
    const m1 = await makeAdminScript.makeAdmin(prisma, ` ${target.toUpperCase()} `);
    const m2 = await makeAdminScript.makeAdmin(prisma, target);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: target } });
    check(m1.outcome === "created" && m2.outcome === "already_admin" && row.role === "ADMIN" && row.clerkId === null, "make-admin: creates an ADMIN row for an address that never signed in; second run changes nothing", `make-admin: ${m1.outcome}/${m2.outcome}/${row.role}`);
    const squat = await sync({ clerkId: clerkId(), email: target, emailVerified: false, name: "Squatter" });
    check(squat.role === "CONSUMER" && squat.id !== row.id, "make-admin row cannot be claimed with an unverified address", `squatter got ${squat.role}`);
    const real = await sync({ clerkId: clerkId(), email: target, emailVerified: true, name: "Eigenaar" });
    check(real.id === row.id && real.role === "ADMIN", "make-admin row is claimed by the first VERIFIED sign-in and stays ADMIN", `real owner got ${real.role}`);
    const existing = await mkUser({ tag: "promote" });
    const m3 = await makeAdminScript.makeAdmin(prisma, existing.email);
    check(m3.outcome === "promoted" && (await prisma.user.findUniqueOrThrow({ where: { id: existing.id } })).role === "ADMIN", "make-admin: promotes an existing account", `promote: ${m3.outcome}`);
    let refused = false;
    try { await makeAdminScript.makeAdmin(prisma, "geen-adres"); } catch { refused = true; }
    check(refused, "make-admin refuses something that is not an e-mail address", "make-admin accepted garbage");

    // getCurrentUser: no hard-coded superadmin on a non-demo path
    const { isDemoMode } = await import("../src/lib/demo-mode");
    signOut();
    const nobody = await auth.getCurrentUser();
    check(!isDemoMode() && nobody === null, "Not demo mode + signed out: getCurrentUser() is null (the seeded superadmin is never returned)", `non-demo path returned ${JSON.stringify(nobody)}`);
    const sa = await prisma.user.findUnique({ where: { email: auth.SUPERADMIN_EMAIL } });
    check(sa === null || nobody === null, "...even though the superadmin row exists in this database", "superadmin leaked");
  }

  // ════════════════════════ 2. Plan matrix ════════════════════════
  section("2. Plan matrix: every plan x status x role against every gated surface");
  type Case = { name: string; plan: string; status?: string | null; periodEnd?: Date | null; role?: string; cancelAtPeriodEnd?: boolean; effective: string; discount: number; pro: boolean; api: { monthly: number; hourly: number } | null };
  const cases: Case[] = [
    { name: "FREE", plan: "FREE", effective: "FREE", discount: 0, pro: false, api: null },
    { name: "PARTICULIER active", plan: "PARTICULIER", status: "active", periodEnd: days(20), effective: "PARTICULIER", discount: 0.05, pro: false, api: null },
    { name: "PARTICULIER trialing", plan: "PARTICULIER", status: "trialing", periodEnd: days(10), effective: "PARTICULIER", discount: 0, pro: false, api: null },
    { name: "MONTEUR_PRO active", plan: "MONTEUR_PRO", status: "active", periodEnd: days(20), effective: "MONTEUR_PRO", discount: 0.1, pro: true, api: { monthly: 1000, hourly: 120 } },
    { name: "MONTEUR_PRO trialing", plan: "MONTEUR_PRO", status: "trialing", periodEnd: days(10), effective: "MONTEUR_PRO", discount: 0, pro: true, api: { monthly: 1000, hourly: 120 } },
    { name: "MONTEUR_PRO past_due inside the grace window", plan: "MONTEUR_PRO", status: "past_due", periodEnd: days(-2), effective: "MONTEUR_PRO", discount: 0.1, pro: true, api: { monthly: 1000, hourly: 120 } },
    { name: "MONTEUR_PRO past_due beyond the grace window", plan: "MONTEUR_PRO", status: "past_due", periodEnd: days(-10), effective: "FREE", discount: 0, pro: false, api: null },
    { name: "MONTEUR_PRO canceled", plan: "MONTEUR_PRO", status: "canceled", effective: "FREE", discount: 0, pro: false, api: null },
    { name: "MONTEUR_PRO unpaid", plan: "MONTEUR_PRO", status: "unpaid", periodEnd: days(-1), effective: "FREE", discount: 0, pro: false, api: null },
    { name: "MONTEUR_PRO active, cancel at period end", plan: "MONTEUR_PRO", status: "active", periodEnd: days(5), cancelAtPeriodEnd: true, effective: "MONTEUR_PRO", discount: 0.1, pro: true, api: { monthly: 1000, hourly: 120 } },
    { name: "MONTEUR_PRO granted without Stripe (no status)", plan: "MONTEUR_PRO", effective: "MONTEUR_PRO", discount: 0.1, pro: true, api: { monthly: 1000, hourly: 120 } },
    { name: "BEDRIJF active", plan: "BEDRIJF", status: "active", periodEnd: days(20), effective: "BEDRIJF", discount: 0.15, pro: true, api: { monthly: 10000, hourly: 600 } },
    { name: "BEDRIJF trialing", plan: "BEDRIJF", status: "trialing", periodEnd: days(10), effective: "BEDRIJF", discount: 0, pro: true, api: { monthly: 10000, hourly: 600 } },
    { name: "API (legacy internal plan)", plan: "API", effective: "API", discount: 0.1, pro: true, api: { monthly: 100000, hourly: 2000 } },
    { name: "FREE + role TECHNICIAN (approved monteur, no subscription)", plan: "FREE", role: "TECHNICIAN", effective: "FREE", discount: 0, pro: false, api: null },
    { name: "FREE + role BUSINESS", plan: "FREE", role: "BUSINESS", effective: "FREE", discount: 0, pro: false, api: null },
    { name: "MONTEUR_PRO canceled + role TECHNICIAN (lapsed, was approved)", plan: "MONTEUR_PRO", status: "canceled", role: "TECHNICIAN", effective: "FREE", discount: 0, pro: false, api: null },
    { name: "FREE + role ADMIN", plan: "FREE", role: "ADMIN", effective: "FREE", discount: 0, pro: true, api: null },
  ];
  for (const c of cases) {
    const u = await mkUser({ plan: c.plan, role: c.role, status: c.status ?? null, periodEnd: c.periodEnd ?? null, cancelAtPeriodEnd: c.cancelAtPeriodEnd, tag: "mx" });
    signInAs(u);
    const cu = await auth.getCurrentUser();
    const limits = cu ? auth.getPlanLimits(cu) : null;
    const rowsOk = !!cu && cu.plan === c.effective && Math.abs((limits?.partsDiscount ?? -1) - c.discount) < 1e-9 && auth.hasProAccess(cu) === c.pro;
    check(rowsOk, `${c.name}: plan ${c.effective}, parts discount ${c.discount}, Monteur access ${c.pro}`, `${c.name}: got plan ${cu?.plan} discount ${limits?.partsDiscount} pro ${cu ? auth.hasProAccess(cu) : "?"}`);

    // /api/user/plan reflects the same
    const pj = (await (await planRoute.GET()).json()) as Json;
    check(pj.plan === c.effective && Math.abs(pj.partsDiscount - c.discount) < 1e-9 && pj.trialing === (c.status === "trialing"), `${c.name}: /api/user/plan agrees (${pj.plan}, discount ${pj.partsDiscount}, trialing ${pj.trialing})`, `${c.name}: /api/user/plan says ${JSON.stringify(pj)}`);

    // cart/validate (the cart and member price) gives the same discount
    const cart = await validateRoute.POST(req("/api/cart/validate", { method: "POST", body: { items: [{ sku: part.sku, quantity: 1 }] } }));
    const cj = (await cart.json()) as Json;
    check(Math.abs((cj.partsDiscount ?? -1) - c.discount) < 1e-9, `${c.name}: cart discount ${cj.partsDiscount}`, `${c.name}: cart discount ${cj.partsDiscount}, expected ${c.discount}`);

    // monteur server action (CRM) gate
    const { saveCustomer } = await import("../src/app/monteur/_lib/actions");
    const fd = new FormData();
    fd.set("name", `QA Klant ${RUN}`);
    let actionError: string | null = null;
    try {
      const r = await saveCustomer(null, fd);
      actionError = r.ok ? null : (r.error ?? "error");
    } catch (err) { actionError = String(err); }
    const created = await prisma.customer.count({ where: { ownerId: u.id } });
    check(c.pro ? created === 1 : actionError === "Monteur Pro vereist" && created === 0, `${c.name}: CRM action ${c.pro ? "allowed" : "refused"}`, `${c.name}: CRM action gave ${actionError} (customers ${created})`);

    // API key creation
    const created201 = (await keysRoute.POST(req("/api/dashboard/api-keys", { method: "POST", body: { name: "QA key" } })))!;
    const allowed = c.api !== null;
    check(allowed ? created201.status === 201 : created201.status === 403, `${c.name}: API key creation ${allowed ? "allowed" : "refused (403)"}`, `${c.name}: key creation status ${created201.status}`);
    // listing and revoking stay open to the owner
    const listed = (await keysRoute.GET())!;
    check(listed.status === 200, `${c.name}: key list stays readable`, `${c.name}: key list ${listed.status}`);

    // an existing key obeys the owner's CURRENT plan
    const key = await apiKeyOf(u.id);
    const verdict = await apiAuth.verifyApiKey(key);
    if (c.api) {
      check(verdict.ok && verdict.info.monthlyCalls === c.api.monthly && verdict.info.rateLimit === c.api.hourly, `${c.name}: key allowance ${c.api.monthly}/month, ${c.api.hourly}/hour`, `${c.name}: key verdict ${JSON.stringify(verdict)}`);
    } else {
      check(!verdict.ok && verdict.reason === "suspended", `${c.name}: existing key is suspended`, `${c.name}: key verdict ${JSON.stringify(verdict)}`);
    }
  }
  // Same API allowances as the table the docs print and plans.ts promises.
  check(plansLib.PLANS.MONTEUR_PRO.apiCallsPerMonth === apiAuth.PLAN_API_MONTHLY_CALLS.MONTEUR_PRO && plansLib.PLANS.BEDRIJF.apiCallsPerMonth === apiAuth.PLAN_API_MONTHLY_CALLS.BEDRIJF, "plans.ts apiCallsPerMonth equals PLAN_API_MONTHLY_CALLS", "plans.ts and api-auth.ts disagree on calls per month");
  for (const id of ["MONTEUR_PRO", "BEDRIJF"] as const) {
    const f = plansLib.PLANS[id].features.join(" | ");
    check(f.includes(`max. ${apiAuth.PLAN_API_HOURLY_BURST[id]} per uur`) && f.includes(apiAuth.PLAN_API_MONTHLY_CALLS[id].toLocaleString("nl-NL")), `plans.ts ${id} feature text quotes the enforced limits (${apiAuth.PLAN_API_MONTHLY_CALLS[id]}/month, ${apiAuth.PLAN_API_HOURLY_BURST[id]}/hour)`, `plans.ts ${id} text drifted: ${f}`);
  }
  check(!/support|geschiedenis|bulk|witlabel|20 gebruikers/i.test(JSON.stringify(Object.values(plansLib.PLANS).map((p) => p.features))), "plans.ts lists no feature that does not exist (priority support, history, bulk, white label, team seats)", "plans.ts still promises a removed feature");

  // ════════════════════════ 3. Trial discount through the real checkout ════════════════════════
  section("3. Parts discount is off during the trial (D13), through the real /api/checkout");
  {
    const checkout = await import("../src/app/api/checkout/route");
    const place = async (u: { email: string; clerkId: string | null }) => {
      signInAs(u);
      const res = await checkout.POST(req("/api/checkout", {
        method: "POST",
        body: { email: u.email, name: "QA Koper", phone: "06 12345678", paymentMethod: "bank_transfer", address: { street: "Teststraat", houseNumber: "1", postalCode: "1011 AB", city: "Amsterdam" }, items: [{ sku: part.sku, quantity: 2 }] },
      }));
      const j = (await res.json()) as Json;
      const orderId = (j.orderId ?? j.id ?? j.order?.id) as string | undefined;
      const order = orderId ? await prisma.order.findUnique({ where: { id: orderId } }) : null;
      return { status: res.status, json: j, order };
    };
    const trial = await mkUser({ plan: "MONTEUR_PRO", status: "trialing", periodEnd: days(10), tag: "co-trial" });
    const paying = await mkUser({ plan: "MONTEUR_PRO", status: "active", periodEnd: days(25), tag: "co-paying" });
    const lapsed = await mkUser({ plan: "MONTEUR_PRO", status: "past_due", periodEnd: days(-12), tag: "co-lapsed" });
    const t = await place(trial);
    const p = await place(paying);
    const l = await place(lapsed);
    check(t.status === 200 && t.order?.discountEur === 0, `Trialing Monteur Pro: no discount on the order (status ${t.status}, discount ${t.order?.discountEur}, total ${t.order?.totalEur})`, `Trialing Monteur Pro got a discount or no order: ${t.status} ${JSON.stringify(t.json).slice(0, 200)} ${t.order?.discountEur}`);
    check(p.status === 200 && p.order?.discountEur === 4, `Paying Monteur Pro: 10% off EUR 40 = EUR 4 (discount ${p.order?.discountEur})`, `Paying Monteur Pro discount wrong: ${p.status} ${p.order?.discountEur} ${JSON.stringify(p.json).slice(0, 160)}`);
    check(l.status === 200 && l.order?.discountEur === 0, `Past-due beyond the grace window: no discount (${l.order?.discountEur})`, `Lapsed subscriber still discounted: ${l.order?.discountEur}`);
    await prisma.order.updateMany({ where: { id: { in: [t.order?.id, p.order?.id, l.order?.id].filter((x): x is string => !!x) } }, data: { status: "CANCELLED" } });
  }

  // ════════════════════════ 4. API limits ════════════════════════
  section("4. API: hourly limits, plan-bound keys, account-wide allowance, metering");
  {
    const mp = await mkUser({ plan: "MONTEUR_PRO", status: "active", periodEnd: days(20), tag: "api-mp" });
    signInAs(mp);
    const created = (await (await keysRoute.POST(req("/api/dashboard/api-keys", { method: "POST", body: { name: "ERP" } })))!.json()) as Json;
    const key = created.fullKey as string;
    const get = (k: string, sku = part.sku) => partsRoute.GET(req(`/api/v1/parts/${sku}`, { headers: { authorization: `Bearer ${k}` } }), { params: Promise.resolve({ sku }) });

    // Before the fix a Monteur Pro key got 10 calls per hour (calls 11+ were 429).
    const statuses: number[] = [];
    for (let i = 0; i < 13; i++) statuses.push((await get(key)).status);
    check(statuses.every((s) => s === 200), "Monteur Pro key: 13 calls in a row are all 200 (before: 11th was 429, cap 10/hour)", `Monteur Pro early 429: ${statuses.join(",")}`);
    const more: number[] = [];
    for (let i = 0; i < 125; i++) more.push((await get(key)).status);
    const okCount = more.filter((s) => s === 200).length + 13;
    const first429 = more.indexOf(429);
    const lim = (await (await get(key)).json()) as Json;
    check(okCount === apiAuth.PLAN_API_HOURLY_BURST.MONTEUR_PRO && first429 === 120 - 13 && lim.error?.includes("Hourly") && lim.limit === 120, `Monteur Pro key: exactly ${apiAuth.PLAN_API_HOURLY_BURST.MONTEUR_PRO} calls per hour succeed, then 429 "Hourly rate limit exceeded" (limit ${lim.limit})`, `Monteur Pro burst: ok ${okCount}, first 429 at ${first429}, body ${JSON.stringify(lim)}`);

    // Bedrijf: 600/hour on the same constants
    const bd = await mkUser({ plan: "BEDRIJF", status: "active", periodEnd: days(20), tag: "api-bd" });
    const bkey = await apiKeyOf(bd.id);
    let bOk = 0, bFirst429 = -1;
    for (let i = 0; i < 606; i++) { const s = (await get(bkey)).status; if (s === 200) bOk++; else if (bFirst429 < 0) bFirst429 = i; }
    check(bOk === 600 && bFirst429 === 600, `Bedrijf key: exactly 600 calls per hour (ok ${bOk}, first 429 at call ${bFirst429 + 1})`, `Bedrijf burst: ok ${bOk} first429 ${bFirst429}`);

    // The key follows the owner's plan at request time
    const owner = await apiKeyOf(mp.id);
    const mp2 = await apiAuth.verifyApiKey(owner);
    await prisma.user.update({ where: { id: mp.id }, data: { plan: "BEDRIJF" } });
    const asBedrijf = await apiAuth.verifyApiKey(owner);
    await prisma.user.update({ where: { id: mp.id }, data: { plan: "MONTEUR_PRO", stripeSubStatus: "canceled" } });
    const cancelled = await get(owner);
    const cancelledBody = (await cancelled.json()) as Json;
    await prisma.user.update({ where: { id: mp.id }, data: { plan: "MONTEUR_PRO", stripeSubStatus: "active", stripeCurrentPeriodEnd: days(20) } });
    const back = await apiAuth.verifyApiKey(owner);
    check(mp2.ok && mp2.info.monthlyCalls === 1000 && asBedrijf.ok && asBedrijf.info.monthlyCalls === 10000 && back.ok && back.info.monthlyCalls === 1000, "Upgrade/downgrade: the SAME key gets 1000, then 10000, then 1000 calls (before: frozen at creation)", `plan-bound key: ${JSON.stringify([mp2, asBedrijf, back].map((v) => (v.ok ? v.info.monthlyCalls : v.reason)))}`);
    check(cancelled.status === 402 && /suspended/i.test(cancelledBody.error), "Cancelled subscription: the existing key answers 402 'API key suspended' (before: 200 forever)", `cancelled key answered ${cancelled.status} ${JSON.stringify(cancelledBody)}`);
    const revokeAfter = (await keysRoute.GET())!;
    check(revokeAfter.status === 200, "...and the owner can still list/revoke it", `list after cancel: ${revokeAfter.status}`);
    const delOk = (await keysRoute.DELETE(req(`/api/dashboard/api-keys?id=${created.key.id}`, { method: "DELETE" })))!;
    check(delOk.status === 200, "...revoke works for a lapsed owner", `revoke after cancel: ${delOk.status}`);
    const revokedGet = await get(key);
    check(revokedGet.status === 401, "A revoked key answers 401", `revoked key answered ${revokedGet.status}`);

    // Account-wide allowance: two keys share one counter
    const acct = await mkUser({ plan: "MONTEUR_PRO", status: "active", periodEnd: days(20), tag: "api-acct" });
    const k1 = await apiKeyOf(acct.id);
    const k2 = await apiKeyOf(acct.id);
    await prisma.usageCounter.upsert({
      where: { scope_key: { scope: "api", key: apiAuth.apiQuotaKeyFor(acct.id) } },
      create: { scope: "api", key: apiAuth.apiQuotaKeyFor(acct.id), count: 999, windowEnd: days(30) },
      update: { count: 999, windowEnd: days(30) },
    });
    const r1 = await get(k1);
    const r2 = await get(k2);
    const r2b = (await r2.json()) as Json;
    check(r1.status === 200 && r2.status === 429 && /Monthly/.test(r2b.error) && r2b.limit === 1000, "Monthly allowance is per ACCOUNT: with 999 used, key A gets the last call, key B is refused (before: each of 10 keys had its own 1000)", `account allowance: A ${r1.status}, B ${r2.status} ${JSON.stringify(r2b)}`);

    // 404 / 400 do not cost a call
    const acct2 = await mkUser({ plan: "MONTEUR_PRO", status: "active", periodEnd: days(20), tag: "api-meter" });
    const mk = await apiKeyOf(acct2.id);
    const usedNow = async () => (await prisma.usageCounter.findUnique({ where: { scope_key: { scope: "api", key: apiAuth.apiQuotaKeyFor(acct2.id) } } }))?.count ?? 0;
    const miss = await get(mk, "DOES-NOT-EXIST-" + RUN);
    const afterMiss = await usedNow();
    const codeMiss = await codesRoute.GET(req("/api/v1/errorcodes/Nobrand/ZZZ", { headers: { authorization: `Bearer ${mk}` } }), { params: Promise.resolve({ brand: "Nobrand", code: "ZZZ" }) });
    const afterCodeMiss = await usedNow();
    const bad = await diagnoseRoute.POST(req("/api/v1/diagnose", { method: "POST", body: { brand: "Bosch" }, headers: { authorization: `Bearer ${mk}` } }));
    const afterBad = await usedNow();
    const hit = await get(mk);
    const afterHit = await usedNow();
    check(miss.status === 404 && codeMiss.status === 404 && bad.status === 400 && afterMiss === 0 && afterCodeMiss === 0 && afterBad === 0 && hit.status === 200 && afterHit === 1, "A 404 (part, error code) and a 400 (diagnose input) cost no call; a successful lookup costs exactly one", `metering: ${miss.status}/${codeMiss.status}/${bad.status} used ${afterMiss}/${afterCodeMiss}/${afterBad}, hit ${hit.status} used ${afterHit}`);

    // Scope + auth gates
    const noKey = await partsRoute.GET(req("/api/v1/parts/x"), { params: Promise.resolve({ sku: "x" }) });
    check(noKey.status === 401, "No key: 401", `no key: ${noKey.status}`);
    // Health reads the same constants
    const health = (await (await healthRoute.GET()).json()) as Json;
    check(health.limits?.MONTEUR_PRO?.callsPerHour === 120 && health.limits?.BEDRIJF?.callsPerHour === 600 && !JSON.stringify(health.endpoints).includes('"/api/v1/parts"') && !JSON.stringify(health).includes("1000/h"), "/api/v1/health prints the enforced limits and lists no endpoint that does not exist", `health: ${JSON.stringify(health)}`);
    // Sandbox key behaviour is unchanged
    process.env.API_DEMO_KEY = "wf_demo_sandboxkey01";
    const sandbox = await apiAuth.verifyApiKey("wf_demo_sandboxkey01");
    delete process.env.API_DEMO_KEY;
    check(sandbox.ok && sandbox.info.monthlyCalls === 100 && sandbox.info.scopes.join() === "read:parts", "Sandbox key keeps its 100 calls and read:parts scope", `sandbox: ${JSON.stringify(sandbox)}`);
  }

  // ════════════════════════ 5. Monteur approval ════════════════════════
  section("5. Monteur approval grants nothing, attaches nothing, mails the applicant; the verified owner gets a prefill");
  {
    const actions = await import("../src/app/admin/aanvragen/actions");
    const adminRow = await mkUser({ role: "ADMIN", tag: "adm" });
    signInAs(adminRow);
    const applicant = await mkUser({ tag: "mon", plan: "FREE" });
    const mkApp = (mail: string) => prisma.monteurApplication.create({ data: { applicationId: `MNT-${RUN}-${++counter}`, companyName: "QA Witgoed B.V.", kvkNumber: "12345678", vatNumber: "NL123456789B01", email: mail, phone: "0612345678", contactName: "Piet Monteur" } });
    const click = async (id: string, status: string) => {
      const fd = new FormData();
      fd.set("id", id); fd.set("status", status);
      try { await actions.setApplicationStatus(fd); return "returned"; } catch (err) { return String((err as { digest?: string }).digest ?? err); }
    };

    sentMail.length = 0;
    mailOk = true;
    const app = await mkApp(applicant.email.toUpperCase());
    const r = await click(app.id, "APPROVED");
    const u1 = await prisma.user.findUniqueOrThrow({ where: { id: applicant.id } });
    const profile = await prisma.monteurProfile.findUnique({ where: { userId: applicant.id } });
    signInAs(u1);
    const cu = await auth.getCurrentUser();
    signInAs(adminRow);
    check(u1.plan === "FREE" && u1.role === "CONSUMER" && !!cu && !auth.hasProAccess(cu), "Approval: the account keeps plan FREE and role CONSUMER, and has NO Monteur access (before: role TECHNICIAN + plan MONTEUR_PRO for free)", `approval changed the account: ${u1.plan}/${u1.role}`);
    check(profile === null, "Approval creates NO monteur profile on the account that owns the typed (unverified) address", `a profile was attached at approval: ${JSON.stringify(profile)}`);
    // The prefill is for the signed-in owner of a VERIFIED address only.
    const prefillVerified = await approval.approvedApplicationFor(prisma, { email: ` ${applicant.email.toUpperCase()} `, emailVerified: true });
    const prefillUnverified = await approval.approvedApplicationFor(prisma, { email: applicant.email, emailVerified: false });
    const prefillOther = await approval.approvedApplicationFor(prisma, { email: email("someoneelse"), emailVerified: true });
    check(prefillVerified?.companyName === "QA Witgoed B.V." && prefillVerified.kvkNumber === "12345678" && prefillUnverified === null && prefillOther === null, "Prefill from the approved application: the verified owner of that address gets it (capitals + spaces), an unverified address or another person gets nothing", `prefill: ${JSON.stringify({ prefillVerified, prefillUnverified, prefillOther })}`);
    // Through the real settings page: who sees what in the form
    const settingsPage = (await import("../src/app/monteur/instellingen/page")).default;
    const formValuesOf = async () => {
      const tree = await settingsPage();
      const found = findElements(tree, (el) => (el.props as Json)?.values !== undefined && typeof (el.props as Json).values === "object");
      return found[0] ? ((found[0].props as Json).values as Json) : null;
    };
    const proApplicant = await mkUser({ tag: "monpro", plan: "MONTEUR_PRO" });
    await prisma.monteurApplication.create({ data: { applicationId: `MNT-${RUN}-${++counter}`, companyName: "QA Prefill B.V.", kvkNumber: "87654321", vatNumber: "NL987654321B01", email: proApplicant.email, phone: "0611112222", contactName: "Piet Prefill", status: "APPROVED" } });
    signInAs(proApplicant);
    const shown = await formValuesOf();
    check(shown?.companyName === "QA Prefill B.V." && shown.kvkNumber === "87654321" && (await prisma.monteurProfile.count({ where: { userId: proApplicant.id } })) === 0, "Settings page: the verified owner sees the application's details prefilled, and nothing is stored until they save", `settings prefill: ${JSON.stringify(shown)}`);
    // A different, unverified sign-in that typed the same address ends up on a placeholder row and sees nothing
    const squatter = await auth.syncSignedInUser({ clerkId: clerkId(), email: proApplicant.email, emailVerified: false, name: "Squatter" });
    await prisma.user.update({ where: { id: squatter.id }, data: { plan: "MONTEUR_PRO" } });
    identity = { clerkId: squatter.clerkId!, email: proApplicant.email, emailVerified: false, name: "Squatter" };
    const squatterShown = await formValuesOf();
    check(squatter.id !== proApplicant.id && (squatterShown === null || Object.values(squatterShown).every((v) => v == null || v === "")), "Settings page: someone who typed the same address without verifying it sees none of the applicant's company data", `squatter sees: ${JSON.stringify(squatterShown)}`);
    signInAs(adminRow);
    check(/melding=goedgekeurd-mail-verstuurd/.test(r) && sentMail.length === 1 && sentMail[0].to === applicant.email.toUpperCase() && sentMail[0].html.includes("/upgrade?plan=MONTEUR_PRO") && /nog geen toegang/.test(sentMail[0].html), "Approval: the applicant is mailed once, with the link to /upgrade?plan=MONTEUR_PRO, saying approval gives no access yet", `approval mail: ${r} ${JSON.stringify(sentMail.map((m) => ({ to: m.to, link: m.html.includes("/upgrade?plan=MONTEUR_PRO") })))}`);

    const again = await click(app.id, "APPROVED");
    check(again === "returned" && sentMail.length === 1, "A second click on APPROVED does not mail again", `second click: ${again}, mails ${sentMail.length}`);

    await click(app.id, "REJECTED");
    const u2 = await prisma.user.findUniqueOrThrow({ where: { id: applicant.id } });
    const appRow = await prisma.monteurApplication.findUniqueOrThrow({ where: { id: app.id } });
    check(appRow.status === "REJECTED" && u2.plan === "FREE" && u2.role === "CONSUMER", "Reverting to REJECTED leaves no privileges behind (there were none to take)", `after REJECTED: ${appRow.status} ${u2.plan}/${u2.role}`);

    // Legacy rows from the old behaviour: role TECHNICIAN, plan FREE (cancelled) grants nothing either
    check(!auth.hasProAccess({ plan: "FREE", role: "TECHNICIAN" }), "hasProAccess({plan:'FREE', role:'TECHNICIAN'}) is false (before: true)", "role still grants Monteur access");

    // Mail failure is reported to the admin, approval still stands
    mailOk = false;
    const app2 = await mkApp(email("nomail"));
    const r2 = await click(app2.id, "APPROVED");
    check(/goedgekeurd-mail-mislukt/.test(r2) && (await prisma.monteurApplication.findUniqueOrThrow({ where: { id: app2.id } })).status === "APPROVED", "Mail failure: the admin is told the mail was NOT sent; the application is still approved", `mail failure: ${r2}`);
    mailOk = true;

    // Applicant without an account: stays APPROVED, nothing created, registration link in the mail
    sentMail.length = 0;
    const lonely = email("lonely");
    const app3 = await mkApp(lonely);
    await click(app3.id, "APPROVED");
    check((await prisma.user.count({ where: { email: lonely } })) === 0 && sentMail[0]?.html.includes("/registreren?plan=monteur_pro"), "No account yet: nothing is created, the mail links to registration that returns to the payment page", `lonely: users ${await prisma.user.count({ where: { email: lonely } })}, link ${sentMail[0]?.html.includes("/registreren?plan=monteur_pro")}`);
    const lateUser = await auth.syncSignedInUser({ clerkId: clerkId(), email: lonely, emailVerified: true, name: "Laat" });
    check(lateUser.plan === "FREE" && lateUser.role === "CONSUMER", "...and when they register later they are an ordinary FREE account until they subscribe", `late registrant: ${lateUser.plan}/${lateUser.role}`);
    check(approval.subscribeLinkFor(true).endsWith("/upgrade?plan=MONTEUR_PRO") && approval.subscribeLinkFor(false).endsWith("/registreren?plan=monteur_pro"), "Approval links: account -> /upgrade, no account -> /registreren?plan=monteur_pro", "subscribeLinkFor wrong");

    // Non-admin cannot decide
    signInAs(await mkUser({ tag: "notadmin" }));
    let denied = false;
    try { await actions.setApplicationStatus((() => { const f = new FormData(); f.set("id", app.id); f.set("status", "APPROVED"); return f; })()); } catch { denied = true; }
    check(denied, "A non-admin cannot approve an application", "non-admin approved");
  }

  // ════════════════════════ 6. Referral rules ════════════════════════
  section("6. Referral rules (programme switched ON for this run)");
  {
    check(referrals.REFERRAL_ENABLED === true, "Flag read at start-up: NEXT_PUBLIC_FEATURE_REFERRAL=true in this process", "flag not read");
    // Pure reward arithmetic
    const R = referrals.referralRewardFor;
    check(R({ totalEur: 60, shippingEur: 0, vatRate: 0.21, costEur: 20 }).rewardEur === 5, "Reward: healthy margin -> the EUR 5 maximum", "reward cap wrong");
    check(R({ totalEur: 25.31, shippingEur: 5.95, vatRate: 0.21, costEur: 10 }).rewardEur === 3, "Reward: margin EUR 6,00 -> half of it = EUR 3,00 (never more than half the contribution)", `reward ${JSON.stringify(R({ totalEur: 25.31, shippingEur: 5.95, vatRate: 0.21, costEur: 10 }))}`);
    check(R({ totalEur: 12, shippingEur: 5.95, vatRate: 0.21, costEur: 8 }).rewardEur === 0 && R({ totalEur: 12, shippingEur: 5.95, vatRate: 0.21, costEur: 8 }).reason === "no_margin", "Reward: an order that loses money earns EUR 0", "negative margin rewarded");
    check(R({ totalEur: 60, shippingEur: 0, vatRate: 0.21, costEur: null }).rewardEur === 0 && R({ totalEur: 60, shippingEur: 0, vatRate: 0.21, costEur: null }).reason === "cost_unknown", "Reward: cost not confirmed by a quote (costEur null) -> EUR 0, 'cost_unknown'", "unknown cost rewarded");
    check(R({ totalEur: 55.95, shippingEur: 5.95, vatRate: 0.21, costEur: 30 }).marginEur! < R({ totalEur: 50, shippingEur: 0, vatRate: 0.21, costEur: 30 }).marginEur! + 5, "Reward: a free-shipping order is charged the carrier (standard fee) against its margin", "free shipping not accounted");

    const referrer = await mkUser({ tag: "ref" });
    const code = await referrals.referralCodeFor(referrer.id);
    const mkOrder = (o: { userId: string; email: string; status: string; total?: number; shipping?: number; cost?: number | null; createdAt?: Date }) =>
      prisma.order.create({
        data: {
          userId: o.userId, email: o.email, status: o.status, paymentMethod: "BANK_TRANSFER", subtotalEur: o.total ?? 60, shippingEur: o.shipping ?? 0, totalEur: o.total ?? 60,
          vatRate: 0.21, vatEur: 10, costEur: o.cost === undefined ? 20 : o.cost, shippingAddress: "{}", ...(o.createdAt ? { createdAt: o.createdAt } : {}),
        },
      });
    const visitor = () => `vis-${RUN}-${++counter}`;
    const clickAs = async (v: string, actor?: string | null) => { await referrals.recordClick(code, v, "/", actor ?? null); };
    const rowOf = (v: string) => prisma.referral.findFirst({ where: { visitorId: v } });
    const buyer = async () => mkUser({ tag: "buyer" });

    // 1. creation / unpaid / trial earn nothing
    const v1 = visitor(); await clickAs(v1);
    const b1 = await buyer();
    const open = await mkOrder({ userId: b1.id, email: b1.email, status: "OPENSTAAND" });
    const noProof = await referrals.recordConversion(v1, b1.id);
    const unpaid = await referrals.recordConversion(v1, b1.id, { orderId: open.id });
    const pending = await mkOrder({ userId: b1.id, email: b1.email, status: "PENDING" });
    const pend = await referrals.recordConversion(v1, b1.id, { orderId: pending.id });
    const trial = await referrals.recordConversion(v1);
    const row1 = await rowOf(v1);
    check(!noProof.rewarded && noProof.reason === "no_payment_proof" && !unpaid.rewarded && unpaid.reason === "order_not_paid" && !pend.rewarded && !trial.rewarded && row1?.convertedAt === null && row1.rewardEur === 0, "Not booked on creation, on an unpaid bank-transfer order (OPENSTAAND), on a pending Stripe order, or at trial start (before: EUR 5 booked on all of them)", `early reward: ${JSON.stringify([noProof, unpaid, pend, trial])} row ${JSON.stringify(row1)}`);

    // 2. paid first order books it
    await prisma.order.update({ where: { id: open.id }, data: { status: "PAID" } });
    const paid = await referrals.recordConversion(v1, b1.id, { orderId: open.id });
    const row1b = await rowOf(v1);
    check(paid.rewarded && paid.rewardEur === 5 && row1b?.convertedAt !== null && row1b?.rewardEur === 5, "The referred person's first PAID order books the reward (EUR 5)", `paid: ${JSON.stringify(paid)} row ${JSON.stringify(row1b)}`);
    const dup = await referrals.recordConversion(v1, b1.id, { orderId: open.id });
    check(!dup.rewarded && (await prisma.referral.findMany({ where: { visitorId: v1 } })).reduce((n, r) => n + r.rewardEur, 0) === 5, "Replay (webhook retry): still EUR 5, booked once", `replay: ${JSON.stringify(dup)}`);

    // 3. second paid order of the same buyer, another visitor cookie
    const v2 = visitor(); await clickAs(v2);
    const second = await mkOrder({ userId: b1.id, email: b1.email, status: "PAID", createdAt: new Date(Date.now() + 60_000) });
    const sec = await referrals.recordConversion(v2, b1.id, { orderId: second.id });
    check(!sec.rewarded && sec.reason === "not_first_paid_order", "Only the first paid order counts: the same buyer's second order earns nothing", `second order: ${JSON.stringify(sec)}`);

    // 4. self-referral: same user, same e-mail (guest order), signed-in click
    const v3 = visitor(); await clickAs(v3);
    const own = await mkOrder({ userId: referrer.id, email: referrer.email, status: "PAID" });
    const selfUser = await referrals.recordConversion(v3, undefined, { orderId: own.id });
    // A second referrer who has never ordered, so the ONLY reason to refuse is that the buyer is the referrer.
    const referrerB = await mkUser({ tag: "refb" });
    const codeB = await referrals.referralCodeFor(referrerB.id);
    const v4 = visitor(); await referrals.recordClick(codeB, v4, "/", null);
    const otherRow = await prisma.user.create({ data: { email: email("guestrow") } });
    const guestOrder = await mkOrder({ userId: otherRow.id, email: ` ${referrerB.email.toUpperCase()} `, status: "PAID" });
    const selfMail = await referrals.recordConversion(v4, undefined, { orderId: guestOrder.id });
    const v5 = visitor(); await clickAs(v5, referrer.id);
    check(!selfUser.rewarded && !selfMail.rewarded && selfMail.reason === "self_referral" && (await rowOf(v5)) === null, "Self-referral: same user, same e-mail address (guest order, capitals + spaces) earn nothing, and a click while signed in as the referrer creates no row (before: EUR 5 for the referrer's own guest order)", `self: ${JSON.stringify([selfUser, selfMail])} row5 ${JSON.stringify(await rowOf(v5))}`);

    // 5. unknown cost / thin margin
    const v6 = visitor(); await clickAs(v6);
    const b6 = await buyer();
    const o6 = await mkOrder({ userId: b6.id, email: b6.email, status: "PAID", cost: null });
    const r6 = await referrals.recordConversion(v6, b6.id, { orderId: o6.id });
    check(!r6.rewarded && r6.reason === "cost_unknown" && (await rowOf(v6))?.rewardEur === 0, "Order without confirmed cost price: conversion counted, reward EUR 0", `unknown cost: ${JSON.stringify(r6)}`);
    const v7 = visitor(); await clickAs(v7);
    const b7 = await buyer();
    const o7 = await mkOrder({ userId: b7.id, email: b7.email, status: "PAID", total: 25.31, shipping: 5.95, cost: 10 });
    const r7 = await referrals.recordConversion(v7, b7.id, { orderId: o7.id });
    check(r7.rewarded && r7.rewardEur === 3, "Thin margin: reward capped at half the contribution (EUR 3,00, not 5)", `thin margin: ${JSON.stringify(r7)}`);

    // 6. window, yearly cap
    const old = await prisma.referral.create({ data: { code, visitorId: visitor(), referrerId: referrer.id, createdAt: new Date(Date.now() - 31 * DAY) } });
    const b8 = await buyer();
    const o8 = await mkOrder({ userId: b8.id, email: b8.email, status: "PAID" });
    const r8 = await referrals.recordConversion(old.visitorId, b8.id, { orderId: o8.id });
    check(!r8.rewarded && r8.reason === "no_attributable_referral", "Attribution window: a click older than 30 days earns nothing", `window: ${JSON.stringify(r8)}`);
    const capRef = await mkUser({ tag: "capref" });
    const capCode = await referrals.referralCodeFor(capRef.id);
    await prisma.referral.create({ data: { code: capCode, visitorId: visitor(), referrerId: capRef.id, convertedAt: new Date(), rewardEur: 498 } });
    const vCap = visitor(); await referrals.recordClick(capCode, vCap, "/", null);
    const b9 = await buyer();
    const o9 = await mkOrder({ userId: b9.id, email: b9.email, status: "PAID" });
    const r9 = await referrals.recordConversion(vCap, b9.id, { orderId: o9.id });
    check(r9.rewarded && r9.rewardEur === 2, "Yearly cap EUR 500: with EUR 498 already booked the next reward is cut to EUR 2", `cap: ${JSON.stringify(r9)}`);
    const vCap2 = visitor(); await referrals.recordClick(capCode, vCap2, "/", null);
    const b10 = await buyer();
    const o10 = await mkOrder({ userId: b10.id, email: b10.email, status: "PAID" });
    const r10 = await referrals.recordConversion(vCap2, b10.id, { orderId: o10.id });
    check(!r10.rewarded && r10.rewardEur === 0 && r10.reason === "yearly_cap_reached", "...and at the cap the reward is EUR 0 ('yearly_cap_reached')", `at cap: ${JSON.stringify(r10)}`);

    // 7. stats and page text agree with the constants
    const stats = await referrals.referralStats(code, "https://example.test");
    check(stats.earningsEur === 8 && stats.conversions >= 3, `Stats: earnings EUR ${stats.earningsEur} = 5 + 0 + 3 booked, nothing for unpaid or own orders`, `stats: ${JSON.stringify(stats)}`);
    const pageSrc = fs.readFileSync(path.join(repo, "src/app/dashboard/referrals/page.tsx"), "utf8");
    check(/handmatig/.test(pageSrc) && /Geen contante uitbetaling/.test(pageSrc) && !/Credits/.test(pageSrc) && !/24-maanden|Enterprise|e-mailnotificatie|automatisch/i.test(pageSrc.replace(/vanzelf/g, "")), "Referral page says credit is settled by hand on request and no longer promises credits page, 24 months, vanity URLs, e-mail notification or automatic redemption", "referral page text still promises unbuilt things");
    check(/REWARD_EUR/.test(pageSrc) && /MAX_REWARD_PER_YEAR_EUR/.test(pageSrc) && /REWARD_SHARE_OF_MARGIN/.test(pageSrc) && /ATTRIBUTION_DAYS/.test(pageSrc), "Referral page prints the constants the code enforces (reward, share of margin, yearly cap, window)", "referral page does not use the enforced constants");
    check(!fs.existsSync(path.join(repo, "src/components/ReferralWidget.tsx")) || !/ReferralWidget/.test(pageSrc), "Referral page no longer renders the old widget that promised credit 'verzilverbaar tegen onderdelen'", "old widget still used");

    // The tracking route with the programme on: a signed-in referrer's click is dropped; a stranger's is recorded
    const track = await import("../src/app/api/referral/track/route");
    signInAs(referrer);
    const vSelf = visitor();
    await track.POST(req("/api/referral/track", { method: "POST", body: { code }, headers: { cookie: `wasfix-vid=${vSelf}` } }));
    const selfRow = await rowOf(vSelf);
    signOut();
    const vOther = visitor();
    const tr = await track.POST(req("/api/referral/track", { method: "POST", body: { code }, headers: { cookie: `wasfix-vid=${vOther}` } }));
    check(selfRow === null && (await rowOf(vOther)) !== null && tr.cookies.get("wasfix-ref")?.value === code, "Track route (programme on): the referrer's own click records nothing; a stranger's click is recorded and sets the cookie", `track: self row ${JSON.stringify(selfRow)}`);
  }

  // ════════════════════════ 7. Clerk deletion + erasure ════════════════════════
  section("7. Clerk user.deleted ends the Stripe subscription; account erasure kills old order links");
  {
    const { startFakeStripe } = await import("./lib/fake-stripe");
    const { _setStripeForTests } = await import("../src/lib/stripe");
    const fake = await startFakeStripe();
    _setStripeForTests(fake.client());
    _resetNotifyStateForTests?.();
    const clerkRoute = await import("../src/app/api/webhooks/clerk/route");
    const deleteEvent = (id: string) => clerkRoute.POST(req("/api/webhooks/clerk", { method: "POST", body: { type: "user.deleted", data: { id } } }));

    const u = await mkUser({ plan: "MONTEUR_PRO", status: "active", periodEnd: days(20), stripeSubId: `sub_qa_${RUN}`, stripeCustomerId: `cus_qa_${RUN}`, tag: "erase" });
    fake.state.customers[`cus_qa_${RUN}`] = { id: `cus_qa_${RUN}`, object: "customer", email: u.email, name: "QA" };
    fake.state.subscriptions[`sub_qa_${RUN}`] = fake.subscription({ id: `sub_qa_${RUN}`, customer: `cus_qa_${RUN}`, priceId: "price_x", status: "active", userId: u.id, plan: "MONTEUR_PRO" });
    // R2-08: this door used to erase far less than the dashboard route. The monteur profile (KvK, IBAN, address), a CRM customer and
    // the contact data of an order are part of the same fixture now (scripts/qa-privacy.ts proves both doors end up identical).
    await prisma.monteurProfile.create({ data: { userId: u.id, companyName: "QA Techniek", kvkNumber: "12345679", iban: "NL02ABNA0123456789", street: "Geheimstraat 7" } });
    await prisma.customer.create({ data: { ownerId: u.id, name: "QA klant", phone: "06 11112222", notes: "heeft een hond" } });
    const hookOrder = await prisma.order.create({ data: { userId: u.id, email: u.email, status: "CANCELLED", paymentMethod: "STRIPE", subtotalEur: 10, shippingEur: 0, totalEur: 10, vatRate: 0.21, vatEur: 1.74, phone: "06 99887766", customerNote: "notitie", accessToken: (await import("../src/lib/invoicing")).newAccessToken(), shippingAddress: JSON.stringify({ name: "Piet", street: "Geheimstraat", houseNumber: "7", postalCode: "1011 AB", city: "Amsterdam" }) } });
    const res = await deleteEvent(u.clerkId!);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    const hookAfter = await prisma.order.findUniqueOrThrow({ where: { id: hookOrder.id } });
    check((await prisma.monteurProfile.count({ where: { userId: u.id } })) === 0 && (await prisma.customer.count({ where: { ownerId: u.id } })) === 0 && hookAfter.email === `deleted-${u.id}@anon.wasfix.nl` && hookAfter.phone === null && hookAfter.customerNote === null && hookAfter.accessToken === null && !hookAfter.shippingAddress.includes("Geheimstraat"), "Clerk user.deleted (R2-08): the monteur profile and CRM customers are erased, and the cancelled, never-invoiced order loses e-mail, address, phone, note and access link (before: all of it stayed)", `clerk delete left data: ${JSON.stringify(hookAfter)}`);
    const cancels = fake.requestsTo("DELETE", `/v1/subscriptions/sub_qa_${RUN}`);
    const scrubs = fake.requestsTo("POST", `/v1/customers/cus_qa_${RUN}`);
    check(res.status === 200 && cancels.length === 1 && cancels[0].idempotencyKey === `clerk-erase-${u.id}-sub_qa_${RUN}` && scrubs.length === 1 && String(scrubs[0].body.name) === "Verwijderd account", "Clerk user.deleted: the Stripe subscription is cancelled (idempotency key clerk-erase-…) and the customer is anonymised", `clerk delete: ${res.status}, cancels ${cancels.length}, scrubs ${scrubs.length}`);
    check(row.plan === "FREE" && row.stripeSubId === null && row.stripeCustomerId === null && row.stripeSubStatus === null && row.stripeCurrentPeriodEnd === null && row.stripeCancelAtPeriodEnd === false && row.clerkId === null && row.email === `deleted-${u.id}@anon.wasfix.nl`, "...and the row is FREE with every Stripe field cleared and the full-id anonymised address (before: plan and subscription id untouched)", `row after clerk delete: ${JSON.stringify(row)}`);

    // Stripe refuses: ids stay (handle for the manual finish), plan still reset, owner told, no personal data in the message
    slackBodies.length = 0;
    const f = await mkUser({ plan: "BEDRIJF", status: "active", periodEnd: days(20), stripeSubId: `sub_qa_f_${RUN}`, stripeCustomerId: `cus_qa_f_${RUN}`, tag: "erasefail" });
    fake.state.subscriptions[`sub_qa_f_${RUN}`] = fake.subscription({ id: `sub_qa_f_${RUN}`, customer: `cus_qa_f_${RUN}`, priceId: "price_x", status: "active", userId: f.id, plan: "BEDRIJF" });
    fake.fail("DELETE", `/v1/subscriptions/sub_qa_f_${RUN}`, 500, 5);
    const resF = await deleteEvent(f.clerkId!);
    await settle();
    const rowF = await prisma.user.findUniqueOrThrow({ where: { id: f.id } });
    const told = slackBodies.map((b) => { try { return String(JSON.parse(b).text); } catch { return b; } }).join(" | ");
    check(resF.status === 200 && rowF.plan === "FREE" && rowF.stripeSubId === `sub_qa_f_${RUN}` && rowF.clerkId === null, "Stripe failure: the account is still erased and reset to FREE, the subscription id is kept as the handle to finish by hand", `failure path row: ${JSON.stringify(rowF)}`);
    check(/Stripe handmatig afronden/.test(told) && told.includes(f.id) && !told.includes(f.email) && !/@/.test(told.replace(/<[^>]*>/g, "")), "...and the owner is told (user id, no e-mail address)", `owner message: ${told}`);
    _setStripeForTests(null);
    await fake.close();

    // Erasure: old order links die
    const deleteRoute = await import("../src/app/api/account/delete/route");
    const access = await import("../src/app/bestelling/_lib/access");
    const { newAccessToken } = await import("../src/lib/invoicing");
    const e = await mkUser({ tag: "gdpr" });
    const token = newAccessToken();
    const inv = await import("../src/lib/invoicing");
    const vat = inv.splitVatInclusive(30);
    const o1 = await prisma.order.create({ data: { userId: e.id, email: e.email, status: "CANCELLED", paymentMethod: "BANK_TRANSFER", subtotalEur: 30, shippingEur: 0, totalEur: 30, vatRate: vat.vatRate, vatEur: vat.vatEur, accessToken: token, phone: "06 11112222", customerNote: "Bel aan voor de deur", shippingAddress: JSON.stringify({ name: "Piet", street: "Teststraat", houseNumber: "1", postalCode: "1011 AB", city: "Amsterdam" }) } });
    const o2 = await prisma.order.create({ data: { userId: e.id, email: e.email, status: "DELIVERED", deliveredAt: new Date(Date.now() - 90 * DAY), updatedAt: new Date(Date.now() - 90 * DAY), paymentMethod: "BANK_TRANSFER", subtotalEur: 30, shippingEur: 0, totalEur: 30, vatRate: vat.vatRate, vatEur: vat.vatEur, accessToken: newAccessToken(), phone: "06 11112222", customerNote: "Notitie", shippingAddress: "{}" } });
    const o2Token = (await prisma.order.findUniqueOrThrow({ where: { id: o2.id } })).accessToken;
    const beforeLink = await access.loadOrderForViewer(o1.id, token);
    signInAs(e);
    const del = await deleteRoute.POST(req("/api/account/delete", { method: "POST", body: { confirmation: "VERWIJDER MIJN ACCOUNT" } }));
    const delJson = (await del.json()) as Json;
    const orders = await prisma.order.findMany({ where: { userId: e.id } });
    const afterLink = await access.loadOrderForViewer(o1.id, token);
    const afterLink2 = await access.loadOrderForViewer(o2.id, o2Token);
    check(!!beforeLink, "Before erasure the mailed link (?t=token) opens the order", "setup: link did not open before erasure");
    check(del.status === 200 && orders.length === 2 && orders.every((o) => o.phone === null && o.customerNote === null && o.accessToken === null), `Erasure: phone, note and guest token are cleared on ALL of the account's orders (status ${del.status})`, `erasure left contact data: ${del.status} ${JSON.stringify(delJson).slice(0, 200)} ${JSON.stringify(orders.map((o) => [o.phone, o.customerNote, o.accessToken]))}`);
    check(afterLink === null && afterLink2 === null, "The erased person's old order URL now answers 'not found' (no token, owner gone)", "old order link still opens after erasure");
  }

  // ════════════════════════ 8. Banner, consent, copy ════════════════════════
  section("8. Banner, consent text and copy that must agree with the code");
  {
    const { bannerFor } = await import("../src/app/dashboard/banner-data");
    const now = Date.now();
    const pd = bannerFor({ plan: "FREE", storedPlan: "MONTEUR_PRO", subscriptionStatus: "past_due", currentPeriodEnd: new Date(now - 2 * DAY), cancelAtPeriodEnd: false });
    const pdLapsed = bannerFor({ plan: "FREE", storedPlan: "MONTEUR_PRO", subscriptionStatus: "past_due", currentPeriodEnd: new Date(now - 12 * DAY), cancelAtPeriodEnd: false });
    const ending = bannerFor({ plan: "MONTEUR_PRO", storedPlan: "MONTEUR_PRO", subscriptionStatus: "active", currentPeriodEnd: new Date(now + 6 * DAY), cancelAtPeriodEnd: true });
    const unpaid = bannerFor({ plan: "FREE", storedPlan: "BEDRIJF", subscriptionStatus: "unpaid", currentPeriodEnd: new Date(now - DAY), cancelAtPeriodEnd: false });
    const fine = bannerFor({ plan: "MONTEUR_PRO", storedPlan: "MONTEUR_PRO", subscriptionStatus: "active", currentPeriodEnd: new Date(now + 20 * DAY), cancelAtPeriodEnd: false });
    check(pd?.kind === "past_due" && pd.lapsed === false && pd.planName === "Monteur Pro" && pdLapsed?.kind === "past_due" && pdLapsed.lapsed && ending?.kind === "ending" && unpaid?.kind === "payment_required" && fine === null, "Dashboard notice: past_due (also after the entitled plan fell to FREE), lapsed, ending, unpaid; nothing when all is well", `banners: ${JSON.stringify({ pd, pdLapsed, ending, unpaid, fine })}`);

    const consent = await import("../src/app/upgrade/consent");
    check(consent.requiresWithdrawalWaiver("PARTICULIER") && !consent.requiresWithdrawalWaiver("MONTEUR_PRO") && !consent.requiresWithdrawalWaiver("BEDRIJF") && !consent.requiresWithdrawalWaiver("FREE"), "Withdrawal-waiver consent is required for the consumer plan only", "waiver scope wrong");

    // The subscribe route refuses a consumer plan without consent BEFORE touching Stripe
    const { startFakeStripe } = await import("./lib/fake-stripe");
    const { _setStripeForTests } = await import("../src/lib/stripe");
    const fake = await startFakeStripe();
    _setStripeForTests(fake.client());
    process.env.STRIPE_SECRET_KEY = "sk_test_qa_plans_fake";
    const subscribeRoute = await import("../src/app/api/stripe/subscribe/route");
    const subUser = await mkUser({ tag: "subscr", plan: "FREE" });
    signInAs(subUser);
    const noConsent = await subscribeRoute.POST(req("/api/stripe/subscribe", { method: "POST", body: { plan: "PARTICULIER" } }));
    const falseConsent = await subscribeRoute.POST(req("/api/stripe/subscribe", { method: "POST", body: { plan: "PARTICULIER", withdrawalWaiver: false } }));
    const noConsentBody = (await noConsent.json()) as Json;
    check(noConsent.status === 400 && falseConsent.status === 400 && /herroepingsrecht/.test(noConsentBody.error) && fake.requests.length === 0, "Subscribe (consumer plan) without the consent: 400 with the reason, and Stripe is not called at all", `no consent: ${noConsent.status}/${falseConsent.status}, stripe requests ${fake.requests.length}`);
    // Regression: a customer who already has a subscription and clicks "Upgrade nu" for the consumer plan is
    // sent to the billing portal. The upgrade page shows no checkbox for them, so the server must not ask for it.
    const liveSub = await mkUser({ tag: "live", plan: "BEDRIJF", status: "active", periodEnd: days(20), stripeSubId: `sub_qa_live_${RUN}`, stripeCustomerId: `cus_qa_live_${RUN}` });
    fake.state.customers[`cus_qa_live_${RUN}`] = { id: `cus_qa_live_${RUN}`, object: "customer", email: liveSub.email, name: "QA" };
    fake.state.subscriptions[`sub_qa_live_${RUN}`] = fake.subscription({ id: `sub_qa_live_${RUN}`, customer: `cus_qa_live_${RUN}`, priceId: "price_x", status: "active", userId: liveSub.id, plan: "BEDRIJF" });
    signInAs(liveSub);
    const sessionsBefore = fake.requestsTo("POST", "/v1/checkout/sessions").length;
    const toPortal = await subscribeRoute.POST(req("/api/stripe/subscribe", { method: "POST", body: { plan: "PARTICULIER" } }));
    const toPortalBody = (await toPortal.json()) as Json;
    check(toPortal.status === 200 && toPortalBody.portal === true && String(toPortalBody.checkoutUrl).includes("billing.stripe.test") && fake.requestsTo("POST", "/v1/checkout/sessions").length === sessionsBefore, "Existing subscriber asks for the consumer plan without the checkbox: portal URL (200), no Checkout session, no 400 about the withdrawal right", `portal path: ${toPortal.status} ${JSON.stringify(toPortalBody)}`);
    // ...while a customer with a Stripe customer id but NO live subscription still needs the consent, and nothing is created at Stripe without it
    const lapsedCust = await mkUser({ tag: "nolive", plan: "FREE", stripeCustomerId: `cus_qa_nolive_${RUN}` });
    fake.state.customers[`cus_qa_nolive_${RUN}`] = { id: `cus_qa_nolive_${RUN}`, object: "customer", email: lapsedCust.email, name: "QA" };
    signInAs(lapsedCust);
    const before = fake.requests.length;
    const stillAsks = await subscribeRoute.POST(req("/api/stripe/subscribe", { method: "POST", body: { plan: "PARTICULIER" } }));
    const created = fake.requests.slice(before).filter((r) => r.method === "POST" || r.path.startsWith("/v1/prices"));
    check(stillAsks.status === 400 && created.length === 0, "No live subscription, no consent: still 400, and no price lookup, customer or Checkout session is created at Stripe", `no-consent path: ${stillAsks.status}, stripe writes ${JSON.stringify(created.map((r) => r.method + " " + r.path))}`);

    delete process.env.STRIPE_SECRET_KEY;
    _setStripeForTests(null);
    await fake.close();

    // Copy that must not claim what the code does not do
    const read = (p: string) => fs.readFileSync(path.join(repo, p), "utf8");
    const docs = read("src/app/api-docs/page.tsx");
    check(/PLAN_API_HOURLY_BURST/.test(docs) && /PLAN_API_MONTHLY_CALLS/.test(docs) && !/1000\/uur|10\/uur|witlabel/i.test(docs), "api-docs prints the enforced limits and no longer promises 1000/uur, 10/uur or white label", "api-docs still has an unbacked limit or white label");
    const keysPage = read("src/app/dashboard/api-keys/page.tsx");
    check(!/0\.001|onbeperkt|elke 5 minuten|value="0"/.test(keysPage), "/dashboard/api-keys: no invented usage numbers, no overage price, no 'onbeperkt' endpoints", "api-keys page still has fabricated figures");
    const prijzen = read("src/app/prijzen/page.tsx");
    check(!/Bancontact|Voor zakelijke klanten ook factuur|20 gebruikers|Prioriteit support/.test(prijzen), "/prijzen: no Bancontact, no 'factuur voor zakelijke klanten', no team seats, no priority support", "prijzen still has an unbacked claim");
    const inloggen = read("src/app/inloggen/page.tsx") + read("src/app/registreren/page.tsx");
    const demoCardIdx = inloggen.indexOf("isDemoMode()");
    check(demoCardIdx > -1 && !/NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY|CLERK_SECRET_KEY|DEMO_MODE=false/.test(inloggen) && /Inloggen is tijdelijk niet beschikbaar/.test(inloggen), "Sign-in/register: the demo card sits behind isDemoMode(), no configuration hints, an honest 'tijdelijk niet beschikbaar' otherwise", "sign-in pages still disclose configuration or show the demo card unconditionally");
    const monteur = read("src/app/monteur/page.tsx");
    check(!/api\.wasfix\.nl|NL-talige videosupport|gratis 30-minuten/.test(monteur), "/monteur: no api.wasfix.nl host, no video support, no onboarding call", "monteur page still has unbacked claims");
    // The same claims, checked on what the pages RENDER (a word merely absent from a source file proves little: copy comes from plans.ts and constants too)
    const { renderToStaticMarkup } = await import("react-dom/server");
    const rendered = async (mod: string, sp: Json = {}) => {
      const page = (await import(mod)).default as (p: { searchParams: Promise<Json> }) => Promise<unknown>;
      return renderToStaticMarkup((await page({ searchParams: Promise.resolve(sp) })) as import("react").ReactElement).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
    };
    const nl = (n: number) => new Intl.NumberFormat("nl-NL").format(n);
    const docsText = await rendered("../src/app/api-docs/page");
    const mp = apiAuth.PLAN_API_MONTHLY_CALLS, hb = apiAuth.PLAN_API_HOURLY_BURST;
    check(docsText.includes(nl(mp.MONTEUR_PRO)) && docsText.includes(nl(mp.BEDRIJF)) && new RegExp(`${hb.MONTEUR_PRO}\\s*(calls )?per uur|${hb.MONTEUR_PRO}/uur|max\\. ${hb.MONTEUR_PRO}`, "i").test(docsText) && new RegExp(`${hb.BEDRIJF}`).test(docsText) && !/1000\/uur|10\/uur|witlabel|white.?label|Bancontact/i.test(docsText), `Rendered /api-docs prints the enforced allowances (${nl(mp.MONTEUR_PRO)}/${nl(mp.BEDRIJF)} per month, ${hb.MONTEUR_PRO}/${hb.BEDRIJF} per hour) and none of the withdrawn claims`, `rendered api-docs: ${docsText.slice(0, 300)}`);
    check(/telt niet mee voor dat maandtegoed, maar wel voor de limiet per uur/.test(docsText) && !/kost geen call/.test(docsText), "Rendered /api-docs says a 400/404 is free for the monthly allowance but counts for the hourly limit (as the code does: the hourly bucket is spent before validation)", "api-docs 400/404 sentence wrong");
    const prijzenText = await rendered("../src/app/prijzen/page");
    check(!/Bancontact|factuur voor zakelijke klanten|20 gebruikers|Prioriteit support|priority support|white.?label/i.test(prijzenText) && /iDEAL/i.test(prijzenText), "Rendered /prijzen: iDEAL named, no Bancontact, team seats, priority support, white label or invoice promise", `rendered prijzen: ${prijzenText.slice(0, 200)}`);
    const monteurText = await rendered("../src/app/monteur/page");
    check(!/api\.wasfix\.nl|NL-talige videosupport|gratis 30-minuten|Bancontact/i.test(monteurText), "Rendered /monteur: no api.wasfix.nl host, NL video support, free onboarding call or Bancontact", "rendered monteur page still has unbacked claims");
    const loginText = await rendered("../src/app/inloggen/page") + await rendered("../src/app/registreren/page");
    check(/Inloggen is tijdelijk niet beschikbaar/.test(loginText) && /Registreren is tijdelijk niet beschikbaar/.test(loginText) && !/Clerk|DEMO_MODE|CLERK_SECRET|PUBLISHABLE|demo-?beheerder|Demo modus/i.test(loginText), "Rendered sign-in and register pages (Clerk not enabled, not demo): an honest 'tijdelijk niet beschikbaar' and no configuration or demo text", `rendered sign-in: ${loginText.slice(0, 300)}`);
    check(/NEXT_PUBLIC_FEATURE_REFERRAL=false/.test(read(".env.example")), ".env.example ships NEXT_PUBLIC_FEATURE_REFERRAL=false", ".env.example does not default the referral flag to false");
  }

  // ════════════════════════ 9. Hardening: redirects, hostile query strings, webhook, KvK, rendered UI ════════════════════════
  section("9. Redirect targets, hostile query strings, the Clerk webhook, KvK lookup, rendered UI states");
  {
    const { env } = await import("../src/lib/env");
    const { safeNext, signInTarget, signUpTarget, firstParam } = await import("../src/lib/safe-next");
    const own = new URL(env.APP_URL);
    const FB = "/dashboard";
    const table: [string, unknown, string][] = [
      ["a path with query", "/upgrade?plan=PARTICULIER", "/upgrade?plan=PARTICULIER"],
      ["a path with fragment", "/dashboard/profiel#abonnement", "/dashboard/profiel#abonnement"],
      ["protocol-relative", "//evil.example/x", FB],
      ["slash TAB slash (the browser strips the tab)", "/\t/evil.example", FB],
      ["slash newline slash", "/\n/evil.example", FB],
      ["slash CR slash", "/\r/evil.example", FB],
      ["backslash", "/\\evil.example", FB],
      ["slash backslash slash", "/\\/evil.example", FB],
      ["another origin", "https://evil.example/x", FB],
      ["our own origin, absolute (Clerk's redirect_url)", `${own.origin}/dashboard/profiel?a=1`, "/dashboard/profiel?a=1"],
      ["javascript: URL", "javascript:alert(1)", FB],
      ["data: URL", "data:text/html,x", FB],
      ["no leading slash", "evil.example/x", FB],
      ["leading space", " /x", FB],
      ["empty", "", FB],
      ["undefined", undefined, FB],
      ["a repeated parameter (array): the first value", ["/a", "/b"], "/a"],
      ["a repeated parameter whose first value is hostile", ["https://evil.example", "/b"], FB],
      ["an object", { a: 1 }, FB],
      ["a number", 5, FB],
      ["absurdly long", "/" + "a".repeat(5000), FB],
    ];
    const bad: string[] = [];
    for (const [name, input, expected] of table) {
      let got: string;
      try { got = safeNext(input); } catch (err) { bad.push(`${name}: threw ${String(err)}`); continue; }
      if (got !== expected) bad.push(`${name}: ${JSON.stringify(input)} -> ${got}, expected ${expected}`);
      if (new URL(got, own.origin).origin !== own.origin) bad.push(`${name}: result leaves the site: ${got}`);
    }
    check(bad.length === 0, `safeNext: ${table.length} inputs (tab/newline/CR tricks, other origins, arrays, objects, junk) all end on this site and never throw`, `safeNext failures: ${bad.join(" | ")}`);
    check(firstParam(["x", "y"]) === "x" && firstParam("x") === "x" && firstParam(undefined) === undefined && firstParam(3) === undefined, "firstParam: first of an array, a string as is, anything else absent", "firstParam wrong");
    check(signUpTarget({ plan: "monteur_pro" }) === "/upgrade?plan=MONTEUR_PRO" && signUpTarget({ plan: "__proto__" }) === FB && signUpTarget({ plan: "constructor" }) === FB && signUpTarget({ plan: ["bedrijf", "x"] }) === "/upgrade?plan=BEDRIJF" && signUpTarget({ next: ["/a", "/b"], plan: "bedrijf" }) === "/a", "Register target: a known plan goes to its payment page; __proto__, constructor and arrays do not break it", "signUpTarget wrong");
    check(signInTarget({ redirect_url: [`${own.origin}/upgrade?plan=BEDRIJF`, "/x"] }) === "/upgrade?plan=BEDRIJF" && signInTarget({ next: "/\t/evil.example" }) === FB && signInTarget({}) === FB, "Sign-in target: Clerk's redirect_url on our origin is honoured, a tab trick is not", "signInTarget wrong");

    // The real pages render with hostile query strings instead of answering 500
    const loginPage = (await import("../src/app/inloggen/page")).default;
    const registerPage = (await import("../src/app/registreren/page")).default;
    const hostile: Json[] = [{ plan: "__proto__" }, { plan: "constructor" }, { plan: ["a", "b"] }, { next: ["/a", "/b"] }, { next: "/\t/evil.example" }, { redirect_url: ["/a", "/b"] }];
    const crashed: string[] = [];
    for (const sp of hostile) {
      for (const [name, page] of [["inloggen", loginPage], ["registreren", registerPage]] as const) {
        try { await (page as (p: { searchParams: Promise<Json> }) => Promise<unknown>)({ searchParams: Promise.resolve(sp) }); } catch (err) { crashed.push(`${name} ${JSON.stringify(sp)}: ${String(err).slice(0, 80)}`); }
      }
    }
    check(crashed.length === 0, `/inloggen and /registreren render for ${hostile.length} hostile query strings each (before: HTTP 500 on __proto__, constructor, repeated parameters)`, `pages crashed: ${crashed.join(" | ")}`);

    // /upgrade?success: which plan is waited for
    const upgradePage = (await import("../src/app/upgrade/page")).default;
    const { PlanActivation } = await import("../src/app/upgrade/plan-activation");
    const bedrijf = await mkUser({ tag: "succ", plan: "BEDRIJF", status: "active", periodEnd: days(25) });
    signInAs(bedrijf);
    const expected = async (sp: Json) => {
      const tree = await upgradePage({ searchParams: Promise.resolve(sp) });
      const el = findElements(tree, (e) => e.type === PlanActivation)[0];
      return el ? ((el.props as Json).expectedPlan as string | undefined) ?? "ANY" : "NO_ACTIVATION";
    };
    const eNone = await expected({ success: "1" });
    const eBedrijf = await expected({ success: "1", plan: "BEDRIJF" });
    const eArr = await expected({ success: "1", plan: ["MONTEUR_PRO", "x"] });
    const eJunk = await expected({ success: "1", plan: "nonsense" });
    check(eNone === "ANY" && eBedrijf === "BEDRIJF" && eArr === "MONTEUR_PRO" && eJunk === "ANY", "/upgrade?success: waits for the plan named in the address, and for ANY paid plan when none is named (before: always Particulier, so a Bedrijf subscriber waited 40 s for a plan they do not have)", `expected plan: none=${eNone} bedrijf=${eBedrijf} array=${eArr} junk=${eJunk}`);
    const upgradeCrash = await upgradePage({ searchParams: Promise.resolve({ plan: ["BEDRIJF", "x"] }) }).then(() => null, (e) => String(e));
    check(upgradeCrash === null, "/upgrade renders for a repeated ?plan parameter", `upgrade crashed: ${upgradeCrash}`);

    // Clerk webhook: user.created / user.updated go through the same rules as a sign-in
    const clerkRoute = await import("../src/app/api/webhooks/clerk/route");
    const post = (type: string, data: Json) => clerkRoute.POST(req("/api/webhooks/clerk", { method: "POST", body: { type, data } }));
    const payload = (id: string, addr: string, opts: { status?: string; primary?: boolean; extra?: Json[] } = {}): Json => ({
      id, first_name: "Web", last_name: "Hook",
      email_addresses: [{ id: "idn_1", email_address: addr, verification: { status: opts.status ?? "verified" } }, ...(opts.extra ?? [])],
      primary_email_address_id: opts.primary === false ? null : "idn_1",
    });
    const idp = auth.identityFromClerkPayload;
    check(idp({ id: "u", email_addresses: [{ id: "a", email_address: "x@y.nl", verification: { status: "verified" } }], primary_email_address_id: "a" })?.emailVerified === true
      && idp({ id: "u", email_addresses: [{ id: "a", email_address: "x@y.nl", verification: { status: "unverified" } }], primary_email_address_id: "a" })?.emailVerified === false
      && idp({ id: "u", email_addresses: [{ id: "a", email_address: "x@y.nl", verification: { status: "verified" } }], primary_email_address_id: null })?.emailVerified === false
      && idp({ id: "u", email_addresses: [{ id: "a", email_address: "x@y.nl", verification: { status: "verified" } }, { id: "b", email_address: "p@y.nl", verification: { status: "unverified" } }], primary_email_address_id: "b" })?.emailVerified === false
      && idp({ id: "u", email_addresses: [{ id: "a", email_address: "x@y.nl", verification: null }], primary_email_address_id: "a" })?.emailVerified === false
      && idp({}) === null, "identityFromClerkPayload: verified only for a PRIMARY address with status 'verified'; no primary, an unverified primary, a missing verification block or no id are not", "identityFromClerkPayload rules wrong");

    const wGuest = await prisma.user.create({ data: { email: email("whguest"), name: "Gast" } });
    await prisma.order.create({ data: { userId: wGuest.id, email: wGuest.email, status: "CANCELLED", paymentMethod: "BANK_TRANSFER", subtotalEur: 10, shippingEur: 0, totalEur: 10, vatRate: 0.21, vatEur: 1.74, shippingAddress: "{}" } });
    const claimed = async () => (await prisma.user.findUniqueOrThrow({ where: { id: wGuest.id } })).clerkId;
    const c1 = clerkId();
    const r1 = await post("user.created", payload(c1, wGuest.email, { status: "unverified" }));
    check(r1.status === 200 && (await claimed()) === null && (await prisma.user.findUnique({ where: { clerkId: c1 } }))?.email.endsWith(auth.PLACEHOLDER_EMAIL_SUFFIX) === true, "Clerk user.created with an UNVERIFIED primary address: nothing is claimed, the typed address is not stored", `webhook claimed via an unverified address: ${await claimed()}`);
    const c2 = clerkId();
    await post("user.created", payload(c2, wGuest.email, { primary: false }));
    check((await claimed()) === null, "Clerk user.created with a verified address but NO primary address id: not claimed", "webhook claimed without a primary address");
    const c3 = clerkId();
    await post("user.created", { ...payload(c3, wGuest.email, { status: "verified" }), email_addresses: [{ id: "idn_1", email_address: wGuest.email, verification: { status: "verified" } }, { id: "idn_2", email_address: email("primaryother"), verification: { status: "unverified" } }], primary_email_address_id: "idn_2" });
    check((await claimed()) === null, "Clerk user.created where the verified address is not the primary one: not claimed", "webhook claimed via a non-primary address");
    const c4 = clerkId();
    const r4 = await post("user.updated", payload(c4, ` ${wGuest.email.toUpperCase()} `, { status: "verified" }));
    check(r4.status === 200 && (await claimed()) === c4, "Clerk user.updated with a VERIFIED primary address (capitals + spaces): the guest row is claimed", `webhook did not claim for a verified primary: ${await claimed()}`);
    const c5 = clerkId();
    await post("user.created", payload(c5, WEBHOOK_ADMIN, { status: "unverified" }));
    const adminUnverified = await prisma.user.findUnique({ where: { clerkId: c5 } });
    const c6 = clerkId();
    await post("user.created", payload(c6, WEBHOOK_ADMIN, { status: "verified" }));
    const adminVerified = await prisma.user.findUnique({ where: { clerkId: c6 } });
    check(adminUnverified?.role === "CONSUMER" && adminVerified?.role === "ADMIN" && adminVerified.email === WEBHOOK_ADMIN, "Clerk webhook + ADMIN_EMAILS from the environment: unverified listed address stays CONSUMER, verified one becomes ADMIN", `webhook admin: unverified ${adminUnverified?.role}, verified ${adminVerified?.role}`);

    // KvK lookup: never a made-up company outside demo mode
    const kvk = await import("../src/app/api/monteur/kvk-lookup/route");
    delete process.env.KVK_API_KEY;
    const kvkRes = await kvk.POST(req("/api/monteur/kvk-lookup", { method: "POST", body: { kvkNumber: "12345678" } }));
    const kvkBody = (await kvkRes.json()) as Json;
    check(kvkRes.status === 503 && !JSON.stringify(kvkBody).includes("companyName") && !JSON.stringify(kvkBody).includes("Hoofdstraat"), "KvK lookup without KVK_API_KEY (not demo mode): 503, no invented company (before: 200 with 'Demo Monteur ####, Hoofdstraat 1')", `kvk-lookup: ${kvkRes.status} ${JSON.stringify(kvkBody)}`);

    // The legacy "API" plan is called Monteur Pro, not Gratis; the diagnosis counters come from the rolling quota
    const legacy = await mkUser({ tag: "legacyapi", plan: "API" });
    signInAs(legacy);
    const lj = (await (await planRoute.GET()).json()) as Json;
    check(lj.plan === "API" && lj.planName === "Monteur Pro", "/api/user/plan: the legacy API plan is named 'Monteur Pro' (before: 'Gratis' next to unlimited limits)", `legacy plan name: ${lj.planName}`);
    const quotaUser = await mkUser({ tag: "quota", plan: "FREE" });
    signInAs(quotaUser);
    const q0 = (await (await planRoute.GET()).json()) as Json;
    const limit = plansLib.PLANS.FREE.diagnosesPerMonth;
    check(q0.diagnosesLimit === limit && q0.diagnosesUsed === 0 && q0.diagnosesRemaining === limit, `/api/user/plan counters for a fresh FREE account: used 0 of ${limit}, remaining ${limit}`, `plan route counters: ${JSON.stringify({ l: q0.diagnosesLimit, u: q0.diagnosesUsed, r: q0.diagnosesRemaining })}`);
    await entitlements.consumeUsage("diagnose", `user:${quotaUser.id}`, limit);
    await entitlements.consumeUsage("diagnose", `user:${quotaUser.id}`, limit);
    const q2 = (await (await planRoute.GET()).json()) as Json;
    check(q2.diagnosesUsed === 2 && q2.diagnosesRemaining === limit - 2 && q2.diagnosesLimit === limit, `/api/user/plan counters follow the rolling quota /api/diagnose enforces: after 2 diagnoses, used 2 of ${limit}, remaining ${limit - 2}`, `plan route after 2 uses: ${JSON.stringify({ l: q2.diagnosesLimit, u: q2.diagnosesUsed, r: q2.diagnosesRemaining })}`);
    await prisma.usageCounter.deleteMany({ where: { scope: "diagnose", key: `user:${quotaUser.id}` } });
  }

  // ─── Rendered UI states (server-side render of the real client components) ───
  {
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { UpgradeButton } = await import("../src/app/upgrade/upgrade-button");
    const { PlanActivation } = await import("../src/app/upgrade/plan-activation");
    const { SubscriptionBanner } = await import("../src/app/dashboard/subscription-banner");
    const { WITHDRAWAL_WAIVER_TEXT } = await import("../src/app/upgrade/consent");
    // useRouter() needs a router in context; a stub is enough to render the first paint.
    const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
    const stubRouter = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
    const html = (el: unknown) => renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: stubRouter as never }, el as import("react").ReactElement));
    const snap = (o: Partial<import("../src/app/upgrade/plan-activation").PlanSnapshot>) => ({ plan: "FREE", planName: "Gratis", subscriptionStatus: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, partsDiscountWhenPaying: 0, ...o });

    const withBox = html(React.createElement(UpgradeButton, { plan: "PARTICULIER", requiresWaiver: true }));
    const noBox = html(React.createElement(UpgradeButton, { plan: "PARTICULIER", requiresWaiver: false }));
    check(withBox.includes('data-testid="withdrawal-waiver"') && withBox.includes(WITHDRAWAL_WAIVER_TEXT.slice(0, 40)) && !noBox.includes("withdrawal-waiver"), "UpgradeButton: the consent checkbox with the exact waiver text is rendered when required, and only then", "UpgradeButton consent rendering wrong");

    const waiting = html(React.createElement(PlanActivation, { initial: snap({}) }));
    const trial = html(React.createElement(PlanActivation, { initial: snap({ plan: "MONTEUR_PRO", planName: "Monteur Pro", subscriptionStatus: "trialing", currentPeriodEnd: new Date(Date.UTC(2026, 10, 3, 12)).toISOString(), partsDiscountWhenPaying: 0.1 }) }));
    const active = html(React.createElement(PlanActivation, { initial: snap({ plan: "BEDRIJF", planName: "Bedrijf", subscriptionStatus: "active", currentPeriodEnd: new Date(Date.UTC(2026, 10, 3, 12)).toISOString(), partsDiscountWhenPaying: 0.15 }) }));
    const wrongPlan = html(React.createElement(PlanActivation, { initial: snap({ plan: "BEDRIJF", planName: "Bedrijf", subscriptionStatus: "active" }), expectedPlan: "PARTICULIER" }));
    check(/We verwerken je betaling/.test(waiting) && !/proefperiode|actief/.test(waiting), "PlanActivation, plan not yet written: 'We verwerken je betaling', no plan claimed", `activation waiting state: ${waiting.slice(0, 200)}`);
    check(/Monteur Pro-proefperiode is gestart/.test(trial) && /3 november 2026/.test(trial) && /10% korting op onderdelen gaat in zodra/.test(trial), "PlanActivation, trialing: names the plan, the first payment date (3 november 2026, Amsterdam) and says the parts discount starts with the first payment", `activation trial state: ${trial.replace(/<[^>]+>/g, " ").slice(0, 300)}`);
    check(/Bedrijf-abonnement is actief/.test(active) && /Volgende verlenging/.test(active) && /We verwerken/.test(wrongPlan), "PlanActivation, active: confirmation with the renewal date; waiting for a plan that is not the one on the account stays on 'verwerken'", "activation active/wrong-plan states wrong");

    const banners: [string, import("../src/app/dashboard/subscription-banner").BannerNotice, RegExp][] = [
      ["past_due", { kind: "past_due", planName: "Monteur Pro", graceEndsAt: new Date(Date.UTC(2026, 9, 20, 12)).toISOString(), lapsed: false }, /niet gelukt.*20 oktober 2026.*Betaalmethode bijwerken/s],
      ["lapsed", { kind: "past_due", planName: "Monteur Pro", graceEndsAt: null, lapsed: true }, /uitstelperiode is voorbij.*terug op Gratis/s],
      ["payment_required", { kind: "payment_required", planName: "Bedrijf" }, /staat open voor betaling.*Betaalmethode bijwerken/s],
      ["ending", { kind: "ending", planName: "Bedrijf", endsAt: new Date(Date.UTC(2026, 10, 3, 12)).toISOString() }, /opgezegd.*3 november 2026.*Beheer abonnement/s],
    ];
    const bannerBad: string[] = [];
    for (const [name, notice, re] of banners) {
      const out = html(React.createElement(SubscriptionBanner, { notice }));
      if (!re.test(out) || !out.includes(`subscription-banner-${notice.kind}`)) bannerBad.push(name);
    }
    check(bannerBad.length === 0, "SubscriptionBanner: past_due, lapsed, payment_required and ending render their text, date and button", `banner states wrong: ${bannerBad.join(", ")}`);

    // No hard-coded support address in the customer-facing components; the configured one or the contact page is used
    const read = (p: string) => fs.readFileSync(path.join(repo, p), "utf8");
    const files = ["src/app/upgrade/upgrade-button.tsx", "src/app/upgrade/plan-activation.tsx", "src/app/dashboard/subscription-banner.tsx"];
    const hard = files.filter((f) => /support@wasfix\.nl/.test(read(f)));
    const { supportHint } = await import("../src/lib/support-hint");
    check(hard.length === 0 && supportHint("hulp@voorbeeld.test") === "mail hulp@voorbeeld.test" && /\/contact/.test(supportHint(null)) && !/@/.test(supportHint(null)), "Customer-facing messages use the configured COMPANY_EMAIL, or a pointer to /contact, never a hard-coded support@wasfix.nl", `hard-coded address in: ${hard.join(", ")}`);
    const stalled = html(React.createElement(PlanActivation, { initial: snap({}), supportEmail: "hulp@voorbeeld.test" }));
    check(!/support@wasfix/.test(stalled), "PlanActivation renders without a hard-coded support address", "support address in activation");
  }

  // ─── Phase 2: programme OFF by default, in a child process (the flag is read at start-up) ───
  section("6b. Referral programme OFF (default): nothing tracked, nothing credited, page hidden");
  for (const phase of ["off", "unset", "noclerk"]) {
    const child = spawnSync(process.execPath, ["--import", "tsx", __filename], {
      env: { ...process.env, QA_PLANS_PHASE: phase, NODE_OPTIONS: "", ...(phase === "noclerk" ? { NODE_ENV: "production", CLERK_SECRET_KEY: "", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "" } : {}) },
      encoding: "utf8",
      cwd: repo,
      timeout: 120_000,
    });
    const childLines = (child.stdout ?? "").split("\n").filter((l) => /^(✅|❌)/.test(l));
    for (const l of childLines) log.push(l.replace(/^(✅|❌) /, `$1 [${phase === "off" ? "flag =false" : phase === "unset" ? "flag not set" : "production, no Clerk keys"}] `));
    if (childLines.length === 0) log.push(`❌ referral-${phase} child produced no checks: ${(child.stderr ?? "").slice(0, 400)}`);
  }

  // The programme can only be switched on once the payment path proves a first PAID order (the reward needs an order id).
  {
    const read = (p: string) => fs.readFileSync(path.join(repo, p), "utf8");
    const dispatch = read("src/app/api/stripe/_lib/dispatch.ts");
    const wired = /recordConversion\(\s*refVisitorId\s*,\s*[^)]*orderId/.test(dispatch);
    const flagOffInExample = /NEXT_PUBLIC_FEATURE_REFERRAL=false/.test(read(".env.example"));
    check(wired || flagOffInExample, wired ? "Referral reward is wired to the payment path (an order id reaches recordConversion)" : "Referral reward is not wired in the Stripe webhook yet (no order id passed), and the programme is shipped OFF in .env.example, so nothing promises a credit that cannot be booked", "The referral flag is documented ON but the Stripe webhook passes no order id to recordConversion: no reward can ever be booked");
  }

  // ─── Clean up what this run created ───
  const qaUsers = await prisma.user.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { id: true } });
  const ids = qaUsers.map((u) => u.id);
  const orders = await prisma.order.findMany({ where: { OR: [{ userId: { in: ids } }, { email: { endsWith: `@${DOMAIN}` } }] }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  await prisma.creditNote.deleteMany({ where: { invoice: { orderId: { in: orderIds } } } }).catch(() => null);
  await prisma.invoice.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => null);
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } }).catch(() => null);
  await prisma.referral.deleteMany({ where: { OR: [{ referrerId: { in: ids } }, { visitorId: { startsWith: `vis-${RUN}` } }] } }).catch(() => null);
  await prisma.usageCounter.deleteMany({ where: { scope: "api", key: { in: ids.map(apiAuth.apiQuotaKeyFor) } } }).catch(() => null);
  await prisma.monteurApplication.deleteMany({ where: { applicationId: { startsWith: `MNT-${RUN}` } } }).catch(() => null);
  await prisma.customer.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => null);
  await prisma.monteurProfile.deleteMany({ where: { userId: { in: ids } } }).catch(() => null);
  await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => null);
  await cleanupParts();
  void entitlements; void subscription; void createHash;
  slack.close();

  report();
  await prisma.$disconnect();
  process.exit(log.some((l) => l.startsWith("❌")) ? 1 : 0);

  function report() {
    for (const l of log) realLog(l);
    const fails = log.filter((l) => l.startsWith("❌")).length;
    const passes = log.filter((l) => l.startsWith("✅")).length;
    realLog(`\n${passes} passed, ${fails} failed`);
  }
}

// ─── Production without Clerk keys (the live site today): nobody is signed in, and that is not an error to log on every request ───
async function noClerkPhase() {
  const Mod = (await import("node:module")).default as unknown as { _load: (...a: unknown[]) => unknown };
  const origLoad = Mod._load;
  Mod._load = function patched(this: unknown, ...args: unknown[]) {
    const [request] = args as [string];
    if (request === "server-only" || /\.css$/.test(request)) return {};
    return origLoad.apply(this, args);
  };
  const captured: string[] = [];
  for (const k of ["log", "info", "warn", "error", "debug"] as const) (console as unknown as Record<string, (...a: unknown[]) => void>)[k] = (...a: unknown[]) => { captured.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };
  const ok = (cond: boolean, good: string, bad: string) => process.stdout.write(`${cond ? "✅" : "❌"} ${cond ? good : bad}\n`);
  const { env } = await import("../src/lib/env");
  const { isDemoMode } = await import("../src/lib/demo-mode");
  const auth = await import("../src/lib/auth");
  ok(env.IS_PRODUCTION && !env.CLERK_SECRET_KEY && !isDemoMode(), "Precondition: production build mode, no Clerk keys, demo mode off", `precondition: prod ${env.IS_PRODUCTION}, clerk ${!!env.CLERK_SECRET_KEY}, demo ${isDemoMode()}`);
  const users = [await auth.getCurrentUser(), await auth.getCurrentUser(), await auth.getCurrentUser()];
  const noise = captured.filter((l) => /could not resolve the signed-in user|Clerk|clerkMiddleware/i.test(l));
  ok(users.every((u) => u === null) && noise.length === 0, "getCurrentUser() answers null without any warning or exception when Clerk is not configured (before: a multi-line Clerk error logged on every page view)", `users ${JSON.stringify(users)}, log lines: ${noise.join(" | ").slice(0, 300)}`);
  process.exit(0);
}

// ─── The OFF phase: runs alone in a child process ───
async function offPhase() {
  const captured: string[] = [];
  void captured;
  const { NextRequest } = await import("next/server");
  const Mod = Module as unknown as { _load: (...a: unknown[]) => unknown };
  const origLoad = Mod._load;
  Mod._load = function patched(this: unknown, ...args: unknown[]) {
    const [request] = args as [string];
    if (request === "server-only") return {};
    return origLoad.apply(this, args);
  };
  for (const k of ["log", "info", "warn", "error", "debug"] as const) (console as unknown as Record<string, () => void>)[k] = () => undefined;
  const { prisma } = await import("../src/lib/prisma");
  const referrals = await import("../src/lib/referrals");
  const track = await import("../src/app/api/referral/track/route");
  const stats = await import("../src/app/api/referral/stats/route");

  const ok = (cond: boolean, good: string, bad: string) => process.stdout.write(`${cond ? "✅" : "❌"} ${cond ? good : bad}\n`);
  ok(referrals.REFERRAL_ENABLED === false, PHASE === "unset" ? "Flag NEXT_PUBLIC_FEATURE_REFERRAL not set at all reads as OFF" : "Flag NEXT_PUBLIC_FEATURE_REFERRAL=false reads as OFF", "flag not off");
  const owner = await prisma.user.create({ data: { email: `off-ref-${RUN}@${DOMAIN}`, referralCode: `OFF${RUN.toUpperCase().slice(-5)}` } });
  const visitor = `vis-${RUN}-off`;
  await referrals.recordClick(owner.referralCode!, visitor, "/", null);
  const rows = await prisma.referral.count({ where: { visitorId: visitor } });
  const conv = await referrals.recordConversion(visitor, undefined, { orderId: "whatever" });
  ok(rows === 0 && !conv.rewarded && conv.reason === "programme_off", "Programme off: a click writes no row and a conversion books nothing", `off-state: rows ${rows}, ${JSON.stringify(conv)}`);

  const res = await track.POST(new NextRequest("http://localhost/api/referral/track", { method: "POST", headers: { "content-type": "application/json", "x-vercel-forwarded-for": "10.9.9.9" }, body: JSON.stringify({ code: owner.referralCode }) }));
  const body = (await res.json()) as Record<string, unknown>;
  ok(res.status === 200 && body.tracked === false && res.cookies.getAll().length === 0 && (await prisma.referral.count({ where: { code: owner.referralCode! } })) === 0, "Track route (off): answers tracked:false, sets no cookie, stores nothing", `track off: ${JSON.stringify(body)} cookies ${res.cookies.getAll().length}`);
  const st = await stats.GET(new NextRequest("http://localhost/api/referral/stats"));
  ok(st.status === 404, "Stats route (off): 404", `stats off: ${st.status}`);

  const page = await import("../src/app/dashboard/referrals/page");
  let notFound = false;
  try { await page.default(); } catch (err) { notFound = /NEXT_(HTTP_ERROR_FALLBACK;404|NOT_FOUND)/.test(String((err as { digest?: string }).digest ?? err)); }
  ok(notFound, "/dashboard/referrals (off): notFound()", "referral page rendered with the programme off");

  await prisma.user.delete({ where: { id: owner.id } });
  await prisma.$disconnect();
  process.exit(0);
}

(PHASE === "noclerk" ? noClerkPhase() : PHASE === "off" || PHASE === "unset" ? offPhase() : main()).catch((err) => {
  process.stdout.write(`❌ qa-plans crashed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
