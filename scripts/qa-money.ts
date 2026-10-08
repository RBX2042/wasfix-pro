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
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { splitVatInclusive, money, issueInvoiceForOrder, getInvoiceForOrder, computeMargin, computeOrderMargin, costBasis, MARGIN_ESTIMATE_LABEL } from "../src/lib/invoicing";
import { evaluateCompany, isValidIban, isValidKvk, isValidVatNumber, isPlaceholderValue, canonicalCompanyValue, companyTradeName, DEFAULT_COMPANY_NAME, type CompanyInput } from "../src/lib/company-validate";
import { consumeUsage, canReadPremiumGuide } from "../src/lib/entitlements";
import { PLANS, PLAN_ORDER, BILLABLE_PLANS, getPlan, formatPlanPrice, VAT_RATE, COMPANY, companyReadiness, companyIdentityLine, realOrNull } from "../src/lib/plans";
import { getPlanLimits } from "../src/lib/auth";
import { issueWorkOrderInvoice, getWorkOrderInvoice, profileGaps } from "../src/lib/monteur-invoicing";
import { catalogStats } from "../src/lib/catalog-stats";
import { staticErrorCodes } from "../src/lib/static-db";
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
      profileGaps(null).length > 0,
      "Monteur: an empty profile is rejected as incomplete",
      "Monteur: an empty profile was treated as invoice-ready",
    );
    check(
      profileGaps({ companyName: "Test BV", kvkNumber: "12345678", vatNumber: "NL123456789B01", street: "Straat 1", postalCode: "1234 AB", city: "Utrecht" }).length === 0,
      "Monteur: a complete profile passes the invoice precondition",
      "Monteur: a complete profile was still rejected",
    );
    // Art. 35a Wet OB: charging btw without a btw-identificatienummer on the
    // invoice makes it non-deductible for the customer. This fixture used to
    // omit vatNumber and still pass, which is what let that invoice be issued.
    check(
      profileGaps({ companyName: "Test BV", kvkNumber: "12345678", street: "Straat 1", postalCode: "1234 AB", city: "Utrecht" }).includes("btw-nummer"),
      "Monteur: charging 21% btw without a btw-nummer is refused",
      "Monteur: a 21% invoice could be issued without a btw-nummer",
    );
    check(
      profileGaps({ companyName: "KOR BV", kvkNumber: "12345678", street: "Straat 1", postalCode: "1234 AB", city: "Utrecht", vatRate: 0, invoiceFooter: "Vrijgesteld van omzetbelasting o.g.v. artikel 25 Wet OB" }).length === 0,
      "Monteur: a kleineondernemer with an exemption statement may invoice at 0%",
      "Monteur: a valid 0% profile was rejected",
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
      create: { userId: other.id, companyName: "Andere Service", kvkNumber: "11223344", vatNumber: "NL112233440B01", street: "Laan 2", postalCode: "1000 AA", city: "Amsterdam" },
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

    // "Geverifieerd" has to mean something checkable. A row may only claim
    // VERIFIED when it carries the URL we checked it against — otherwise the
    // badge is the same kind of unearned claim we just spent a PR removing.
    const unsourcedVerified = staticErrorCodes().filter(
      (ec) => ec.provenance === "VERIFIED" && !ec.sourceUrl,
    );
    check(
      unsourcedVerified.length === 0,
      `Codes: all ${cat.verifiedErrorCodes} verified codes cite a source`,
      `Codes: ${unsourcedVerified.length} codes claim VERIFIED without a source URL (${unsourcedVerified
        .slice(0, 5)
        .map((ec) => `${ec.machine.brand} ${ec.code}`)
        .join(", ")})`,
    );

    // A "DIY: ja" badge on a repair that means opening the control module,
    // the motor or the heating circuit sends someone into live mains. The
    // title naming one of those components is the tripwire.
    const liveSide = /(verwarmingselement|verwarmingscircuit|verwarmingsfout|motor commutator|koolborstel|moederbord|kortsluiting|netspanning)/i;
    const unsafeDiy = staticErrorCodes().filter((ec) => ec.diyFriendly && liveSide.test(ec.title));
    check(
      unsafeDiy.length === 0,
      "Codes: no code marked DIY describes mains, motor or module work",
      `Codes: ${unsafeDiy.length} codes invite a consumer into live-side work (${unsafeDiy
        .slice(0, 5)
        .map((ec) => `${ec.machine.brand} ${ec.code}`)
        .join(", ")})`,
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

    // ── Cost provenance: an estimate is not a margin ────────────────────────
    const badSource = await prisma.part.count({ where: { NOT: { costSource: { in: ["ESTIMATE", "QUOTE"] } } } });
    check(badSource === 0, "Cost source: every part is ESTIMATE or QUOTE", `Cost source: ${badSource} parts carry another value`);
    const quoteNoCost = await prisma.part.count({ where: { costSource: "QUOTE", costEur: null } });
    check(quoteNoCost === 0, "Cost source: no part claims a QUOTE without a cost", `Cost source: ${quoteNoCost} QUOTE parts have no cost`);
    const [estimateParts, quoteParts] = await Promise.all([
      prisma.part.count({ where: { costSource: "ESTIMATE" } }),
      prisma.part.count({ where: { costSource: "QUOTE" } }),
    ]);
    check(estimateParts + quoteParts === totalParts, `Cost source: ${estimateParts} estimate + ${quoteParts} quote = ${totalParts} parts (the costs in scripts/add-part-costs.mjs are estimates)`, "Cost source: counts do not add up");

    const sample = await prisma.part.findMany({ where: { costEur: { not: null } }, take: 5 });
    const asLines = sample.map((p) => ({ unitPriceEur: p.priceEur, quantity: 1, costEur: p.costEur, costSource: p.costSource }));
    const dbReport = computeMargin(asLines);
    // The database figure is compared with what the data says, whatever it holds: the
    // confirmed lines are exactly the QUOTE ones, and an all-estimate set yields no confirmed figure.
    const sampleQuotes = sample.filter((p) => p.costSource === "QUOTE").length;
    check(
      dbReport.confirmed.lines === sampleQuotes && dbReport.estimated.lines === sample.length - sampleQuotes,
      `Margin: of ${sample.length} sampled parts ${sampleQuotes} are confirmed (QUOTE) and ${sample.length - sampleQuotes} are 'schatting'`,
      `Margin: confirmed ${dbReport.confirmed.lines} / estimated ${dbReport.estimated.lines} do not match the sample (${sampleQuotes} QUOTE of ${sample.length})`,
    );
    const allEstimates = computeMargin(asLines.map((l) => ({ ...l, costSource: "ESTIMATE" })));
    check(
      sample.length > 0 && allEstimates.confirmed.lines === 0 && allEstimates.confirmed.marginPct === null && allEstimates.confirmed.revenueExVatEur === 0 && allEstimates.estimated.lines === sample.length,
      "Margin: with every cost an ESTIMATE nothing is reported as a confirmed margin; it is all 'schatting'",
      `Margin: estimates leaked into the confirmed figure: ${JSON.stringify(allEstimates.confirmed)}`,
    );
    const mixed = computeMargin([
      { unitPriceEur: 121, quantity: 2, costEur: 60, costSource: "QUOTE" }, // revenue 200 ex VAT, cost 120
      { unitPriceEur: 121, quantity: 1, costEur: 10, costSource: "ESTIMATE" },
      { unitPriceEur: 121, quantity: 1, costEur: null, costSource: "ESTIMATE" },
      { unitPriceEur: 121, quantity: 1 },
    ]);
    check(
      mixed.confirmed.lines === 1 && mixed.confirmed.revenueExVatEur === 200 && mixed.confirmed.costEur === 120 && mixed.confirmed.marginEur === 80 && mixed.confirmed.marginPct === 40,
      "Margin: the confirmed figure counts QUOTE lines only (200 revenue, 120 cost, 40%)",
      `Margin confirmed wrong: ${JSON.stringify(mixed.confirmed)}`,
    );
    check(mixed.estimated.lines === 1 && mixed.estimated.marginPct === 90 && mixed.unknownLines === 2 && mixed.label === MARGIN_ESTIMATE_LABEL && MARGIN_ESTIMATE_LABEL === "schatting", "Margin: ESTIMATE lines are kept apart and labelled 'schatting'; lines without a cost count nowhere", `Margin estimate wrong: ${JSON.stringify(mixed)}`);
    check(costBasis({ costEur: 5, costSource: "QUOTE" }) === "QUOTE" && costBasis({ costEur: 5, costSource: "ESTIMATE" }) === "ESTIMATE" && costBasis({ costEur: 5 }) === "ESTIMATE" && costBasis({ costEur: null, costSource: "QUOTE" }) === "UNKNOWN", "Margin: costBasis treats anything but an explicit QUOTE as an estimate, and no cost as unknown", "Margin: costBasis wrong");
    check(computeMargin([]).confirmed.marginPct === null, "Margin: no data gives null, not 0%", "Margin: empty input gives a percentage");

    // OrderItem.unitPrice is the LIST price; the plan discount lives only on Order.discountEur.
    // Bedrijf order: 2 x 100,00 (QUOTE cost 40) + 1 x 50,00 (ESTIMATE cost 20), 15% = 37,50 off.
    const bedrijfItems = [
      { unitPriceEur: 100, quantity: 2, costEur: 40, costSource: "QUOTE" },
      { unitPriceEur: 50, quantity: 1, costEur: 20, costSource: "ESTIMATE" },
    ];
    const naive = computeMargin(bedrijfItems);
    const orderMargin = computeOrderMargin({ items: bedrijfItems, discountEur: 37.5 });
    check(naive.confirmed.revenueExVatEur === 165.29 && orderMargin.confirmed.revenueExVatEur === 140.5 && orderMargin.confirmed.marginEur === 60.5 && orderMargin.estimated.revenueExVatEur === 35.12, "Order margin: the plan discount is spread over the lines before VAT is removed (confirmed revenue 140,50 / margin 60,50, not the full-price 165,29)", `Order margin wrong: naive ${JSON.stringify(naive.confirmed)} order ${JSON.stringify(orderMargin)}`);
    check(computeOrderMargin({ items: bedrijfItems, discountEur: 0 }).confirmed.revenueExVatEur === naive.confirmed.revenueExVatEur, "Order margin: without a discount it equals computeMargin", "Order margin differs from computeMargin without a discount");
    {
      // Whatever the split, the revenue incl. VAT of all lines equals gross minus discount (within a cent per line).
      let seed = 99;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const bad: string[] = [];
      for (let i = 0; i < 500; i++) {
        const items = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => ({ unitPriceEur: money(1 + rnd() * 80), quantity: 1 + Math.floor(rnd() * 3), costEur: 0, costSource: "QUOTE" }));
        const gross = items.reduce((n, l) => n + Math.round(l.unitPriceEur * 100) * l.quantity, 0);
        const discount = Math.floor(rnd() * gross * 0.5) / 100;
        const rep = computeOrderMargin({ items, discountEur: discount });
        const inclVat = rep.confirmed.revenueExVatEur * 1.21;
        if (Math.abs(inclVat - (gross / 100 - discount)) > 0.01 * (items.length + 1)) bad.push(`${gross / 100}-${discount}=>${inclVat.toFixed(2)}`);
      }
      check(bad.length === 0, "Order margin: over 500 random orders the allocated revenue equals goods minus discount (largest remainder, no cent lost)", `Order margin allocation drifts: ${bad.slice(0, 3).join("; ")}`);
    }
    check(computeOrderMargin({ items: [{ unitPriceEur: 10, quantity: 1, costEur: 5, costSource: "QUOTE" }], discountEur: 999 }).confirmed.revenueExVatEur === 0, "Order margin: a discount larger than the goods is capped at the goods", "Order margin: oversized discount produced negative revenue");

    // ── Company identity: nothing partial may invoice ───────────────────────
    const FULL: CompanyInput = {
      name: "WasFix Test B.V.", street: "Teststraat 1", postalCode: "1011 AB", city: "Amsterdam",
      kvk: "90000001", vatNumber: "NL900000010B01", iban: "NL02ABNA0123456789",
    };
    const full = evaluateCompany(FULL);
    check(full.ready && full.missing.length === 0, "Company: a complete, well-formed identity is ready", `Company: complete identity not ready: ${JSON.stringify(full)}`);
    check(full.warnings.length === 3, "Company: the three well-known test numbers are reported as warnings (not blocking)", `Company: warnings ${JSON.stringify(full.warnings)}`);
    check(companyReadiness(FULL).ready, "Company: companyReadiness(input) evaluates the given input", "Company: companyReadiness ignores its input");
    const wrongOnRemoval: string[] = [];
    for (const field of Object.keys(FULL) as Array<keyof CompanyInput>) {
      for (const empty of [undefined, "", "   "]) {
        const r = evaluateCompany({ ...FULL, [field]: empty });
        if (r.ready || r.missing.join() !== field) wrongOnRemoval.push(`${field}=${JSON.stringify(empty)} gave ${JSON.stringify(r.missing)} ready=${r.ready}`);
      }
    }
    check(wrongOnRemoval.length === 0, "Company: removing any ONE of the 7 fields (undefined, empty or blank) makes it not ready and names exactly that field", `Company: ${wrongOnRemoval.join("; ")}`);
    // The A1-02 / A3-09 / A5-04 repro: only the KvK is configured.
    const kvkOnly = evaluateCompany({ kvk: "90000001" });
    check(!kvkOnly.ready && kvkOnly.missing.length === 6 && !kvkOnly.missing.includes("kvk"), "Company: ONLY COMPANY_KVK set => not ready, 6 fields missing (the old check passed)", `Company: kvk-only gave ${JSON.stringify(kvkOnly)}`);
    check(!evaluateCompany({ ...FULL, iban: undefined, vatNumber: undefined }).ready, "Company: kvk + name + address but no IBAN/btw => not ready (A2-12)", "Company: missing IBAN and btw still ready");
    // IBAN
    check(!evaluateCompany({ ...FULL, iban: "NL02ABNA0123456780" }).ready && evaluateCompany({ ...FULL, iban: "NL02ABNA0123456780" }).missing.join() === "iban", "Company: an IBAN with a wrong check digit is refused (mod-97)", "Company: bad IBAN checksum accepted");
    check(evaluateCompany({ ...FULL, iban: "NL00ABCD0123456789" }).problems[0]?.reason === "voorbeeldwaarde", "Company: the placeholder IBAN NL00ABCD0123456789 is refused as an example value", "Company: placeholder IBAN accepted");
    check(isValidIban("nl02 abna 0123 4567 89") && isValidIban("DE89 3704 0044 0532 0130 00") && isValidIban("NL91ABNA0417164300"), "Company: valid IBANs pass with spaces and lower case, other countries too", "Company: valid IBAN refused");
    check(!isValidIban("NL02ABNA012345678") && !isValidIban("NL02ABNA01234567890") && !isValidIban("") && !isValidIban("12345") && !isValidIban("NL02 ABNA 0123 4567 8X"), "Company: IBANs of the wrong length or shape are refused", "Company: malformed IBAN accepted");
    // KvK
    check(isValidKvk("90000001") && isValidKvk("1234 5678".replace(" ", "")) && !isValidKvk("1234567") && !isValidKvk("123456789") && !isValidKvk("ABCDEFGH") && !isValidKvk(""), "Company: KvK must be exactly 8 digits", "Company: KvK validation wrong");
    check(evaluateCompany({ ...FULL, kvk: "12345678" }).problems[0]?.reason === "voorbeeldwaarde", "Company: the placeholder KvK 12345678 is refused", "Company: placeholder KvK accepted");
    // VAT
    check(isValidVatNumber("NL900000010B01") && isValidVatNumber("nl900000010b01") && isValidVatNumber("NL9000.00010 B01") && !isValidVatNumber("NL90000001B01") && !isValidVatNumber("NL900000010B1") && !isValidVatNumber("BE0123456789") && !isValidVatNumber("NL900000010C01") && !isValidVatNumber(""), "Company: btw-nummer must be NL + 9 digits + B + 2 digits", "Company: VAT validation wrong");
    check(evaluateCompany({ ...FULL, vatNumber: "NL123456789B01" }).problems[0]?.reason === "voorbeeldwaarde", "Company: the placeholder btw-nummer NL123456789B01 is refused", "Company: placeholder btw accepted");
    // Address and name
    check(evaluateCompany({ ...FULL, street: "Hoofdstraat 1" }).missing.join() === "street" && evaluateCompany({ ...FULL, postalCode: "1234 AB" }).missing.join() === "postalCode" && evaluateCompany({ ...FULL, postalCode: "1234ab" }).missing.join() === "postalCode", "Company: the placeholder street and postcode are refused, however they are spaced or cased", "Company: placeholder address accepted");
    check(evaluateCompany({ ...FULL, street: "Teststraat" }).missing.join() === "street" && evaluateCompany({ ...FULL, postalCode: "0123 AB" }).missing.join() === "postalCode" && evaluateCompany({ ...FULL, postalCode: "1011" }).missing.join() === "postalCode", "Company: a street without a house number and malformed postcodes are refused", "Company: malformed address accepted");
    check(evaluateCompany({ ...FULL, name: DEFAULT_COMPANY_NAME }).missing.join() === "name" && evaluateCompany({ ...FULL, name: "wasfix pro (in oprichting)" }).missing.join() === "name", "Company: the default 'in oprichting' name is not a real company name", "Company: default name accepted as real");
    check(!/B\.?V\.?|N\.?V\.?|V\.?O\.?F/i.test(DEFAULT_COMPANY_NAME), `Company: the default name claims no legal form ("${DEFAULT_COMPANY_NAME}")`, `Company: default name claims a legal form: ${DEFAULT_COMPANY_NAME}`);
    {
      // Independent of companyReadiness(): decide from the raw environment of this run with the plain validators.
      const e = process.env;
      const present = (v: string | undefined) => (v ?? "").trim().length > 0 && !isPlaceholderValue(v ?? "");
      const independentReady = present(e.COMPANY_NAME) && present(e.COMPANY_STREET) && present(e.COMPANY_POSTAL_CODE) && present(e.COMPANY_CITY) && present(e.COMPANY_KVK) && isValidKvk(e.COMPANY_KVK ?? "") && present(e.COMPANY_VAT) && isValidVatNumber(e.COMPANY_VAT ?? "") && present(e.COMPANY_IBAN) && isValidIban(e.COMPANY_IBAN ?? "") && /^[1-9]\d{3}\s?[A-Za-z]{2}$/.test((e.COMPANY_POSTAL_CODE ?? "").trim());
      check(COMPANY.isPlaceholder === !independentReady, `Company: COMPANY.isPlaceholder (${COMPANY.isPlaceholder}) matches an independent reading of the environment of this run (${independentReady ? "complete" : "incomplete"})`, `Company: isPlaceholder ${COMPANY.isPlaceholder} but the environment reads as ${independentReady ? "complete" : "incomplete"}`);
    }
    check(companyTradeName(DEFAULT_COMPANY_NAME) === "WasFix Pro" && companyTradeName("WasFix Pro B.V.") === "WasFix Pro B.V." && companyTradeName("(in oprichting)") === "(in oprichting)", "Company: companyTradeName strips a trailing '(in oprichting)' and nothing else", `companyTradeName: ${companyTradeName(DEFAULT_COMPANY_NAME)}`);
    check(
      canonicalCompanyValue("kvk", " 9000 0001\n") === "90000001" && canonicalCompanyValue("vatNumber", "nl9000.00010 b01") === "NL900000010B01" && canonicalCompanyValue("iban", "nl02 abna 0123 4567 89\n") === "NL02ABNA0123456789" && canonicalCompanyValue("postalCode", "1011ab") === "1011 AB" && canonicalCompanyValue("name", "  WasFix \n  Test  ") === "WasFix Test" && canonicalCompanyValue("city", null) === "",
      "Company: canonicalCompanyValue gives one spelling per field (KvK digits, btw and IBAN compact upper case, postcode '1011 AB', whitespace collapsed)",
      "Company: canonicalCompanyValue wrong",
    );
    check(
      evaluateCompany({ ...FULL, kvk: "9000 0001", vatNumber: "nl900000010b01", iban: "nl02 abna 0123 4567 89", postalCode: "1011ab", name: "WasFix Test B.V.\n" }).ready === true &&
        evaluateCompany({ ...FULL, kvk: "9000 000" }).missing.join() === "kvk",
      "Company: readiness judges the canonical value (a messy but valid spelling is ready, a short KvK is not)",
      "Company: readiness disagrees with canonical spelling",
    );
    {
      const w = (email: string | undefined) => evaluateCompany({ ...FULL, email }).warnings.filter((x) => x.startsWith("COMPANY_EMAIL"));
      check(w(undefined).length === 1 && w("   ").length === 1 && w("geen-adres").length === 1 && w("hallo@wasfix.nl").length === 0 && evaluateCompany(FULL).warnings.every((x) => !x.startsWith("COMPANY_EMAIL")), "Company: a missing or malformed COMPANY_EMAIL is a warning (never blocking, and only judged when the key is passed)", `Company email warnings: ${JSON.stringify([w(undefined), w("geen-adres"), w("hallo@wasfix.nl")])}`);
      check(evaluateCompany({ ...FULL, email: undefined }).ready === true, "Company: a missing COMPANY_EMAIL does not make the company not ready", "Company: missing COMPANY_EMAIL blocks readiness");
    }
    check(realOrNull("1234AB") === null && realOrNull("Hoofdstraat 1") === null && realOrNull("Teststraat 1") === "Teststraat 1" && realOrNull("") === null, "Company: realOrNull hides placeholders (any spacing) and shows real values", "Company: realOrNull wrong");

    // The same decision through the real environment path (COMPANY.isPlaceholder in a fresh process).
    const probeDir = mkdtempSync(path.join(tmpdir(), "qa-money-company-"));
    const probeFile = path.join(probeDir, "probe.ts");
    writeFileSync(probeFile, `import { COMPANY, companyReadiness, companyIdentityLine } from ${JSON.stringify(path.resolve("src/lib/plans"))};\nconsole.log("RESULT " + JSON.stringify({ placeholder: COMPANY.isPlaceholder, missing: companyReadiness().missing, name: COMPANY.name, city: COMPANY.city, identity: companyIdentityLine(), tradeName: COMPANY.tradeName }));`);
    const envProbe = (extra: Record<string, string>) => {
      const r = spawnSync("npx", ["tsx", probeFile], { encoding: "utf8", env: { ...process.env, COMPANY_NAME: "", COMPANY_STREET: "", COMPANY_POSTAL_CODE: "", COMPANY_CITY: "", COMPANY_KVK: "", COMPANY_VAT: "", COMPANY_IBAN: "", ...extra } });
      return JSON.parse((r.stdout.split("\n").find((l) => l.startsWith("RESULT ")) ?? "RESULT {}").slice(7)) as { placeholder?: boolean; missing?: string[]; name?: string; city?: string; identity?: string; tradeName?: string };
    };
    const e1 = envProbe({});
    const e2 = envProbe({ COMPANY_KVK: "90000001" });
    const e3 = envProbe({ COMPANY_NAME: "WasFix Test B.V.", COMPANY_STREET: "Teststraat 1", COMPANY_POSTAL_CODE: "1011 AB", COMPANY_CITY: "Amsterdam", COMPANY_KVK: "90000001" });
    const e4 = envProbe({ COMPANY_NAME: "WasFix Test B.V.", COMPANY_STREET: "Teststraat 1", COMPANY_POSTAL_CODE: "1011 AB", COMPANY_CITY: "Amsterdam", COMPANY_KVK: "90000001", COMPANY_VAT: "NL900000010B01", COMPANY_IBAN: "NL02ABNA0123456789" });
    check(e1.placeholder === true && e1.name === DEFAULT_COMPANY_NAME && e1.city === "", "Company env: nothing configured => placeholder, default name has no legal form, no invented city", `Company env empty: ${JSON.stringify(e1)}`);
    check(!/B\.V\./.test(e1.identity ?? "B.V.") && (e1.identity ?? "").split("in oprichting").length === 2 && e1.tradeName === "WasFix Pro", `Company env: with nothing configured the identity line says 'in oprichting' exactly once and never B.V. ("${e1.identity}")`, `Company env empty identity: ${e1.identity}`);
    check(e2.placeholder === true && e2.missing?.length === 6, "Company env: ONLY COMPANY_KVK => still a placeholder (the old check returned false here)", `Company env kvk-only: ${JSON.stringify(e2)}`);
    check(e3.placeholder === true && e3.missing?.join() === "vatNumber,iban", "Company env: everything but btw-nummer and IBAN => still a placeholder, naming both", `Company env partial: ${JSON.stringify(e3)}`);
    check(e4.placeholder === false, "Company env: all seven configured => not a placeholder", `Company env full: ${JSON.stringify(e4)}`);

    // publicCompany(): the server hands client components a plain snapshot. It lives behind "server-only".
    const pubFile = path.join(probeDir, "pub.ts");
    writeFileSync(pubFile, `import { publicCompany } from ${JSON.stringify(path.resolve("src/lib/company"))};\nconsole.log("RESULT " + JSON.stringify(publicCompany()));`);
    const pub = (extra: Record<string, string>, flags: string[] = ["--conditions=react-server"]) =>
      spawnSync("npx", ["tsx", ...flags, pubFile], { encoding: "utf8", env: { ...process.env, COMPANY_NAME: "", COMPANY_STREET: "", COMPANY_POSTAL_CODE: "", COMPANY_CITY: "", COMPANY_KVK: "", COMPANY_VAT: "", COMPANY_IBAN: "", ...extra } });
    const parse = (r: ReturnType<typeof pub>) => JSON.parse((r.stdout.split("\n").find((l) => l.startsWith("RESULT ")) ?? "RESULT {}").slice(7)) as Record<string, unknown>;
    const pEmpty = parse(pub({}));
    check(pEmpty.ready === false && pEmpty.kvk === null && pEmpty.iban === null && pEmpty.vatNumber === null && pEmpty.street === null && pEmpty.city === null && pEmpty.name === DEFAULT_COMPANY_NAME, "publicCompany(): with nothing configured every registration detail is null (never a placeholder) and ready is false", `publicCompany empty: ${JSON.stringify(pEmpty)}`);
    const pPartial = parse(pub({ COMPANY_KVK: "90000001", COMPANY_IBAN: "NL02ABNA0123456789" }));
    check(pPartial.ready === false && pPartial.iban === null && pPartial.kvk === "90000001", "publicCompany(): a partial configuration never exposes the IBAN", `publicCompany partial: ${JSON.stringify(pPartial)}`);
    const pFull = parse(pub({ COMPANY_NAME: "WasFix Test B.V.", COMPANY_STREET: "Teststraat 1", COMPANY_POSTAL_CODE: "1011 AB", COMPANY_CITY: "Amsterdam", COMPANY_KVK: "90000001", COMPANY_VAT: "NL900000010B01", COMPANY_IBAN: "NL02ABNA0123456789" }));
    check(pFull.ready === true && pFull.iban === "NL02ABNA0123456789" && pFull.identityLine === "WasFix Test B.V. · Teststraat 1, 1011 AB Amsterdam · KvK 90000001", "publicCompany(): the full identity is passed through, with the identity line for footers", `publicCompany full: ${JSON.stringify(pFull)}`);
    const clientImport = pub({}, []);
    check(clientImport.status !== 0 && /Client Component|server-only/i.test(clientImport.stderr), "company.ts is 'server-only': importing it without the react-server condition (as a client bundle would) fails loudly", `company.ts imported without react-server: status ${clientImport.status} ${clientImport.stderr.slice(0, 200)}`);

    // No client bundle may read COMPANY: the server env does not exist there (hydration error #418, A5-14).
    // A directive is only a directive as the first statement, so skip leading comments of ANY length
    // (the first version looked at the first 400 characters and a long licence header hid an offender).
    const startsWithUseClient = (src: string): boolean => {
      let i = 0;
      for (;;) {
        while (i < src.length && /\s/.test(src[i])) i++;
        if (src.startsWith("//", i)) {
          const nl = src.indexOf("\n", i);
          if (nl < 0) return false;
          i = nl + 1;
        } else if (src.startsWith("/*", i)) {
          const end = src.indexOf("*/", i + 2);
          if (end < 0) return false;
          i = end + 2;
        } else break;
      }
      return /^(["'])use client\1/.test(src.slice(i));
    };
    check(
      startsWithUseClient(`/* ${"x".repeat(3000)} */\n// more\n"use client";\nimport x from "y";`) && startsWithUseClient(`'use client'\n`) && !startsWithUseClient(`import a from "b";\n"use client";`) && !startsWithUseClient(`// "use client"\nexport const a = 1;`),
      "Client-bundle guard: finds the 'use client' directive behind a 3000-character header comment, and ignores one that is only mentioned in a comment or not first",
      "Client-bundle guard: directive detection is wrong",
    );
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(tsx?|jsx?)$/.test(name)) {
          const src = readFileSync(full, "utf8");
          if (!startsWithUseClient(src)) continue;
          const importsCompany = /import\s*\{[^}]*\b(COMPANY|companyIdentityLine|companyReadiness|realOrNull|PENDING_REGISTRATION)\b[^}]*\}\s*from\s*["'][^"']*\/(plans|company)["']/.test(src) || /from\s*["'][^"']*\/lib\/company["']/.test(src);
          if (importsCompany) offenders.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(path.resolve("src"));
    check(offenders.length === 0, "Client bundles: no 'use client' file imports COMPANY or the company helpers", `Client bundles read server-only company data in: ${offenders.join(", ")} (pass publicCompany() from a server component as props)`);

    // ── Slow, self-contained proofs run as their own scripts ───────────────
    if (process.env.QA_SKIP_SLOW !== "1") {
      for (const [script, label] of [["scripts/qa-migration.ts", "Migration proof"], ["scripts/qa-seed.ts", "Seed proof"]] as const) {
        const r = spawnSync("npx", ["tsx", script], { encoding: "utf8", env: process.env });
        const summary = (r.stdout.match(/(\d+)\/(\d+) [a-z ]*checks passed/) ?? [])[0] ?? "no summary";
        check(r.status === 0, `${label} (${script}): ${summary}`, `${label} FAILED (${script}): ${r.stdout.split("\n").filter((l) => l.startsWith("❌")).join(" | ") || r.stderr.slice(0, 300)}`);
      }
    }
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
