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

    const userWithDiagnoses = await prisma.user.findFirst({
      where: { email: "demo@wasfixpro.nl" },
      include: { diagnoses: true, orders: { include: { items: { include: { part: true } } } } },
    });
    if (userWithDiagnoses) pass(`Relation: User→Diagnoses (${userWithDiagnoses.diagnoses.length}) + Orders (${userWithDiagnoses.orders.length})`);
    else fail("Relation: User→Diagnoses+Orders");
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
