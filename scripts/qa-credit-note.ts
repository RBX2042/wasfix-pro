/**
 * The credit note (creditfactuur) as a DOCUMENT.
 *
 * Terms 7.1 and the return terms promise "een creditfactuur" whenever an invoiced order is cancelled or
 * refunded; until now a customer got a number in a mail and one line on the invoice page. This suite checks
 *   - the data the document prints (sign convention, VAT split, lines, seller and buyer, the invoice it corrects),
 *   - the address of the document and the links to it from the mails and the order page,
 *   - over HTTP, when a server is running: who may open it (token, never without), what the page shows, the
 *     headers (noindex, no-referrer), that a credit note number of ANOTHER order is a 404, and the neighbours of
 *     the same bundle (return link on the order page, no placeholder tile, the packing slip warning, the
 *     dashboard's account/guest split).
 *
 * Runs against a real Postgres. The HTTP part needs a server on the SAME database:
 *   QA_ANON_URL   a server where the caller is nobody (a production build, or `next dev` without DEMO_MODE):
 *                 the token rules are checked here
 *   QA_BASE_URL   a server where every caller is the admin (`next dev` with DEMO_MODE=true): the admin pages
 *   Without them the HTTP checks are reported as SKIPPED, never as passed; with QA_REQUIRE_HTTP=1 a skip makes the run fail (use it in CI).
 *
 * Usage: DATABASE_URL=... [QA_ANON_URL=http://localhost:3201] [QA_BASE_URL=http://localhost:3201] \
 *        npx tsx --conditions=react-server scripts/qa-credit-note.ts
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

const log: string[] = [];
const check = (cond: boolean, ok: string, bad: string) => log.push(cond ? `✅ ${ok}` : `❌ ${bad}`);
const skipped = (what: string) => log.push(`⏭️  SKIPPED ${what}`);

const DOMAIN = "qa-credit-note.test";
const SKU_PREFIX = "QA-CN-";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const slackBodies: string[] = [];
  const slack = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { slackBodies.push(body); res.statusCode = 200; res.end("ok"); });
  });
  await new Promise<void>((r) => slack.listen(0, "127.0.0.1", r));
  process.env.SLACK_WEBHOOK_URL = `http://127.0.0.1:${(slack.address() as AddressInfo).port}/hook`;
  delete process.env.RESEND_API_KEY;
  delete process.env.DISCORD_WEBHOOK_URL;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const inv = await import("../src/lib/invoicing");
  const st = await import("../src/lib/order-status");
  const access = await import("../src/app/bestelling/_lib/access");

  const cleanup = async () => {
    const orders = await prisma.order.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { id: true } });
    const ids = orders.map((o) => o.id);
    await prisma.creditNote.deleteMany({ where: { invoice: { orderId: { in: ids } } } });
    await prisma.invoice.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { id: { in: ids } } });
    await prisma.part.deleteMany({ where: { sku: { startsWith: SKU_PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    for (const { year } of await prisma.creditNoteSequence.findMany()) {
      if (year >= 2900) continue;
      const rows = await prisma.creditNote.findMany({ where: { year }, select: { number: true } });
      await prisma.creditNoteSequence.update({ where: { year }, data: { last: rows.reduce((m, r) => Math.max(m, Number(r.number.slice(-5))), 0) } });
    }
  };

  try {
    await cleanup();
    let n = 0;
    const guestUser = await prisma.user.create({ data: { email: `guest-user@${DOMAIN}`, name: "QA Gast" } });
    async function mkOrder(opts: { status: string; method?: "STRIPE" | "BANK_TRANSFER"; qty?: number; price?: number; shipping?: number; discount?: number; imageUrl?: string | null; tracking?: boolean }) {
      const qty = opts.qty ?? 3;
      const part = await prisma.part.create({
        data: { sku: `${SKU_PREFIX}${Date.now()}-${++n}`, name: `Creditnota onderdeel ${n}`, brand: "QA", category: "OTHER", priceEur: opts.price ?? 10.15, stock: 50, imageUrl: opts.imageUrl === undefined ? null : opts.imageUrl },
      });
      const goods = inv.money(part.priceEur * qty);
      const shipping = opts.shipping ?? 0;
      const discount = opts.discount ?? 0;
      const total = inv.money(goods - discount + shipping);
      const vat = inv.splitVatInclusive(total);
      const method = opts.method ?? (opts.status === "OPENSTAAND" ? "BANK_TRANSFER" : "STRIPE");
      const order = await prisma.order.create({
        data: {
          userId: guestUser.id, email: `buyer${++n}@${DOMAIN}`, status: opts.status, paymentMethod: method,
          subtotalEur: goods, discountEur: discount, shippingEur: shipping, totalEur: total, vatRate: vat.vatRate, vatEur: vat.vatEur,
          accessToken: inv.newAccessToken(),
          shippingAddress: JSON.stringify({ name: "Piet Jansen", street: "Teststraat", houseNumber: "1", postalCode: "1011 AB", city: "Amsterdam" }),
          paidAt: ["PAID", "SHIPPED", "DELIVERED"].includes(opts.status) ? new Date() : null,
          dueAt: method === "BANK_TRANSFER" ? new Date(Date.now() + 14 * 86_400_000) : null,
          ...(opts.tracking ? { carrier: "POSTNL", trackingCode: "3SQACN0001", shippedAt: new Date() } : {}),
          items: { create: [{ partId: part.id, quantity: qty, unitPrice: part.priceEur }] },
        },
      });
      if (st.holdsStock(opts.status)) await prisma.part.update({ where: { id: part.id }, data: { stock: { decrement: qty } } });
      await inv.issueInvoiceForOrder(order.id);
      return { order, part, total, qty };
    }

    // ── 1. What the document prints ───────────────────────────────────────
    const full = await mkOrder({ status: "OPENSTAAND", qty: 3, price: 12.34, shipping: 5.95, discount: 2 });
    await inv.cancelOrder(full.order.id, { reason: "klant belde", actor: "admin" });
    const fullNote = (await inv.getCreditNotesForOrder(full.order.id))[0];
    const fullInvoice = (await inv.getInvoiceForOrder(full.order.id))!;
    const printed = fullNote.lines.reduce((s, l) => s + l.lineTotalEur, 0);
    check(
      fullNote.totalEur === fullInvoice.totalEur && fullNote.invoiceNumber === fullInvoice.number && inv.money(printed) === fullNote.totalEur,
      `Full credit note ${fullNote.number}: credits exactly the invoice (${fullInvoice.totalEur}), names invoice ${fullInvoice.number}, and its printed lines (goods + shipping - discount) add up to the total`,
      `Full credit note: total ${fullNote.totalEur} vs invoice ${fullInvoice.totalEur}, lines add up to ${printed}`,
    );
    check(
      inv.money(fullNote.subtotalEur + fullNote.vatEur) === fullNote.totalEur && fullNote.vatEur === fullInvoice.vatEur && fullNote.totalEur > 0 && fullNote.vatEur > 0 && fullNote.subtotalEur > 0,
      "Sign convention: every amount on the credit note is a POSITIVE magnitude (what is credited); ex-VAT + VAT = total to the cent and the VAT equals the invoice's",
      `Credit note VAT split: ${JSON.stringify({ sub: fullNote.subtotalEur, vat: fullNote.vatEur, total: fullNote.totalEur, invoiceVat: fullInvoice.vatEur })}`,
    );
    check(
      JSON.stringify(fullNote.seller) === JSON.stringify(fullInvoice.seller) && JSON.stringify(fullNote.buyer) === JSON.stringify(fullInvoice.buyer) && !!fullNote.seller.kvk && !!fullNote.buyer.name,
      "The credit note names the same seller and buyer as the invoice it corrects (snapshots from when the invoice was issued)",
      "Credit note seller/buyer differ from the invoice's",
    );
    const shipped = await mkOrder({ status: "SHIPPED", qty: 2, price: 20, tracking: true });
    const part1 = await inv.recordRefund(shipped.order.id, { amountEur: 7.5, idempotencyKey: "qa-cn-part-1", notifyCustomer: false });
    const part2 = await inv.recordRefund(shipped.order.id, { amountEur: 10, idempotencyKey: "qa-cn-part-2", notifyCustomer: false });
    const partNotes = await inv.getCreditNotesForOrder(shipped.order.id);
    const partInvoice = (await inv.getInvoiceForOrder(shipped.order.id))!;
    check(
      part1.ok && part2.ok && partNotes.length === 2 && partNotes.every((c) => c.lines.length === 1 && c.invoiceNumber === partInvoice.number && c.totalEur > 0) && inv.money(partNotes[0].totalEur + partNotes[1].totalEur) === 17.5,
      "Two partial refunds of a shipped order: two credit notes, each with one 'creditering van factuur' line and the invoice number, 7,50 + 10,00 = 17,50 in total",
      `Partial notes: ${JSON.stringify(partNotes.map((c) => [c.number, c.totalEur, c.lines.length]))}`,
    );
    const url = st.creditNoteUrl(shipped.order.id, partNotes[0].number, shipped.order.accessToken);
    const appBase = (await import("../src/lib/env")).env.APP_URL.replace(/\/+$/, "");
    check(
      url === `${appBase}/bestelling/${shipped.order.id}/creditnota/${partNotes[0].number}?t=${shipped.order.accessToken}` && st.returnUrl(shipped.order.id, shipped.order.accessToken).endsWith(`/retour/start?order=${st.orderRef(shipped.order.id)}&t=${shipped.order.accessToken}`),
      "creditNoteUrl and returnUrl build the absolute links the mails and the page use (token as the credential)",
      `URLs: ${url}`,
    );
    // The access rules are the invoice's: token, signed-in owner, admin; nothing else.
    const order = { userId: shipped.order.userId, accessToken: shipped.order.accessToken };
    check(
      access.decideOrderAccess(order, null, shipped.order.accessToken) === "token" && access.decideOrderAccess(order, null, "nope") === null && access.decideOrderAccess(order, null, null) === null &&
        access.decideOrderAccess(order, { id: shipped.order.userId, role: "CONSUMER" }, null) === "owner" && access.decideOrderAccess(order, { id: "other", role: "ADMIN" }, null) === "admin" && access.decideOrderAccess(order, { id: "other", role: "BUSINESS" }, null) === null,
      "Access for the credit note is the invoice's: a valid token, the signed-in owner or an admin; a wrong or missing token and a stranger are out",
      "decideOrderAccess matrix wrong",
    );

    // D2: the cart evaluation (checkout lines and the 409 cart_changed answer) never hands out a placeholder tile as a photo.
    {
      const { publicLine } = await import("../src/lib/cart-pricing");
      const line = (imageUrl: string | null) =>
        publicLine({
          part: { id: "p1", sku: "QA-IMG", name: "QA", brand: "QA", imageUrl, priceEur: 10, stock: 3, isOriginal: true, costEur: null, costSource: null },
          ref: { sku: "QA-IMG" }, requestedQuantity: 1, quantity: 1, status: "ok",
        });
      check(
        line("https://placehold.co/800x800/353535/ffffff/png?text=V-snaar").imageUrl === null && line("https://via.placeholder.com/300").imageUrl === null && line(null).imageUrl === null && line("https://images.unsplash.com/photo-1").imageUrl === "https://images.unsplash.com/photo-1",
        "D2: publicLine() turns a placehold.co / placeholder.com URL into null (no photo) and keeps a real photo URL", "D2: publicLine still exposes a placeholder tile",
      );
    }

    // ── 2. Over HTTP ───────────────────────────────────────────────────────
    const anon = process.env.QA_ANON_URL?.replace(/\/+$/, "");
    const admin = process.env.QA_BASE_URL?.replace(/\/+$/, "");
    const get = async (base: string, path: string) => {
      const res = await fetch(`${base}${path}`, { redirect: "manual" });
      return { status: res.status, headers: res.headers, text: await res.text() };
    };
    const plain = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
    if (!anon) skipped("credit-note page over HTTP (set QA_ANON_URL to a server where the caller is nobody)");
    else {
      const token = shipped.order.accessToken!;
      const cn = partNotes[0];
      const ok = await get(anon, `/bestelling/${shipped.order.id}/creditnota/${cn.number}?t=${token}`);
      const text = plain(ok.text);
      check(
        ok.status === 200 && text.includes("Creditfactuur") && text.includes(cn.number) && text.includes(partInvoice.number) && text.includes(partInvoice.seller.name) && text.includes("Piet Jansen") && /Btw\s*21\s*%/.test(text) && /-\s*€\s*7,50/.test(text) && /Totaal tegoed/.test(text),
        `Credit note page ${cn.number}: seller, buyer, the invoice it corrects, the VAT split and the credited amount as '- € 7,50'`,
        `Credit note page: ${ok.status} ${text.slice(0, 400)}`,
      );
      check(
        /noindex/i.test(ok.headers.get("x-robots-tag") ?? "") && /no-referrer/i.test(ok.headers.get("referrer-policy") ?? "") && /<meta name="robots" content="[^"]*noindex/.test(ok.text) && /<meta name="referrer" content="no-referrer"/.test(ok.text),
        "Credit note page: noindex and no-referrer, as headers and as meta tags (the address carries the credential)",
        `Credit note headers: ${ok.headers.get("x-robots-tag")} / ${ok.headers.get("referrer-policy")}`,
      );
      // A full credit note repeats the invoice: goods and shipping come back as '-€', the invoice's discount line as '+€'
      // (the customer gets that much LESS back), and the column adds up to the total.
      const fullPage = plain((await get(anon, `/bestelling/${full.order.id}/creditnota/${fullNote.number}?t=${full.order.accessToken}`)).text);
      check(/Verzendkosten[^€]*€\s*5,95\s*-\s*€\s*5,95/.test(fullPage) && /Korting[^€]*€\s*-2,00\s*\+\s*€\s*2,00/.test(fullPage) && /Totaal tegoed \(incl\. btw\)\s*-\s*€\s*40,97/.test(fullPage),
        "Credit note page of a full cancellation: shipping credited as '-€ 5,95', the invoice's discount as '+€ 2,00', total '-€ 40,97'", `Full credit note page lines: ${fullPage.slice(fullPage.indexOf("Omschrijving"), fullPage.indexOf("Omschrijving") + 400)}`);
      const bad = await get(anon, `/bestelling/${shipped.order.id}/creditnota/${cn.number}?t=not-the-token`);
      const none = await get(anon, `/bestelling/${shipped.order.id}/creditnota/${cn.number}`);
      check(bad.status === 404 && none.status === 404, `Credit note page: a wrong token (${bad.status}) and no token (${none.status}) are both the plain 404`, `Credit note page without access: ${bad.status}/${none.status}`);
      const foreign = await get(anon, `/bestelling/${full.order.id}/creditnota/${cn.number}?t=${full.order.accessToken}`);
      const ghost = await get(anon, `/bestelling/${shipped.order.id}/creditnota/CN-2999-99999?t=${token}`);
      check(foreign.status === 404 && ghost.status === 404, "Credit note page: a number that belongs to ANOTHER order, and a number that does not exist, are 404 even with a valid token", `Foreign/ghost number: ${foreign.status}/${ghost.status}`);
      const page = await get(anon, `/bestelling/${shipped.order.id}?t=${token}`);
      const links = [...page.text.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
      check(
        page.status === 200 && links.includes(`/bestelling/${shipped.order.id}/creditnota/${cn.number}?t=${token}`) && links.includes(`/bestelling/${shipped.order.id}/creditnota/${partNotes[1].number}?t=${token}`),
        "Order page: lists both credit notes with a link to each document (the token goes along)", `Order page credit note links: ${links.filter((l) => /creditnota/.test(l)).join(", ")}`,
      );
      check(links.includes(`/retour/start?order=${st.orderRef(shipped.order.id)}&t=${token}`), "D5: the order page of a SHIPPED order links 'Retour aanvragen' to /retour/start with the order number and the token", `No return link: ${links.filter((l) => /retour/.test(l)).join(", ")}`);
      const cancelledPage = await get(anon, `/bestelling/${full.order.id}?t=${full.order.accessToken}`);
      const cancelledLinks = [...cancelledPage.text.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      check(cancelledPage.status === 200 && cancelledLinks.some((l) => l.includes(`/creditnota/${fullNote.number}`)) && !cancelledLinks.some((l) => l.startsWith("/retour/start")), "Order page of a CANCELLED order: links its credit note and offers no return", `Cancelled order page links: ${cancelledLinks.filter((l) => /retour|creditnota/.test(l)).join(", ")}`);
      // D2: a placeholder photo never becomes an image of the order page.
      const withTile = await mkOrder({ status: "PAID", imageUrl: "https://placehold.co/600x600/353535/ffffff/png?text=Snaar" });
      const tilePage = await get(anon, `/bestelling/${withTile.order.id}?t=${withTile.order.accessToken}`);
      check(tilePage.status === 200 && !/<img[^>]+placehold/i.test(tilePage.text) && !/_next\/image\?url=https?%3A%2F%2Fplacehold/i.test(tilePage.text), "D2: a placehold.co tile is not rendered as the product photo on the order page", "D2: the order page still renders a placehold.co image");
      const realPhoto = await mkOrder({ status: "PAID", imageUrl: "https://images.unsplash.com/photo-qa-credit-note" });
      const realPage = await get(anon, `/bestelling/${realPhoto.order.id}?t=${realPhoto.order.accessToken}`);
      check(realPage.status === 200 && /<img[^>]+images\.unsplash\.com|<img[^>]+images\.unsplash\.com/i.test(realPage.text.replace(/%3A/gi, ":").replace(/%2F/gi, "/")), "D2: a real photo URL (allowed host) still shows on the order page", `D2: the real photo disappeared too (status ${realPage.status})`);
    }

    if (!admin) skipped("admin pages over HTTP (set QA_BASE_URL to a server where every caller is the admin, e.g. next dev with DEMO_MODE=true)");
    else {
      const probe = await get(admin, "/admin");
      if (probe.status !== 200 || !/Admin Dashboard/.test(probe.text)) skipped(`admin pages: ${admin}/admin answered ${probe.status}, so this is not an admin-for-everyone server`);
      else {
        const cancelledOrder = await mkOrder({ status: "OPENSTAAND" });
        await inv.cancelOrder(cancelledOrder.order.id, { reason: "pakbon test", actor: "admin", notifyCustomer: false });
        const unpaid = await mkOrder({ status: "OPENSTAAND" });
        const paid = await mkOrder({ status: "PAID" });
        const cSlip = plain((await get(admin, `/admin/bestellingen/${cancelledOrder.order.id}/pakbon`)).text);
        const uSlip = plain((await get(admin, `/admin/bestellingen/${unpaid.order.id}/pakbon`)).text);
        const pSlip = plain((await get(admin, `/admin/bestellingen/${paid.order.id}/pakbon`)).text);
        check(/GEANNULEERD/.test(cSlip) && /NIET BETAALD/.test(uSlip) && !/GEANNULEERD|NIET BETAALD/.test(pSlip) && /Niet inpakken/.test(cSlip), "D8: the packing slip of a CANCELLED order says GEANNULEERD, of an unpaid one NIET BETAALD (do not pack); a paid order's slip has no banner", `Pakbon banners: cancelled ${/GEANNULEERD/.test(cSlip)}, unpaid ${/NIET BETAALD/.test(uSlip)}, paid has banner ${/GEANNULEERD|NIET BETAALD/.test(pSlip)}`);
        // One real account (it has a Clerk id) next to the guests the orders above created: the dashboard must tell them apart.
        await prisma.user.create({ data: { email: `account@${DOMAIN}`, name: "QA Account", clerkId: `user_qa_cn_${Date.now()}` } });
        const dash = plain((await get(admin, "/admin")).text);
        const { accounts, guests } = await (await import("../src/app/admin/_lib/economics")).accountStats();
        check(accounts >= 1 && !dash.includes("QA Gast") && !dash.includes(`guest-user@${DOMAIN}`) && new RegExp(`Gebruikers \\(met account\\)\\s*${accounts}\\b`).test(dash) && dash.includes(`${guests} gast${guests === 1 ? "" : "en"} bestelden zonder account`), `D10: the dashboard counts ${accounts} account(s) as users, reports ${guests} guest(s) apart, and does not list the guest by name or address`, `D10 dashboard: ${dash.slice(dash.indexOf("Gebruikers"), dash.indexOf("Gebruikers") + 120)}`);
        const desk = plain((await get(admin, "/admin/bestellingen?view=alles")).text);
        check(/Creditfactuur|CN-\d{4}-\d{5}/.test(desk), "Order desk: the cards link the credit notes", "Order desk shows no credit note");
      }
    }
  } finally {
    await cleanup().catch((e) => console.error("cleanup failed", e));
    await prisma.$disconnect();
    slack.close();
  }
  console.log(log.join("\n"));
  const failed = log.filter((l) => l.startsWith("❌")).length;
  const skippedN = log.filter((l) => l.startsWith("⏭️")).length;
  console.log(`\n${log.length - failed - skippedN}/${log.length - skippedN} checks passed${skippedN ? `, ${skippedN} skipped` : ""}`);
  // QA_REQUIRE_HTTP=1 (for CI): a skipped HTTP half is a failure. Without it the token rules, which only a running server can
  // prove, would silently not be checked and the run would still be green.
  const requireHttp = process.env.QA_REQUIRE_HTTP === "1" && skippedN > 0;
  if (requireHttp) console.error(`QA_REQUIRE_HTTP=1 and ${skippedN} HTTP check(s) were skipped: start the servers and pass QA_ANON_URL and QA_BASE_URL`);
  process.exitCode = failed > 0 || requireHttp ? 1 : 0;
}

main().catch((err) => {
  console.error(log.join("\n"));
  console.error("qa-credit-note crashed:", err);
  process.exit(1);
});
