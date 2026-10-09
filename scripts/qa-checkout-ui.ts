/**
 * Browser checks for the checkout form, the cart drawer and the confirmation page (bundle S2).
 *
 * Playwright drives a real Chromium against a running server, so this is what covers the CLIENT code
 * (checkout-client.tsx, cart-provider.tsx, cart-drawer.tsx, order-effects.tsx) that scripts/qa-checkout.ts
 * cannot reach. It creates its own parts and orders (e-mail domain qa-checkout-ui.test, SKU prefix QA-UI-)
 * in the database it is given and removes them afterwards.
 *
 * (QA_EXPECT=admin when the target is the demo dev server, where every visitor is the member account.)
 *
 * Target: a PRODUCTION build run as a guest, with the fictional company identity and a public address:
 *
 *   NEXT_DIST_DIR=.next-a2 NODE_ENV=production DATABASE_URL=... NEXT_PUBLIC_APP_URL=https://wasfix-test.example \
 *     COMPANY_NAME="WasFix Test B.V." COMPANY_STREET="Teststraat 1" COMPANY_POSTAL_CODE="1011 AB" COMPANY_CITY=Amsterdam \
 *     COMPANY_KVK=90000001 COMPANY_VAT=NL900000010B01 COMPANY_IBAN=NL02ABNA0123456789 npx next start --port 3302
 *
 *   QA_BASE_URL=http://localhost:3302 DATABASE_URL=... npx tsx --conditions=react-server scripts/qa-checkout-ui.ts
 *
 * The same COMPANY_* values must be set in this process (it issues no invoices itself, but the server
 * refuses to take orders without them). Playwright is found at PLAYWRIGHT_PATH, default
 * /opt/node22/lib/node_modules/playwright/index.js. Set QA_SCREENSHOTS=<dir> to keep screenshots.
 *
 * One reply of the server is SIMULATED, not real: the 400 for "too many units" (route interception), because
 * the cart now stops the customer before the server would; the point of that check is what the form does with
 * such an answer. Everything else goes to the real server.
 */
import { PrismaClient } from "@prisma/client";

const BASE = (process.env.QA_BASE_URL ?? "").replace(/\/$/, "");
if (!BASE) {
  console.error("QA_BASE_URL is required (a running server).");
  process.exit(2);
}
const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl)) {
  console.error("Refusing to run: DATABASE_URL must point at a local test database.");
  process.exit(2);
}

const DOMAIN = "qa-checkout-ui.test";
const SKU = "QA-UI-";
const prisma = new PrismaClient();
const log: string[] = [];
const check = (cond: boolean, ok: string, bad: string = ok) => log.push(cond ? `✅ ${ok}` : `❌ ${bad}`);

let ipSeq = 0;
const freshIp = () => `198.51.100.${(Date.now() + ++ipSeq) % 250 + 1}`;
let mailSeq = 0;
const freshEmail = (tag: string) => `${tag}${++mailSeq}.${Date.now().toString(36)}@${DOMAIN}`;

async function mkPart(n: number, over: Record<string, unknown> = {}) {
  return prisma.part.create({
    data: { sku: `${SKU}${Date.now().toString(36)}-${n}`, name: `QA UI onderdeel ${n}`, brand: "QA", category: "OTHER", priceEur: 20, costEur: 10, stock: 100, ...over },
  });
}
type PartRow = Awaited<ReturnType<typeof mkPart>>;
const stored = (parts: { part: PartRow; qty: number }[], priceOf: (p: PartRow) => number = (p) => p.priceEur) =>
  JSON.stringify({ state: { items: parts.map(({ part, qty }) => ({ partId: part.id, sku: part.sku, name: part.name, brand: part.brand, priceEur: priceOf(part), quantity: qty, stock: part.stock })) }, version: 2 });

