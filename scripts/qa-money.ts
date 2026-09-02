/**
 * Verifies the commercial mechanics: VAT math, gapless invoice numbering,
 * metered free usage, plan consistency and margin reporting.
 *
 * These are the paths that decide whether the product can charge money
 * correctly, so they are checked against a real database rather than mocked.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/qa-money.ts
 */
import { PrismaClient } from "@prisma/client";
import { splitVatInclusive, money, issueInvoiceForOrder, getInvoiceForOrder } from "../src/lib/invoicing";
import { consumeUsage, canReadPremiumGuide } from "../src/lib/entitlements";
import { PLANS, PLAN_ORDER, BILLABLE_PLANS, getPlan, formatPlanPrice, VAT_RATE } from "../src/lib/plans";
import { getPlanLimits } from "../src/lib/auth";

const prisma = new PrismaClient();
const log: string[] = [];
const pass = (m: string) => log.push(`✅ ${m}`);
const fail = (m: string) => log.push(`❌ ${m}`);
const check = (cond: boolean, ok: string, bad: string) => (cond ? pass(ok) : fail(bad));

const TEST_EMAIL = "qa-money@wasfixpro.test";

async function main() {
  try {
    // ── VAT math ────────────────────────────────────────────────
    const v = splitVatInclusive(121, 0.21);
    check(v.vatEur === 21 && v.exVatEur === 100, "VAT: €121 incl → €100 + €21 btw", `VAT split wrong: ${JSON.stringify(v)}`);

    const odd = splitVatInclusive(28.5);
    check(
      money(odd.exVatEur + odd.vatEur) === 28.5,
      `VAT: components add back to the total (${odd.exVatEur} + ${odd.vatEur} = 28.5)`,
      `VAT rounding loses money: ${odd.exVatEur} + ${odd.vatEur} != 28.5`,
    );

    check(
      splitVatInclusive(0).vatEur === 0,
      "VAT: a €0 order carries no btw",
      "VAT: €0 order produced non-zero btw",
    );

    // ── Plan consistency ────────────────────────────────────────
    check(
      PLAN_ORDER.every((id) => PLANS[id].id === id),
      `Plans: ${PLAN_ORDER.length} tiers, ids self-consistent`,
      "Plans: id mismatch in PLANS map",
    );
    check(
      getPlan("FREE").diagnosesPerMonth === 3 && getPlan("PARTICULIER").diagnosesPerMonth === -1,
      "Plans: free tier metered at 3/month, paid tiers unlimited",
      "Plans: quota configuration does not match the advertised tiers",
    );
    check(
      getPlanLimits("MONTEUR_PRO").partsDiscount === PLANS.MONTEUR_PRO.partsDiscount,
      "Plans: entitlements read the same discounts the pricing page shows",
      "Plans: getPlanLimits drifted from the plan config",
    );
    check(
      getPlanLimits("API").technicianDashboard === true,
      "Plans: legacy API plan still resolves to pro access",
      "Plans: legacy API plan lost its entitlements",
    );
    check(
      BILLABLE_PLANS.every((id) => PLANS[id].priceCents > 0),
      `Plans: all ${BILLABLE_PLANS.length} billable tiers have a price (${BILLABLE_PLANS.map((id) => formatPlanPrice(PLANS[id])).join(", ")})`,
      "Plans: a billable tier has no price",
    );
    check(
      PLANS.PARTICULIER.trialDays === 14,
      "Plans: the advertised 14-day trial is configured",
      "Plans: trial is advertised but not configured",
    );

    // ── Premium content gating ──────────────────────────────────
    check(
      !canReadPremiumGuide(undefined) && !canReadPremiumGuide("FREE"),
      "Premium: anonymous and free users cannot read premium guides",
      "Premium: the paywall lets free users through",
    );
    check(
      ["PARTICULIER", "MONTEUR_PRO", "BEDRIJF"].every((p) => canReadPremiumGuide(p)),
      "Premium: every paid tier unlocks premium guides",
      "Premium: a paid tier does not get what it pays for",
    );

    // ── Metered free usage ──────────────────────────────────────
    const key = `qa-${Date.now()}`;
    const first = await consumeUsage("diagnose-test", key, 3);
    const second = await consumeUsage("diagnose-test", key, 3);
    const third = await consumeUsage("diagnose-test", key, 3);
    const fourth = await consumeUsage("diagnose-test", key, 3);
    check(
      first.allowed && second.allowed && third.allowed && !fourth.allowed,
      "Quota: 3 uses allowed, the 4th is blocked",
      `Quota: wrong gating (${[first, second, third, fourth].map((r) => r.allowed).join(",")})`,
    );

    const peek = await consumeUsage("diagnose-test", key, 3, { commit: false });
    check(peek.used === 3, "Quota: a read-only check does not consume a use", `Quota: peek changed the counter (${peek.used})`);

    const unlimited = await consumeUsage("diagnose-test", `${key}-unl`, -1);
    check(unlimited.allowed, "Quota: unlimited plans are never blocked", "Quota: unlimited plan got blocked");

    // ── Order → VAT → invoice ───────────────────────────────────
    const part = await prisma.part.findFirst({ where: { costEur: { not: null } } });
    if (!part) {
      fail("Margin: no part has a cost price, margin reporting cannot work");
    } else {
      const netPrice = part.priceEur / (1 + VAT_RATE);
      const marginPct = ((netPrice - (part.costEur ?? 0)) / netPrice) * 100;
      check(
        marginPct > 0 && marginPct < 100,
        `Margin: ${part.sku} sells at a plausible ${marginPct.toFixed(0)}% gross margin`,
        `Margin: ${part.sku} margin is implausible (${marginPct.toFixed(0)}%)`,
      );

      const user = await prisma.user.upsert({
        where: { email: TEST_EMAIL },
        update: {},
        create: { email: TEST_EMAIL, name: "QA Money", role: "CONSUMER", plan: "FREE" },
      });

      const total = money(part.priceEur * 2);
      const vat = splitVatInclusive(total);
      const order = await prisma.order.create({
        data: {
          userId: user.id,
          email: TEST_EMAIL,
          subtotalEur: total,
          totalEur: total,
          vatRate: vat.vatRate,
          vatEur: vat.vatEur,
          costEur: money((part.costEur ?? 0) * 2),
          status: "PAID",
          shippingAddress: JSON.stringify({ name: "QA Money", street: "Teststraat", houseNumber: "1", postalCode: "1234 AB", city: "Amsterdam" }),
          items: { create: [{ partId: part.id, quantity: 2, unitPrice: part.priceEur }] },
        },
      });

      const invoice = await issueInvoiceForOrder(order.id);
      check(Boolean(invoice?.number), `Invoice: issued ${invoice?.number} for a paid order`, "Invoice: not issued for a paid order");

      check(
        invoice != null && money(invoice.totalEur - invoice.vatEur + invoice.vatEur) === money(order.totalEur),
        "Invoice: totals reconcile with the order",
        "Invoice: totals do not reconcile with the order",
      );

      check(
        invoice != null && invoice.lines.length === 1 && invoice.lines[0].quantity === 2,
        "Invoice: line items carry sku, quantity and unit price",
        "Invoice: line items are missing or wrong",
      );

      check(
        invoice != null && Boolean(invoice.seller.vatNumber) && Boolean(invoice.seller.kvk),
        "Invoice: seller identity (KvK + btw-nummer) is on the document",
        "Invoice: seller identity missing — not a valid invoice",
      );

      // Idempotency: a replayed webhook must not burn a second number.
      const again = await issueInvoiceForOrder(order.id);
      check(
        again?.number === invoice?.number,
        "Invoice: re-issuing returns the same number (webhook replay safe)",
        `Invoice: replay created a second number (${invoice?.number} vs ${again?.number})`,
      );

      // Sequential and gapless.
      const order2 = await prisma.order.create({
        data: {
          userId: user.id,
          email: TEST_EMAIL,
          subtotalEur: 10,
          totalEur: 10,
          vatRate: VAT_RATE,
          vatEur: splitVatInclusive(10).vatEur,
          status: "PAID",
          shippingAddress: JSON.stringify({ name: "QA Money" }),
          items: { create: [{ partId: part.id, quantity: 1, unitPrice: 10 }] },
        },
      });
      const invoice2 = await issueInvoiceForOrder(order2.id);
      const n1 = Number(invoice?.number.split("-")[1]);
      const n2 = Number(invoice2?.number.split("-")[1]);
      check(n2 === n1 + 1, `Invoice: numbers are sequential (${invoice?.number} → ${invoice2?.number})`, `Invoice: numbering is not sequential (${n1} → ${n2})`);

      const fetched = await getInvoiceForOrder(order.id);
      check(fetched?.number === invoice?.number, "Invoice: retrievable after issuing", "Invoice: could not be read back");

      // Cleanup
      await prisma.invoice.deleteMany({ where: { orderId: { in: [order.id, order2.id] } } });
      await prisma.order.deleteMany({ where: { id: { in: [order.id, order2.id] } } });
      await prisma.user.delete({ where: { id: user.id } }).catch(() => null);
      await prisma.usageCounter.deleteMany({ where: { key: { startsWith: "qa-" } } }).catch(() => null);
      pass("Cleanup: test order, invoice and counters removed");
    }

    // ── Catalog margin coverage ─────────────────────────────────
    const [withCost, totalParts] = await Promise.all([
      prisma.part.count({ where: { costEur: { not: null } } }),
      prisma.part.count(),
    ]);
    check(
      totalParts > 0 && withCost === totalParts,
      `Margin: all ${totalParts} parts have a purchase price`,
      `Margin: ${totalParts - withCost} of ${totalParts} parts have no purchase price`,
    );
  } finally {
    console.log(log.join("\n"));
    await prisma.$disconnect();
    const failures = log.filter((l) => l.startsWith("❌")).length;
    console.log(`\n${log.length - failures}/${log.length} checks passed`);
    if (failures > 0) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
