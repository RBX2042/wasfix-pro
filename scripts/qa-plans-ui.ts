/**
 * Browser checks for the plan / payment screens (the part qa-plans.ts cannot see:
 * real clicks, real layout). Needs a running DEMO server, where every visitor is
 * the seeded superadmin, and the SAME database that server uses: the script
 * changes that one account's plan to put the pages in each state, and restores it.
 *
 *   NEXT_DIST_DIR=.next-a5 DATABASE_URL=... DEMO_MODE=true npx next dev --port 3205
 *   DATABASE_URL=... BASE_URL=http://localhost:3205 npx tsx scripts/qa-plans-ui.ts
 *
 * It proves: no horizontal scroll at 375px on every dashboard / monteur / plan page,
 * the consent checkbox and each error message of the upgrade button, the "we are
 * processing your payment" wait that turns into the confirmation, and the
 * past-due banner with its portal button.
 */
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url ?? __filename);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require("/opt/node22/lib/node_modules/playwright/index.js");

const BASE = process.env.BASE_URL ?? "http://localhost:3205";
const SUPERADMIN = "jdahoe@hotmail.nl";
const prisma = new PrismaClient();
const out: string[] = [];
const check = (cond: boolean, ok: string, bad: string) => out.push(cond ? `✅ ${ok}` : `❌ ${bad}`);

