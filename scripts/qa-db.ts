import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const log: string[] = [];
const pass = (m: string) => log.push(`✅ ${m}`);
const fail = (m: string) => log.push(`❌ ${m}`);

async function main() {
  try {
    // 3.1 Seed data
    const brandRows = await prisma.washingMachine.groupBy({ by: ["brand"] });
    if (brandRows.length >= 10) pass(`Seed: ${brandRows.length} brands (${brandRows.map((b) => b.brand).join(", ")})`);
    else fail(`Seed: only ${brandRows.length} brands found, expected ≥10`);

    const ec = await prisma.errorCode.count();
    if (ec >= 26) pass(`Seed: ${ec} error codes (≥26)`);
    else fail(`Seed: only ${ec} error codes, expected ≥26`);

    const parts = await prisma.part.count();
    if (parts >= 20) pass(`Seed: ${parts} parts (≥20)`);
    else fail(`Seed: only ${parts} parts, expected ≥20`);

    const guides = await prisma.repairGuide.count();
    if (guides >= 5) pass(`Seed: ${guides} guides (≥5)`);
    else fail(`Seed: only ${guides} guides, expected ≥5`);

    // 3.2 ErrorCode CRUD (need a machine)
    const anyMachine = await prisma.washingMachine.findFirst();
    if (!anyMachine) { fail("No machine to attach test ErrorCode"); return; }

    const ecCreated = await prisma.errorCode.create({
      data: {
        code: "QA-TEST-001",
        title: "QA Test foutcode",
        description: "Tijdelijke testfoutcode",
        likelyCauses: "Test|Test2",
        machineId: anyMachine.id,
        severity: "LOW",
      },
    });
    pass(`ErrorCode CREATE id=${ecCreated.id}`);

    const ecRead = await prisma.errorCode.findUnique({ where: { id: ecCreated.id } });
    if (ecRead?.code === "QA-TEST-001") pass("ErrorCode READ"); else fail("ErrorCode READ");

    const ecUpdated = await prisma.errorCode.update({
      where: { id: ecCreated.id },
      data: { description: "Bijgewerkt" },
    });
    if (ecUpdated.description === "Bijgewerkt") pass("ErrorCode UPDATE"); else fail("ErrorCode UPDATE");

    await prisma.errorCode.delete({ where: { id: ecCreated.id } });
    const ecGone = await prisma.errorCode.findUnique({ where: { id: ecCreated.id } });
    if (!ecGone) pass("ErrorCode DELETE"); else fail("ErrorCode DELETE");

    // 3.3 Part CRUD
    const partCreated = await prisma.part.create({
      data: { sku: "QA-TEST-001", name: "Test onderdeel", brand: "Test", category: "OTHER", priceEur: 1.0, stock: 1 },
    });
    pass(`Part CREATE sku=${partCreated.sku}`);

    const partRead = await prisma.part.findUnique({ where: { sku: "QA-TEST-001" } });
    if (partRead) pass("Part READ by SKU"); else fail("Part READ by SKU");

    const partUpdated = await prisma.part.update({ where: { sku: "QA-TEST-001" }, data: { stock: 5 } });
    if (partUpdated.stock === 5) pass("Part UPDATE stock"); else fail("Part UPDATE stock");

    await prisma.part.delete({ where: { sku: "QA-TEST-001" } });
    pass("Part DELETE");

    // 3.4 Diagnosis CRUD
    const diagCreated = await prisma.diagnosis.create({
      data: { sessionId: "qa-test", brand: "Test", symptoms: "QA test", messages: "[]" },
    });
    pass(`Diagnosis CREATE id=${diagCreated.id}`);

    const diagRead = await prisma.diagnosis.findFirst({ where: { sessionId: "qa-test" } });
    if (diagRead) pass("Diagnosis READ"); else fail("Diagnosis READ");

    const diagUpdated = await prisma.diagnosis.update({
      where: { id: diagCreated.id },
      data: { result: JSON.stringify({ confidence: 99 }) },
    });
    if (diagUpdated.result?.includes("99")) pass("Diagnosis UPDATE result"); else fail("Diagnosis UPDATE");

    await prisma.diagnosis.delete({ where: { id: diagCreated.id } });
    pass("Diagnosis DELETE");

    // 3.5 Order CRUD
    const testUser = await prisma.user.upsert({
      where: { email: "qa@wasfixpro.nl" },
      update: {},
      create: { email: "qa@wasfixpro.nl", name: "QA Test", role: "CONSUMER", plan: "FREE" },
    });

    const anyPart = await prisma.part.findFirst();
    if (!anyPart) { fail("No part to attach to test order"); }
    else {
      const orderCreated = await prisma.order.create({
        data: {
          userId: testUser.id,
          email: testUser.email,
          subtotalEur: 25,
          totalEur: 25,
          shippingAddress: '{"street":"Test","city":"Amsterdam"}',
          status: "PENDING",
          items: { create: [{ partId: anyPart.id, quantity: 1, unitPrice: 25 }] },
        },
      });
      pass(`Order CREATE id=${orderCreated.id}`);

      const orderRead = await prisma.order.findUnique({
        where: { id: orderCreated.id },
        include: { items: true },
      });
      if (orderRead?.items.length === 1) pass("Order READ with items"); else fail("Order READ with items");

      const orderUpdated = await prisma.order.update({
        where: { id: orderCreated.id },
        data: { status: "PAID" },
      });
      if (orderUpdated.status === "PAID") pass("Order UPDATE status"); else fail("Order UPDATE status");

      await prisma.order.delete({ where: { id: orderCreated.id } });
      pass("Order DELETE (cascade items)");
    }

    await prisma.user.delete({ where: { id: testUser.id } });
    pass("User DELETE (cleanup)");

    // 3.6 Relations
    const machineWithCodes = await prisma.washingMachine.findFirst({ include: { errorCodes: true } });
    if (machineWithCodes && machineWithCodes.errorCodes.length > 0) pass(`Relation: WashingMachine→ErrorCodes (${machineWithCodes.errorCodes.length})`);
    else fail("Relation: WashingMachine→ErrorCodes empty");

    const ecWithParts = await prisma.errorCode.findFirst({
      where: { code: "E18" },
      include: { parts: { include: { part: true } } },
    });
    if (ecWithParts && ecWithParts.parts.length > 0) pass(`Relation: ErrorCode→Parts via junction (${ecWithParts.parts.length})`);
    else fail("Relation: ErrorCode→Parts empty");

    const guideWithParts = await prisma.repairGuide.findFirst({
      where: { parts: { some: {} } },
      include: { parts: { include: { part: true } } },
    });
    if (guideWithParts && guideWithParts.parts.length > 0) pass(`Relation: RepairGuide→Parts (${guideWithParts.parts.length})`);
    else fail("Relation: RepairGuide→Parts empty");

    // ── CRM + referrals (models added for the monteur dashboard) ──
    const owner = await prisma.user.findFirst({ where: { email: "jdahoe@hotmail.nl" } });
    if (owner) {
      const cust = await prisma.customer.create({ data: { ownerId: owner.id, name: "QA Klant" } });
      const wo = await prisma.workOrder.create({ data: { ownerId: owner.id, customerId: cust.id, reference: `QA-${Date.now()}`, problem: "QA test" } });
      pass("Customer + WorkOrder CREATE");

      const scoped = await prisma.workOrder.updateMany({ where: { id: wo.id, ownerId: owner.id }, data: { status: "VOLTOOID" } });
      scoped.count === 1 ? pass("WorkOrder UPDATE scoped by owner") : fail("WorkOrder UPDATE scoping");

      await prisma.customer.delete({ where: { id: cust.id } });
      const kept = await prisma.workOrder.findUnique({ where: { id: wo.id } });
      kept && kept.customerId === null ? pass("WorkOrder survives customer delete") : fail("WorkOrder lost on customer delete");
      await prisma.workOrder.delete({ where: { id: wo.id } });

      const visitorId = `qa-${Date.now()}`;
      await prisma.referral.create({ data: { code: "QATEST", visitorId, referrerId: owner.id } });
      const dupe = await prisma.referral
        .create({ data: { code: "QATEST", visitorId, referrerId: owner.id } })
        .then(() => "created")
        .catch(() => "rejected");
      dupe === "rejected" ? pass("Referral unique per (code, visitor)") : fail("duplicate referral allowed");
      await prisma.referral.deleteMany({ where: { visitorId } });
    } else {
      fail("Seeded admin user missing — run npm run db:seed");
    }

    const userWithDiagnoses = await prisma.user.findFirst({
      where: { email: "demo@wasfixpro.nl" },
      include: { diagnoses: true, orders: { include: { items: { include: { part: true } } } } },
    });
    if (userWithDiagnoses) pass(`Relation: User→Diagnoses (${userWithDiagnoses.diagnoses.length}) + Orders (${userWithDiagnoses.orders.length})`);
    else fail("Relation: User→Diagnoses+Orders");

    // ── Order domain schema (migration 20261008100000) ───────────────
    const dom = await prisma.user.create({ data: { email: `qa-domain-${Date.now()}@wasfixpro.test`, name: "QA Domain" } });
    const domPart = await prisma.part.create({ data: { sku: `QA-DOM-${Date.now()}`, name: "QA domain part", brand: "QA", category: "OTHER", priceEur: 10, stock: 5 } });
    try {
      domPart.costSource === "ESTIMATE" ? pass("Part.costSource defaults to ESTIMATE") : fail(`Part.costSource default is ${domPart.costSource}`);

      const token = `qa-${Date.now()}-token`;
      const o = await prisma.order.create({
        data: {
          userId: dom.id, email: dom.email, subtotalEur: 10, totalEur: 10, shippingAddress: "{}", accessToken: token, idempotencyKey: `qa-key-${Date.now()}`,
          phone: "0612345678", customerNote: "bel aan", carrier: "POSTNL", trackingCode: "3S1", shippedAt: new Date(), deliveredAt: new Date(), cancelledAt: new Date(), cancelReason: "test", stripePaymentIntentId: "pi_qa",
          items: { create: [{ partId: domPart.id, quantity: 1, unitPrice: 10 }] },
        },
      });
      o.refundedEur === 0 ? pass("Order: new fulfilment columns store, refundedEur defaults to 0") : fail(`Order.refundedEur default ${o.refundedEur}`);
      const dupToken = await prisma.order.create({ data: { userId: dom.id, email: dom.email, subtotalEur: 1, totalEur: 1, shippingAddress: "{}", accessToken: token } }).then(() => "accepted", () => "rejected");
      dupToken === "rejected" ? pass("Order.accessToken is unique") : fail("two orders share an accessToken");
      const dupKey = await prisma.order.create({ data: { userId: dom.id, email: dom.email, subtotalEur: 1, totalEur: 1, shippingAddress: "{}", idempotencyKey: o.idempotencyKey } }).then(() => "accepted", () => "rejected");
      dupKey === "rejected" ? pass("Order.idempotencyKey is unique") : fail("two orders share an idempotencyKey");
      const noToken = await prisma.order.create({ data: { userId: dom.id, email: dom.email, subtotalEur: 1, totalEur: 1, shippingAddress: "{}" } }).then((x) => x, () => null);
      noToken && noToken.accessToken === null ? pass("Order without a token is allowed (rows from before the column)") : fail("accessToken became mandatory");
      if (noToken) await prisma.order.delete({ where: { id: noToken.id } });

      // /api/retour writes whatever the customer typed (2-60 characters) into orderId. That must keep working:
      // a foreign key on orderId made it fail with P2003 for every reference that is not a full Order.id.
      const typed = await prisma.rmaRequest.create({ data: { rmaNumber: `RMA-QF-${Date.now()}`, orderId: "CMUZKSN0", name: "x", email: dom.email, reason: "DEFECT", notes: "x" } }).then((r) => r, (e) => e as Error);
      typed instanceof Error
        ? fail(`RmaRequest: a free-text order reference is rejected (${typed.message.split("\n").pop()?.slice(0, 120)})`)
        : typed.orderId === "CMUZKSN0" && typed.linkedOrderId === null
          ? pass("RmaRequest: a free-text order reference (the short number a customer types) is stored as typed, linkedOrderId stays null")
          : fail(`RmaRequest free text stored wrong: ${JSON.stringify(typed)}`);
      const rma = await prisma.rmaRequest.create({ data: { rmaNumber: `RMA-QA-${Date.now()}`, orderId: o.id, linkedOrderId: o.id, name: "x", email: dom.email, reason: "DEFECT", notes: "x" } });
      const badLink = await prisma.rmaRequest.create({ data: { rmaNumber: `RMA-QC-${Date.now()}`, orderId: "x", linkedOrderId: "does-not-exist", name: "x", email: dom.email, reason: "DEFECT", notes: "x" } }).then(() => "accepted", () => "rejected");
      badLink === "rejected" ? pass("RmaRequest.linkedOrderId is a real foreign key") : fail("RmaRequest accepts a made-up linkedOrderId");
      await prisma.orderItem.deleteMany({ where: { orderId: o.id } });
      await prisma.order.delete({ where: { id: o.id } });
      const rmaAfter = await prisma.rmaRequest.findUnique({ where: { id: rma.id } });
      rmaAfter && rmaAfter.linkedOrderId === null && rmaAfter.orderId === o.id ? pass("RmaRequest survives its order: the link is set to NULL, what the customer typed is kept") : fail(`RmaRequest after the order was deleted: ${JSON.stringify(rmaAfter)}`);
      await prisma.rmaRequest.deleteMany({ where: { email: dom.email } });

      const ev = await prisma.stripeEvent.create({ data: { stripeEventId: `evt_qa_${Date.now()}`, type: "qa" } });
      ev.attempts === 0 && ev.completedAt === null && ev.lastError === null && ev.claimedAt instanceof Date ? pass("StripeEvent is a lease: claimedAt set, completedAt NULL, attempts 0") : fail(`StripeEvent lease defaults wrong: ${JSON.stringify(ev)}`);
      const took = await prisma.stripeEvent.updateMany({ where: { id: ev.id, completedAt: null, claimedAt: { lt: new Date(Date.now() + 1000) } }, data: { claimedAt: new Date(), attempts: { increment: 1 } } });
      const twice = await prisma.stripeEvent.updateMany({ where: { id: ev.id, completedAt: null, claimedAt: { lt: new Date(Date.now() - 60_000) } }, data: { attempts: { increment: 1 } } });
      took.count === 1 && twice.count === 0 ? pass("StripeEvent: an expired lease can be taken over once; a live lease cannot") : fail(`StripeEvent takeover: ${took.count}/${twice.count}`);
      await prisma.stripeEvent.delete({ where: { id: ev.id } });

      const u2 = await prisma.user.update({ where: { id: dom.id }, data: { stripeSubStatus: "active", stripeCurrentPeriodEnd: new Date(), trialUsedAt: new Date() } });
      u2.stripeSubStatus === "active" && u2.trialUsedAt ? pass("User: subscription status, period end and trialUsedAt store") : fail("User subscription columns do not store");

      // CreditNote: Restrict on the invoice, unique number.
      const o2 = await prisma.order.create({ data: { userId: dom.id, email: dom.email, subtotalEur: 10, totalEur: 10, shippingAddress: "{}", items: { create: [{ partId: domPart.id, quantity: 1, unitPrice: 10 }] } } });
      const inv = await prisma.invoice.create({ data: { number: `QA-INV-${Date.now()}`, year: 2099, orderId: o2.id, subtotalEur: 10, vatRate: 0.21, vatEur: 1.74, totalEur: 10, sellerJson: "{}", buyerJson: "{}", linesJson: "[]" } });
      const cn = await prisma.creditNote.create({ data: { number: `CN-QA-${Date.now()}`, year: 2099, invoiceId: inv.id, reason: "qa", subtotalEur: 8.26, vatRate: 0.21, vatEur: 1.74, totalEur: 10, sellerJson: "{}", buyerJson: "{}", linesJson: "[]" } });
      const cnKey = await prisma.creditNote.create({ data: { number: `CN-QA-K1-${Date.now()}`, year: 2099, invoiceId: inv.id, reason: "qa", subtotalEur: 1, vatRate: 0.21, vatEur: 0, totalEur: 1, sellerJson: "{}", buyerJson: "{}", linesJson: "[]", idempotencyKey: `qa-idem-${Date.now()}` } });
      const dupIdem = await prisma.creditNote.create({ data: { number: `CN-QA-K2-${Date.now()}`, year: 2099, invoiceId: inv.id, reason: "qa", subtotalEur: 1, vatRate: 0.21, vatEur: 0, totalEur: 1, sellerJson: "{}", buyerJson: "{}", linesJson: "[]", idempotencyKey: cnKey.idempotencyKey } }).then(() => "accepted", () => "rejected");
      dupIdem === "rejected" ? pass("CreditNote.idempotencyKey is unique (a double-submitted refund cannot book two notes)") : fail("two credit notes share an idempotencyKey");
      await prisma.creditNote.delete({ where: { id: cnKey.id } });
      const delInv = await prisma.invoice.delete({ where: { id: inv.id } }).then(() => "deleted", () => "refused");
      delInv === "refused" ? pass("CreditNote: an invoice that has a credit note cannot be deleted (Restrict)") : fail("invoice deleted although a credit note references it");
      await prisma.creditNote.delete({ where: { id: cn.id } });
      await prisma.invoice.delete({ where: { id: inv.id } });
      await prisma.order.delete({ where: { id: o2.id } });
    } finally {
      await prisma.user.delete({ where: { id: dom.id } }).catch(() => undefined);
      await prisma.part.delete({ where: { id: domPart.id } }).catch(() => undefined);
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
