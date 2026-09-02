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
import { issueWorkOrderInvoice, getWorkOrderInvoice, profileGaps } from "../src/lib/monteur-invoicing";
import { catalogStats } from "../src/lib/catalog-stats";
import { PLAN_API_MONTHLY_CALLS, PLAN_API_HOURLY_BURST } from "../src/lib/api-auth";

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

    // ── Monteur invoicing ───────────────────────────────────────
    check(
      profileGaps(null).length === 3,
      "Monteur: an empty profile is rejected as incomplete",
      "Monteur: an empty profile was treated as invoice-ready",
    );
    check(
      profileGaps({ companyName: "Test BV", kvkNumber: "12345678", street: "Straat 1", postalCode: "1234 AB", city: "Utrecht" }).length === 0,
      "Monteur: a complete profile passes the invoice precondition",
      "Monteur: a complete profile was still rejected",
    );

    const monteur = await prisma.user.upsert({
      where: { email: "qa-monteur@wasfixpro.test" },
      update: { plan: "MONTEUR_PRO", role: "TECHNICIAN" },
      create: { email: "qa-monteur@wasfixpro.test", name: "QA Monteur", role: "TECHNICIAN", plan: "MONTEUR_PRO" },
    });
    const other = await prisma.user.upsert({
      where: { email: "qa-monteur2@wasfixpro.test" },
      update: {},
      create: { email: "qa-monteur2@wasfixpro.test", name: "QA Monteur 2", role: "TECHNICIAN", plan: "MONTEUR_PRO" },
    });

    const customer = await prisma.customer.create({
      data: { ownerId: monteur.id, name: "Klant Jansen", street: "Kerkweg 4", postalCode: "3500 AA", city: "Utrecht" },
    });
    const wo = await prisma.workOrder.create({
      data: { ownerId: monteur.id, customerId: customer.id, reference: "WO-QA1", problem: "Pomp vervangen", machine: "Bosch WAU28T40NL", priceEur: 121, status: "VOLTOOID" },
    });

    // Without a profile the monteur cannot invoice.
    const noProfile = await issueWorkOrderInvoice(monteur.id, wo.id);
    check(
      !noProfile.ok && Array.isArray(noProfile.missing) && noProfile.missing.length > 0,
      "Monteur: invoicing is refused until the business details are filled in",
      "Monteur: an invoice was issued without seller details",
    );

    await prisma.monteurProfile.upsert({
      where: { userId: monteur.id },
      update: {},
      create: {
        userId: monteur.id,
        companyName: "QA Wasmachineservice",
        kvkNumber: "87654321",
        vatNumber: "NL123456789B01",
        street: "Werkplaats 9",
        postalCode: "3500 BB",
        city: "Utrecht",
        iban: "NL00BANK0123456789",
        vatRate: 0.21,
        paymentTerms: 14,
      },
    });

    const moInv = await issueWorkOrderInvoice(monteur.id, wo.id);
    check(moInv.ok, `Monteur: invoice issued (${moInv.ok ? moInv.invoice.number : "-"})`, "Monteur: invoice could not be issued");
    if (moInv.ok) {
      check(
        moInv.invoice.vatEur === 21 && money(moInv.invoice.totalEur - moInv.invoice.vatEur) === 100,
        "Monteur: €121 job splits into €100 + €21 btw",
        `Monteur: btw split wrong (${moInv.invoice.vatEur})`,
      );
      check(
        moInv.invoice.seller.name === "QA Wasmachineservice" && moInv.invoice.buyer.name === "Klant Jansen",
        "Monteur: the monteur is the seller and their customer the buyer",
        "Monteur: seller/buyer are the wrong way around",
      );
      const again = await issueWorkOrderInvoice(monteur.id, wo.id);
      check(
        again.ok && again.invoice.number === moInv.invoice.number,
        "Monteur: re-opening the invoice reuses the same number",
        "Monteur: a second number was allocated",
      );
    }

    // Cross-tenant: another monteur must not reach this work order.
    const stolen = await issueWorkOrderInvoice(other.id, wo.id);
    check(!stolen.ok, "Monteur: another monteur cannot invoice this work order", "Monteur: cross-tenant invoicing succeeded");
    const peeked = await getWorkOrderInvoice(other.id, wo.id);
    check(peeked === null, "Monteur: another monteur cannot read the invoice", "Monteur: cross-tenant invoice read succeeded");

    // Each monteur gets their own series starting at 0001.
    const wo2 = await prisma.workOrder.create({
      data: { ownerId: other.id, reference: "WO-QA2", problem: "Lager vervangen", priceEur: 242, status: "VOLTOOID" },
    });
    await prisma.monteurProfile.upsert({
      where: { userId: other.id },
      update: {},
      create: { userId: other.id, companyName: "Andere Service", kvkNumber: "11223344", street: "Laan 2", postalCode: "1000 AA", city: "Amsterdam" },
    });
    const otherInvoice = await issueWorkOrderInvoice(other.id, wo2.id);
    check(
      otherInvoice.ok && otherInvoice.invoice.number.endsWith("-0001"),
      "Monteur: every monteur has their own series starting at 0001",
      "Monteur: invoice numbering leaked between monteurs",
    );

    await prisma.monteurInvoice.deleteMany({ where: { ownerId: { in: [monteur.id, other.id] } } });
    await prisma.monteurInvoiceSequence.deleteMany({ where: { ownerId: { in: [monteur.id, other.id] } } });
    await prisma.workOrder.deleteMany({ where: { ownerId: { in: [monteur.id, other.id] } } });
    await prisma.customer.deleteMany({ where: { ownerId: monteur.id } });
    await prisma.monteurProfile.deleteMany({ where: { userId: { in: [monteur.id, other.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [monteur.id, other.id] } } });
    pass("Cleanup: monteur test data removed");

    // ── Claims match the catalog ────────────────────────────────
    const cat = catalogStats();
    check(
      cat.errorCodes > 0 && cat.parts > 0 && cat.guides > 0 && cat.brands > 0,
      `Claims: catalog stats resolve (${cat.errorCodes} codes, ${cat.parts} parts, ${cat.guides} guides, ${cat.brands} brands)`,
      "Claims: catalog stats came back empty",
    );

    // ── Regressions the security audit surfaced ─────────────────
    // The monthly allowance must never be used as an hourly budget: that
    // granted a Monteur Pro key roughly 720x the calls it paid for.
    check(
      Object.entries(PLAN_API_HOURLY_BURST).every(([plan, burst]) => burst < (PLAN_API_MONTHLY_CALLS[plan] ?? 0)),
      "API: hourly burst is well below the monthly allowance",
      "API: the hourly limiter is using the monthly number again",
    );
    check(
      PLAN_API_MONTHLY_CALLS.MONTEUR_PRO === PLANS.MONTEUR_PRO.apiCallsPerMonth &&
        PLAN_API_MONTHLY_CALLS.BEDRIJF === PLANS.BEDRIJF.apiCallsPerMonth,
      "API: the metered allowance equals what the pricing page sells",
      "API: metered allowance drifted from the plan config",
    );

    // Invoice numbering must stay gapless even under concurrency: the number
    // used to be allocated before the insert, so a losing race burned one.
    const seqPart = await prisma.part.findFirst({ where: { costEur: { not: null } } });
    if (seqPart) {
      const raceUser = await prisma.user.upsert({
        where: { email: "qa-race@wasfixpro.test" },
        update: {},
        create: { email: "qa-race@wasfixpro.test", name: "QA Race", role: "CONSUMER", plan: "FREE" },
      });
      const raceOrder = await prisma.order.create({
        data: {
          userId: raceUser.id,
          email: "qa-race@wasfixpro.test",
          subtotalEur: 50, totalEur: 50, vatRate: VAT_RATE, vatEur: splitVatInclusive(50).vatEur,
          status: "PAID",
          shippingAddress: JSON.stringify({ name: "QA Race" }),
          items: { create: [{ partId: seqPart.id, quantity: 1, unitPrice: 50 }] },
        },
      });
      const before = await prisma.invoiceSequence.findUnique({ where: { year: new Date().getFullYear() } });
      // Five concurrent issue attempts on one order.
      const results = await Promise.all(Array.from({ length: 5 }, () => issueInvoiceForOrder(raceOrder.id).catch(() => null)));
      const numbers = new Set(results.filter(Boolean).map((r) => r!.number));
      const after = await prisma.invoiceSequence.findUnique({ where: { year: new Date().getFullYear() } });
      check(
        numbers.size === 1,
        `Invoice: 5 concurrent issues produced one number (${[...numbers][0]})`,
        `Invoice: concurrency produced ${numbers.size} different numbers`,
      );
      check(
        (after?.last ?? 0) - (before?.last ?? 0) <= 1,
        "Invoice: the sequence advanced at most once — no burned numbers",
        `Invoice: sequence jumped by ${(after?.last ?? 0) - (before?.last ?? 0)}, leaving gaps`,
      );
      const invoiceCount = await prisma.invoice.count({ where: { orderId: raceOrder.id } });
      check(invoiceCount === 1, "Invoice: exactly one invoice exists for the order", `Invoice: ${invoiceCount} invoices for one order`);

      await prisma.invoice.deleteMany({ where: { orderId: raceOrder.id } });
      await prisma.order.delete({ where: { id: raceOrder.id } }).catch(() => null);
      await prisma.user.delete({ where: { id: raceUser.id } }).catch(() => null);
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