async function main() {
  const original = await prisma.user.findUniqueOrThrow({ where: { email: SUPERADMIN } });
  const setState = (data: Record<string, unknown>) => prisma.user.update({ where: { id: original.id }, data });
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(60_000);

    // ── 1. No horizontal scroll at 375px, as a paying monteur ──
    await setState({ plan: "BEDRIJF", stripeSubStatus: "active", stripeCurrentPeriodEnd: new Date(Date.now() + 20 * 86_400_000), stripeCancelAtPeriodEnd: false });
    const paths = ["/dashboard", "/dashboard/api-keys", "/dashboard/profiel", "/dashboard/bestellingen", "/dashboard/diagnoses", "/dashboard/wasmachines", "/monteur/dashboard", "/monteur/klanten", "/monteur/werkorders", "/monteur/onderdelen", "/monteur/instellingen", "/upgrade?plan=PARTICULIER", "/prijzen", "/api-docs", "/inloggen", "/registreren"];
    const wide: string[] = [];
    for (const p of paths) {
      await page.goto(BASE + p, { waitUntil: "networkidle" });
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      if (w > 375) wide.push(`${p}=${w}`);
    }
    check(wide.length === 0, `No horizontal scroll at 375px on ${paths.length} pages (scrollWidth <= 375)`, `horizontal overflow at 375px: ${wide.join(", ")}`);

    // ── 2. Upgrade button as a FREE account ──
    await setState({ plan: "FREE", stripeSubStatus: null, stripeCurrentPeriodEnd: null });
    await page.goto(BASE + "/upgrade?plan=PARTICULIER", { waitUntil: "networkidle" });
    let calls = 0;
    let reply: { status: number; body: unknown } = { status: 503, body: { error: "Betaalde abonnementen zijn tijdelijk niet beschikbaar." } };
    let lastBody = "";
    await page.route("**/api/stripe/subscribe", async (route: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      calls += 1;
      lastBody = route.request().postData() ?? "";
      await route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
    });
    const button = page.getByRole("button", { name: "Upgrade nu" });
    // A dev build hydrates after "networkidle": wait until React has attached (the button's props key appears).
    await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Upgrade nu")); return !!b && Object.keys(b).some((k) => k.startsWith("__reactProps")); });
    const box = page.getByTestId("withdrawal-waiver");
    check((await box.count()) === 1, "FREE account on /upgrade?plan=PARTICULIER sees the withdrawal-waiver checkbox", "no consent checkbox for the consumer plan");
    await button.click();
    check(calls === 0 && (await page.locator("p[role=alert]").innerText()).includes("Vink eerst aan"), "Clicking without ticking: a visible message and NO request is sent", `calls ${calls}`);
    await box.check();
    await button.click();
    await page.locator("p[role=alert]").filter({ hasText: "tijdelijk niet beschikbaar" }).waitFor();
    check(calls === 1 && JSON.parse(lastBody).withdrawalWaiver === true, "Ticked: the request carries withdrawalWaiver:true, and a 503 shows the server's own message", `calls ${calls} body ${lastBody}`);
    reply = { status: 500, body: {} };
    await button.click();
    await page.locator("p[role=alert]").filter({ hasText: "niet gelukt" }).waitFor();
    check(!(await page.locator("p[role=alert]").innerText()).includes("support@wasfix.nl"), "A bare 500 shows the Dutch fallback without a hard-coded support address", "fallback names support@wasfix.nl");
    reply = { status: 401, body: { error: "Niet ingelogd" } };
    await button.click();
    await page.waitForURL("**/registreren?plan=particulier");
    check(true, "A 401 sends the visitor to /registreren?plan=particulier", "");
    await page.goto(BASE + "/upgrade?plan=PARTICULIER", { waitUntil: "networkidle" });
    await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Upgrade nu")); return !!b && Object.keys(b).some((k) => k.startsWith("__reactProps")); });
    await page.route("**/__stripe", (route: any) => route.fulfill({ status: 200, contentType: "text/html", body: "stripe" })); // eslint-disable-line @typescript-eslint/no-explicit-any
    reply = { status: 200, body: { checkoutUrl: `${BASE}/__stripe` } };
    await page.getByTestId("withdrawal-waiver").check();
    await page.getByRole("button", { name: "Upgrade nu" }).click();
    await page.waitForURL("**/__stripe");
    check(true, "A checkout URL in the answer navigates to it", "");

    // ── 3. A customer who already pays for another plan: no checkbox, portal ──
    await setState({ plan: "BEDRIJF", stripeSubStatus: "active", stripeCurrentPeriodEnd: new Date(Date.now() + 20 * 86_400_000) });
    await page.goto(BASE + "/upgrade?plan=PARTICULIER", { waitUntil: "networkidle" });
    check((await page.getByTestId("withdrawal-waiver").count()) === 0 && (await page.getByText("klantportaal").count()) > 0, "A Bedrijf subscriber on the Particulier page sees no checkbox and is told the button leads to the billing portal", "checkbox or portal text wrong for an existing subscriber");
    lastBody = "";
    await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Upgrade nu")); return !!b && Object.keys(b).some((k) => k.startsWith("__reactProps")); });
    await page.getByRole("button", { name: "Upgrade nu" }).click();
    await page.waitForURL("**/__stripe");
    check(!lastBody.includes("withdrawalWaiver"), "...and the request carries no consent flag (the server sends them to the portal)", `body ${lastBody}`);

    // ── 4. After paying: wait for the webhook, then confirm ──
    await setState({ plan: "FREE", stripeSubStatus: null, stripeCurrentPeriodEnd: null });
    let polls = 0;
    await page.route("**/api/user/plan", async (route: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      polls += 1;
      const paid = polls >= 3;
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ plan: paid ? "BEDRIJF" : "FREE", planName: paid ? "Bedrijf" : "Gratis", subscriptionStatus: paid ? "active" : null, currentPeriodEnd: paid ? new Date(Date.now() + 30 * 86_400_000).toISOString() : null, cancelAtPeriodEnd: false, partsDiscountWhenPaying: 0.15 }),
      });
    });
    await page.goto(BASE + "/dashboard?upgraded=1", { waitUntil: "networkidle" });
    await page.getByText("We verwerken je betaling").waitFor();
    check(true, "/dashboard?upgraded=1 while the plan is still FREE: 'We verwerken je betaling'", "");
    await page.getByText("Bedrijf-abonnement is actief").waitFor({ timeout: 30_000 });
    check(polls >= 3, `...and turns into the confirmation after the webhook has written the plan (${polls} polls)`, `confirmation after ${polls} polls`);
    await page.unroute("**/api/user/plan");

    // ── 5. Failed renewal: banner and portal button ──
    await setState({ plan: "MONTEUR_PRO", stripeSubStatus: "past_due", stripeCurrentPeriodEnd: new Date(Date.now() - 2 * 86_400_000), stripeCancelAtPeriodEnd: false });
    await page.route("**/api/stripe/portal", (route: any) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${BASE}/__stripe` }) })); // eslint-disable-line @typescript-eslint/no-explicit-any
    await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
    await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Betaalmethode bijwerken")); return !!b && Object.keys(b).some((k) => k.startsWith("__reactProps")); });
    const banner = page.getByTestId("subscription-banner-past_due");
    check((await banner.count()) === 1 && (await banner.innerText()).includes("Betaalmethode bijwerken"), "Past-due subscription: the banner with 'Betaalmethode bijwerken' shows on the dashboard", "no past-due banner");
    await banner.getByRole("button", { name: "Betaalmethode bijwerken" }).click();
    await page.waitForURL("**/__stripe");
    check(true, "...and the button opens the billing portal", "");
  } finally {
    await prisma.user.update({
      where: { id: original.id },
      data: { plan: original.plan, role: original.role, stripeSubStatus: original.stripeSubStatus, stripeCurrentPeriodEnd: original.stripeCurrentPeriodEnd, stripeCancelAtPeriodEnd: original.stripeCancelAtPeriodEnd },
    });
    await browser.close();
    await prisma.$disconnect();
  }
}

main().then(
  () => {
    out.forEach((l) => process.stdout.write(l + "\n"));
    process.stdout.write(`\n${out.filter((l) => l.startsWith("✅")).length} passed, ${out.filter((l) => l.startsWith("❌")).length} failed\n`);
    process.exit(out.some((l) => l.startsWith("❌")) ? 1 : 0);
  },
  (err) => {
    out.forEach((l) => process.stdout.write(l + "\n"));
    process.stdout.write(`❌ qa-plans-ui crashed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  },
);