async function cleanup() {
  const orders = await prisma.order.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { id: true } });
  const ids = orders.map((o) => o.id);
  await prisma.creditNote.deleteMany({ where: { invoice: { orderId: { in: ids } } } });
  await prisma.invoice.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.order.deleteMany({ where: { id: { in: ids } } });
  await prisma.part.deleteMany({ where: { sku: { startsWith: SKU } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  for (const { year } of await prisma.invoiceSequence.findMany()) {
    const rows = await prisma.invoice.findMany({ where: { year }, select: { number: true } });
    const max = rows.reduce((m, r) => Math.max(m, Number(r.number.slice(-5))), 0);
    await prisma.invoiceSequence.update({ where: { year }, data: { last: max } });
  }
}

async function main() {
  const pw = await import(process.env.PLAYWRIGHT_PATH ?? "/opt/node22/lib/node_modules/playwright/index.js");
  const chromium = (pw.default ?? pw).chromium;
  const browser = await chromium.launch();
  const shots = process.env.QA_SCREENSHOTS;
  const shot = async (page: any, name: string) => {
    if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
  };
  const newContext = async (width = 375, height = 812) => {
    const ctx = await browser.newContext({ viewport: { width, height }, extraHTTPHeaders: { "x-vercel-forwarded-for": freshIp() } });
    return ctx;
  };
  /** localStorage belongs to an origin: load a tiny same-origin page, set the cart, then go to the real one. */
  const seedCart = async (page: any, value: string | null) => {
    await page.goto(`${BASE}/robots.txt`);
    await page.evaluate(([v]: [string | null]) => {
      localStorage.removeItem("wasfix-checkout-attempt");
      if (v === null) localStorage.removeItem("wasfix-cart");
      else localStorage.setItem("wasfix-cart", v);
    }, [value]);
  };
  const fillForm = async (page: any, email: string, street = "Teststraat") => {
    await page.fill("#email", email);
    await page.fill("#name", "Piet Jansen");
    await page.fill("#phone", "06 12345678");
    await page.fill("#street", street);
    await page.fill("#houseNumber", "1");
    await page.fill("#postalCode", "1011 AB");
    await page.fill("#city", "Amsterdam");
  };
  const orderButton = (page: any) => page.getByRole("button", { name: /Bestelling met betalingsverplichting|Verwerken/ });
  const readyCheckout = async (page: any) => {
    await page.goto(`${BASE}/checkout`);
    await page.waitForSelector("#email, h1:has-text('Je winkelmand is leeg'), h1:has-text('niet mogelijk')");
    await page.waitForTimeout(700); // the server re-check of the cart runs right after mount
  };
  const overflow = (page: any) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const cartIcon = (page: any) => page.getByRole("button", { name: /Winkelmand openen/ }).first();

  try {
    await cleanup();
    const [pa, pb, pc] = [await mkPart(1), await mkPart(2), await mkPart(3)];

    // ── 1. A cart that exceeds the order limits says so before the button, and cannot be submitted ──
    {
      const ctx = await newContext();
      const page = await ctx.newPage();
      await seedCart(page, stored([{ part: pa, qty: 20 }, { part: pb, qty: 20 }, { part: pc, qty: 20 }]));
      await readyCheckout(page);
      const banner = page.getByTestId("cart-over-limit");
      check((await banner.count()) === 1 && /60 stuks/.test(await banner.innerText()) && /50 stuks/.test(await banner.innerText()), "Checkout: a stored cart of 3 x 20 units shows 'Je winkelmand heeft 60 stuks ... maximaal 50' above the form", "Checkout: no over-limit message for a 60-unit cart");
      check(await orderButton(page).isDisabled(), "Checkout: the order button is disabled for that cart", "Checkout: the order button is enabled for a 60-unit cart");
      await shot(page, "over-limit");
      await ctx.close();
    }

    // ── 2. A refusal that is not about an input is SHOWN (it used to vanish: button re-enabled, no text) ──
    {
      const ctx = await newContext();
      const page = await ctx.newPage();
      await seedCart(page, stored([{ part: pa, qty: 2 }]));
      await readyCheckout(page);
      await fillForm(page, freshEmail("silent"));
      // The exact answer the reviewer captured from the server for >50 units.
      await page.route("**/api/checkout", (route: any) =>
        route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "Maximaal 50 stuks per bestelling. Heb je er meer nodig? Neem contact met ons op.", details: { fieldErrors: { items: "Te veel stuks" } } }),
        }),
      );
      await orderButton(page).click();
      await page.waitForTimeout(500);
      const msg = page.locator("#form-error");
      check((await msg.count()) === 1 && /Maximaal 50 stuks per bestelling/.test(await msg.innerText()), "Checkout: a 400 whose error is about 'items' (not an input) is shown above the button with the server's sentence", "Checkout: the 400 about 'items' is silent");
      check(!(await orderButton(page).isDisabled()), "Checkout: the order button is usable again after that refusal", "Checkout: button stuck after refusal");
      check(await page.evaluate(() => document.activeElement?.id === "form-error"), "Checkout: focus moves to the message (keyboard and screen-reader users hear it)", "Checkout: focus not on the message");
      await shot(page, "silent-400");
      await ctx.close();
    }

    // ── 3. A cart that is entirely sold out explains itself (page and drawer) ──
    {
      const [sa, sb] = [await mkPart(11, { stock: 0 }), await mkPart(12, { stock: 0 })];
      const ctx = await newContext();
      const page = await ctx.newPage();
      await seedCart(page, stored([{ part: sa, qty: 1 }, { part: sb, qty: 2 }], () => 20).replace(/"stock":0/g, '"stock":5'));
      await readyCheckout(page);
      const text = await page.locator("main, body").first().innerText();
      check(/Je winkelmand is leeg/.test(text) && /QA UI onderdeel 11 is uitverkocht/.test(text) && /QA UI onderdeel 12 is uitverkocht/.test(text), "Checkout: a cart whose parts all sold out says 'leeg' AND names what was removed and why", "Checkout: an emptied cart is silent about why");
      await shot(page, "sold-out-checkout");
      await seedCart(page, stored([{ part: sa, qty: 1 }], () => 20).replace(/"stock":0/g, '"stock":5'));
      await page.goto(`${BASE}/`);
      await cartIcon(page).click();
      await page.waitForTimeout(1200);
      const dialog = await page.getByRole("dialog", { name: "Winkelmand" }).innerText();
      check(/Je winkelmand is leeg/.test(dialog) && /uitverkocht/.test(dialog), "Drawer: opening it with a sold-out cart says why it is empty", `Drawer: silent about a sold-out cart: ${dialog.slice(0, 120)}`);
      await shot(page, "sold-out-drawer");
      await ctx.close();
    }

    // ── 4. Drawer: the + button stops at the order-wide cap and says which limit it is ──
    {
      const ctx = await newContext();
      const page = await ctx.newPage();
      await seedCart(page, stored([{ part: pa, qty: 20 }, { part: pb, qty: 20 }, { part: pc, qty: 10 }]));
      await page.goto(`${BASE}/`);
      await cartIcon(page).click();
      await page.waitForTimeout(1200);
      const plus = page.getByRole("button", { name: /Aantal verhogen voor/ });
      const disabled = await plus.evaluateAll((els: HTMLButtonElement[]) => els.map((e) => e.disabled));
      const dialog = await page.getByRole("dialog", { name: "Winkelmand" }).innerText();
      check(disabled.length === 3 && disabled.every(Boolean), "Drawer: with 50 units in the cart every + button is disabled", `Drawer: + buttons ${JSON.stringify(disabled)}`);
      check(/Maximaal 50 stuks per bestelling/.test(dialog) && /Maximaal 20 per onderdeel per bestelling/.test(dialog), "Drawer: the notes name the limit that applies (50 per order / 20 per part)", `Drawer notes: ${dialog.slice(0, 200)}`);
      check((await overflow(page)) <= 0, "Drawer: no horizontal scroll at 375 px", "Drawer overflows at 375 px");
      await ctx.close();
    }

    // ── 5. Stale price: banner, button locked until 'Akkoord', then the order goes through ──
    let placed: { id: string; token: string; email: string; url: string } | null = null;
    {
      const ctx = await newContext();
      const page = await ctx.newPage();
      await seedCart(page, stored([{ part: pa, qty: 2 }], () => 18)); // the cart remembers 18,00; the shop now says 20,00
      await readyCheckout(page);
      const alert = page.getByRole("alert").filter({ hasText: "Je winkelmand is aangepast" });
      check((await alert.count()) === 1 && /gewijzigd van .*18,00.* naar .*20,00/.test(await alert.innerText()), "Checkout: a price that changed since the cart was stored is announced (18,00 -> 20,00)", "Checkout: price change not announced");
      check(await orderButton(page).isDisabled(), "Checkout: the order button is locked until the customer accepts the change", "Checkout: order button not locked by the notice");
      await page.getByRole("button", { name: /^Akkoord/ }).click();
      check(!(await orderButton(page).isDisabled()), "Checkout: 'Akkoord' unlocks the button", "Checkout: Akkoord did not unlock");

      // Place the order from far down the page: the confirmation must be shown from the top, with focus on its heading.
      const email = freshEmail("order");
      await fillForm(page, email);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await orderButton(page).click();
      await page.waitForURL(/\/bestelling\/[^?]+\?t=/, { timeout: 20000 });
      await page.waitForSelector("#order-heading");
      await page.waitForTimeout(600);
      const url = page.url();
      const m = /\/bestelling\/([^?]+)\?t=([0-9a-f]+)/.exec(url);
      placed = m ? { id: m[1], token: m[2], email, url } : null;
      check(!!placed, "Checkout: the order is placed and the browser lands on the tokenised confirmation page", `Checkout: no confirmation page, url ${url}`);
      check((await page.evaluate(() => Math.round(window.scrollY))) === 0 && (await page.evaluate(() => document.activeElement?.id)) === "order-heading", "Confirmation: shown from the top (scrollY 0) with focus on the heading, although the form was submitted from the bottom", "Confirmation: not at the top / focus not on the heading");
      const cartAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("wasfix-cart") ?? "{}")?.state?.items?.length ?? 0);
      check(cartAfter === 0, "Confirmation: the cart was emptied", `Confirmation: cart still holds ${cartAfter} lines`);
      check((await page.evaluate(() => localStorage.getItem("wasfix-checkout-attempt"))) === null, "Confirmation: the stored Idempotency-Key is forgotten (the next checkout is a new order)", "Confirmation: the Idempotency-Key was kept");
      const order = placed ? await prisma.order.findUnique({ where: { id: placed.id } }) : null;
      // A guest pays 45,95; against the demo server (everyone is the BEDRIJF account) the 15% member discount applies: 34,00 + 5,95.
      const wantTotal = process.env.QA_EXPECT === "admin" ? 39.95 : 45.95;
      check(order?.totalEur === wantTotal && order?.status === "OPENSTAAND", `Order: 2 x 20,00 at the shop's price (not the stored 18,00)${wantTotal === 45.95 ? " + 5,95 shipping" : " less the 15% member discount + 5,95 shipping"} = ${String(wantTotal).replace(".", ",")}`, `Order total ${order?.totalEur} ${order?.status}, wanted ${wantTotal}`);
      await shot(page, "confirmation");
      await ctx.close();
    }

    // ── 6. Lost response, second tab: one order. Corrected details: a new order, never the old address ──
    {
      const ctx = await newContext();
      await ctx.route("**/api/checkout", async (route: any) => {
        // Only the first request is cut: the server processes it, the browser never sees the answer.
        if ((ctx as any).__cut) {
          (ctx as any).__cut = false;
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      });
      const email = freshEmail("tabs");
      const a = await ctx.newPage();
      await seedCart(a, stored([{ part: pb, qty: 1 }]));
      await readyCheckout(a);
      await fillForm(a, email);
      (ctx as any).__cut = true;
      await orderButton(a).click();
      await a.waitForSelector("text=De verbinding viel weg", { timeout: 15000 });
      const afterLost = await prisma.order.count({ where: { email } });
      check(afterLost === 1, "Lost response: the server DID place the order (1 order) although the browser never got the answer", `Lost response: ${afterLost} orders`);

      const b = await ctx.newPage();
      await readyCheckout(b);
      await fillForm(b, email);
      await orderButton(b).click();
      await b.waitForURL(/\/bestelling\/[^?]+\?t=/, { timeout: 20000 });
      const afterTab = await prisma.order.count({ where: { email } });
      const only = await prisma.order.findFirst({ where: { email } });
      check(afterTab === 1 && b.url().includes(`/bestelling/${only?.id}`), "Second tab, same order: it reuses the Idempotency-Key and lands on the SAME order (still 1 order)", `Second tab: ${afterTab} orders, url ${b.url()}`);
      await ctx.close();

      const ctx2 = await newContext();
      await ctx2.route("**/api/checkout", async (route: any) => {
        if ((ctx2 as any).__cut) {
          (ctx2 as any).__cut = false;
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      });
      const email2 = freshEmail("fix");
      const c = await ctx2.newPage();
      await seedCart(c, stored([{ part: pb, qty: 1 }]));
      await readyCheckout(c);
      await fillForm(c, email2, "Oudestraat");
      (ctx2 as any).__cut = true;
      await orderButton(c).click();
      await c.waitForSelector("text=De verbinding viel weg", { timeout: 15000 });
      await c.fill("#street", "Nieuwestraat");
      await orderButton(c).click();
      await c.waitForURL(/\/bestelling\/[^?]+\?t=/, { timeout: 20000 });
      const rows = await prisma.order.findMany({ where: { email: email2 }, orderBy: { createdAt: "asc" } });
      check(rows.length === 2 && JSON.parse(rows[1].shippingAddress).street === "Nieuwestraat" && c.url().includes(`/bestelling/${rows[1].id}`), "Corrected address after a lost response: a NEW order with the new street (the old order is not silently handed back)", `Corrected address: ${rows.length} orders, streets ${rows.map((r) => JSON.parse(r.shippingAddress).street)}, url ${c.url()}`);
      await ctx2.close();
    }

    // ── 7. Width sweep: nothing may scroll sideways, including the invoice a guest opens from the e-mail ──
    // A long unbreakable SKU and name are what widened the invoice's items table past a 320 px screen.
    const wide = await prisma.part.create({
      data: { sku: `${SKU}WF-WASMACHINE-AFVOERPOMP-UNIVERSEEL-XL-${Date.now().toString(36)}`, name: "Universele wasmachine-afvoerpomp met extra lange aansluitslangset", brand: "QA", category: "OTHER", priceEur: 129.95, costEur: 60, stock: 20 },
    });
    const res = await fetch(`${BASE}/api/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-vercel-forwarded-for": freshIp() },
      body: JSON.stringify({
        items: [{ sku: wide.sku, quantity: 3 }], email: freshEmail("wide"), name: "Piet Jansen", phone: "06 12345678", paymentMethod: "bank_transfer",
        address: { street: "Teststraat", houseNumber: "1", postalCode: "1011 AB", city: "Amsterdam" },
      }),
    });
    const wideJson = (await res.json()) as { redirectUrl?: string };
    const wm = /\/bestelling\/([^?]+)\?t=([0-9a-f]+)/.exec(wideJson.redirectUrl ?? "");
    check(res.status === 200 && !!wm, "Width sweep: an order with a long SKU and name was placed for the sweep", `Width sweep: could not place the order: ${res.status} ${JSON.stringify(wideJson).slice(0, 150)}`);
    placed = wm ? { id: wm[1], token: wm[2], email: "", url: "" } : placed;
    if (placed) {
      for (const width of [320, 360, 375, 390, 412, 430]) {
        const ctx = await newContext(width, 780);
        const page = await ctx.newPage();
        await seedCart(page, stored([{ part: pa, qty: 2 }]));
        await readyCheckout(page);
        const co = await overflow(page);
        await page.goto(`${BASE}/bestelling/${placed.id}?t=${placed.token}&success=1`);
        await page.waitForSelector("#order-heading");
        const conf = await overflow(page);
        await page.goto(`${BASE}/bestelling/${placed.id}/factuur?t=${placed.token}`);
        await page.waitForSelector("table");
        const inv = await overflow(page);
        check(co <= 0 && conf <= 0 && inv <= 0, `No horizontal scroll at ${width} px: /checkout (${co}), confirmation (${conf}), /factuur (${inv})`, `Horizontal overflow at ${width} px: /checkout ${co}, confirmation ${conf}, /factuur ${inv}`);
        if (width === 320) await shot(page, "factuur-320");
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    await cleanup().catch((e) => console.error("cleanup failed", e));
    await prisma.$disconnect();
  }
}

main()
  .catch((e) => {
    console.error("FATAL:", e);
    log.push(`❌ FATAL: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    console.log(log.join("\n"));
    const failures = log.filter((l) => l.startsWith("❌")).length;
    const total = log.filter((l) => l.startsWith("✅") || l.startsWith("❌")).length;
    console.log(`\n${total - failures}/${total} browser checks passed`);
    if (failures > 0) process.exitCode = 1;
    process.exit();
  });
