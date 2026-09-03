/**
 * Seed script — loads the canonical static catalog (src/data/*.json) into
 * Postgres. IDs are preserved so the static fallback and the database always
 * agree (orders reference Part.id, checkout resolves parts from the static
 * catalog, etc.).
 *
 * Idempotent: every row is upserted, so it is safe to re-run after content
 * updates. User-generated data (orders, diagnoses, reviews) is never touched.
 *
 * Usage: npx prisma db push && npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import machines from "../src/data/machines.json";
import parts from "../src/data/parts.json";
import errorCodes from "../src/data/error-codes.json";
import guides from "../src/data/guides.json";
import partMachine from "../src/data/part-machine.json";
import errorCodeParts from "../src/data/errorcode-parts.json";
import errorCodeGuides from "../src/data/errorcode-guides.json";
import guideParts from "../src/data/guide-parts.json";

const prisma = new PrismaClient();

type MachineRow = { id: string; brand: string; model: string; yearFrom: number | null; yearTo: number | null; imageUrl: string | null; description: string | null };
type PartRow = { id: string; sku: string; name: string; description?: string | null; brand: string; category: string; priceEur: number; costEur?: number | null; stock: number; imageUrl?: string | null; isOriginal: boolean; supplier?: string | null };
type ErrorCodeRow = { id: string; code: string; machineId: string; title: string; description: string; likelyCauses: string; severity: string; diyFriendly: boolean; provenance: string; sourceUrl: string | null; sourceName: string | null };
type GuideRow = { id: string; title: string; slug: string; machineId: string | null; difficulty: string; timeMinutes: number; steps: string; tools: string; summary: string; warnings: string | null; isPremium: boolean; views: number; createdAt: number | string };

const SUPERADMIN_EMAIL = "jdahoe@hotmail.nl";
const CHUNK = 50;

async function inChunks<T>(rows: T[], fn: (row: T) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await Promise.all(rows.slice(i, i + CHUNK).map(fn));
  }
}

async function main() {
  console.log("🌱 Seeding WasFix Pro from src/data/*.json …");

  // ── Users ────────────────────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: SUPERADMIN_EMAIL },
    update: { role: "ADMIN", plan: "BEDRIJF" },
    create: { id: "jdahoe-superadmin", email: SUPERADMIN_EMAIL, name: "Jimmy Dahoe", role: "ADMIN", plan: "BEDRIJF" },
  });
  await prisma.user.upsert({
    where: { email: "demo@wasfixpro.nl" },
    update: {},
    create: { email: "demo@wasfixpro.nl", name: "Demo User", role: "ADMIN", plan: "BEDRIJF" },
  });
  await prisma.user.upsert({
    where: { email: "monteur@wasfixpro.nl" },
    update: {},
    create: { email: "monteur@wasfixpro.nl", name: "Demo Monteur", role: "TECHNICIAN", plan: "MONTEUR_PRO" },
  });
  await prisma.user.upsert({
    where: { email: "klant@wasfixpro.nl" },
    update: {},
    create: { email: "klant@wasfixpro.nl", name: "Demo Klant", role: "CONSUMER", plan: "FREE" },
  });
  console.log("  ✓ users");

  // ── Machines ─────────────────────────────────────────────────────
  await inChunks(machines as MachineRow[], (m) =>
    prisma.washingMachine.upsert({
      where: { id: m.id },
      update: { brand: m.brand, model: m.model, yearFrom: m.yearFrom, yearTo: m.yearTo, imageUrl: m.imageUrl, description: m.description },
      create: { id: m.id, brand: m.brand, model: m.model, yearFrom: m.yearFrom, yearTo: m.yearTo, imageUrl: m.imageUrl, description: m.description },
    })
  );
  console.log(`  ✓ ${machines.length} machines`);

  // ── Parts ────────────────────────────────────────────────────────
  await inChunks(parts as PartRow[], (p) => {
    const data = {
      sku: p.sku,
      name: p.name,
      description: p.description ?? null,
      brand: p.brand,
      category: p.category,
      priceEur: p.priceEur,
      costEur: p.costEur ?? null,
      imageUrl: p.imageUrl ?? null,
      isOriginal: p.isOriginal,
      supplier: p.supplier ?? null,
    };
    // Stock is only set on create so live inventory is not reset by a re-seed.
    return prisma.part.upsert({ where: { id: p.id }, update: data, create: { id: p.id, stock: p.stock, ...data } });
  });
  console.log(`  ✓ ${parts.length} parts`);

  // ── Error codes ──────────────────────────────────────────────────
  await inChunks(errorCodes as ErrorCodeRow[], (ec) => {
    const data = { code: ec.code, machineId: ec.machineId, title: ec.title, description: ec.description, likelyCauses: ec.likelyCauses, severity: ec.severity, diyFriendly: ec.diyFriendly, provenance: ec.provenance, sourceUrl: ec.sourceUrl, sourceName: ec.sourceName };
    return prisma.errorCode.upsert({ where: { id: ec.id }, update: data, create: { id: ec.id, ...data } });
  });
  console.log(`  ✓ ${errorCodes.length} error codes`);

  // ── Guides ───────────────────────────────────────────────────────
  await inChunks(guides as GuideRow[], (g) => {
    const data = { title: g.title, slug: g.slug, machineId: g.machineId, difficulty: g.difficulty, timeMinutes: g.timeMinutes, steps: g.steps, tools: g.tools, summary: g.summary, warnings: g.warnings, isPremium: g.isPremium };
    return prisma.repairGuide.upsert({
      where: { id: g.id },
      update: data,
      create: { id: g.id, views: g.views, createdAt: new Date(g.createdAt), ...data },
    });
  });
  console.log(`  ✓ ${guides.length} guides`);

  // ── Relations ────────────────────────────────────────────────────
  const machineIds = new Set((machines as MachineRow[]).map((m) => m.id));
  const partIds = new Set((parts as PartRow[]).map((p) => p.id));
  const ecIds = new Set((errorCodes as ErrorCodeRow[]).map((e) => e.id));
  const guideIds = new Set((guides as GuideRow[]).map((g) => g.id));

  const pm = (partMachine as Array<{ partId: string; machineId: string }>).filter((r) => partIds.has(r.partId) && machineIds.has(r.machineId));
  const ecp = (errorCodeParts as Array<{ errorCodeId: string; partId: string }>).filter((r) => ecIds.has(r.errorCodeId) && partIds.has(r.partId));
  const ecg = (errorCodeGuides as Array<{ errorCodeId: string; guideId: string }>).filter((r) => ecIds.has(r.errorCodeId) && guideIds.has(r.guideId));
  const gp = (guideParts as Array<{ guideId: string; partId: string }>).filter((r) => guideIds.has(r.guideId) && partIds.has(r.partId));

  await prisma.partMachine.createMany({ data: pm, skipDuplicates: true });
  await prisma.errorCodeParts.createMany({ data: ecp, skipDuplicates: true });
  await prisma.errorCodeGuides.createMany({ data: ecg, skipDuplicates: true });
  await prisma.guideParts.createMany({ data: gp, skipDuplicates: true });
  console.log(`  ✓ relations: ${pm.length} part↔machine, ${ecp.length} code↔part, ${ecg.length} code↔guide, ${gp.length} guide↔part`);

  const counts = {
    users: await prisma.user.count(),
    machines: await prisma.washingMachine.count(),
    parts: await prisma.part.count(),
    errorCodes: await prisma.errorCode.count(),
    guides: await prisma.repairGuide.count(),
  };
  console.log("✅ Seed complete:", counts);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
