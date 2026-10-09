/**
 * Seed script — loads the canonical static catalog (src/data/*.json) into
 * Postgres. IDs are preserved so the static fallback and the database always
 * agree (orders reference Part.id, checkout resolves parts from the static
 * catalog, etc.).
 *
 * Idempotent: every row is upserted, so it is safe to re-run at any time.
 * User-generated data (orders, diagnoses, reviews) is never touched.
 *
 * Catalog rows are seeded CREATE-ONLY. Once a row exists the database owns it,
 * because /admin edits it there: re-running this with the JSON in the update
 * payload put a price raised to 99,99 back to 28,50 on the next content
 * deploy, and did the same to guide titles and isPremium flags. New rows added
 * to src/data/*.json still land; changes to rows that already exist do not, so
 * a correction to shipped content has to be made in /admin as well.
 *
 * Two modes (see prisma/seed-mode.ts):
 *   production  NODE_ENV=production, or a database that is not on this machine
 *               without SEED_DEMO=true. Never seeds users, whatever SEED_USERS
 *               says. Parts go in only when the Part table is EMPTY, with stock 0
 *               and costSource ESTIMATE, so a later deploy never resurrects a
 *               part the owner deleted and never touches a price, and the
 *               shop cannot sell units nobody counted.
 *   demo        local database (or SEED_DEMO=true): demo users and the demo
 *               stock from src/data/parts.json, as before.
 *
 * Usage: npx prisma migrate deploy && npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl, seedMode } from "./seed-mode";
import machines from "../src/data/machines.json";
import parts from "../src/data/parts.json";
import errorCodes from "../src/data/error-codes.json";
import guides from "../src/data/guides.json";
import partMachine from "../src/data/part-machine.json";
import errorCodeParts from "../src/data/errorcode-parts.json";
import errorCodeGuides from "../src/data/errorcode-guides.json";
import guideParts from "../src/data/guide-parts.json";

// The URL the mode decision is made from must be the URL the client connects
// to: when it lives only in ./.env, hand it to the client explicitly.
const resolvedDatabaseUrl = resolveDatabaseUrl(process.env);
if (resolvedDatabaseUrl && !process.env.DATABASE_URL) process.env.DATABASE_URL = resolvedDatabaseUrl;

const prisma = new PrismaClient();

type MachineRow = { id: string; brand: string; model: string; yearFrom: number | null; yearTo: number | null; imageUrl: string | null; description: string | null };
type PartRow = { id: string; sku: string; name: string; description?: string | null; brand: string; category: string; priceEur: number; costEur?: number | null; stock: number; imageUrl?: string | null; isOriginal: boolean; supplier?: string | null };
type ErrorCodeRow = { id: string; code: string; machineId: string; title: string; description: string; likelyCauses: string; severity: string; diyFriendly: boolean; provenance: string; sourceUrl: string | null; sourceName: string | null };
type GuideRow = { id: string; title: string; slug: string; machineId: string | null; difficulty: string; timeMinutes: number; steps: string; tools: string; summary: string; warnings: string | null; isPremium: boolean; views: number; createdAt: string };

const SUPERADMIN_EMAIL = "jdahoe@hotmail.nl";
const CHUNK = 50;

async function inChunks<T>(rows: T[], fn: (row: T) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await Promise.all(rows.slice(i, i + CHUNK).map(fn));
  }
}

async function main() {
  console.log("🌱 Seeding WasFix Pro from src/data/*.json …");

  const { mode, reason } = seedMode(process.env);
  const production = mode === "production";
  console.log(`  mode: ${mode} (${reason})`);
  if (production && process.env.NODE_ENV !== "production") {
    console.log("  ⚠  treating this database as production: no users, stock 0. Set SEED_DEMO=true to load the demo users and demo stock into it.");
  }

  // ── Users ────────────────────────────────────────────────────────
  // SECURITY: never seed privileged accounts into a production database.
  // getCurrentUser() claims an existing row *by e-mail address* on first
  // sign-in, so a seeded ADMIN row is a standing takeover target for whoever
  // can receive mail at that address. Three of these use @wasfixpro.nl, which
  // is not the production domain (wasfix.nl) — if that domain is not owned by
  // the company, registering it is enough to inherit ADMIN. The catalog below
  // still seeds normally; only the accounts are skipped. SEED_USERS no longer
  // overrides this. The intended way to get a first admin is ADMIN_EMAILS (see
  // src/lib/env.ts), but nothing in this tree reads that variable yet: until the
  // sign-in code does, a production database has no admin from the seed.
  if (production) {
    console.log(`  ⏭  users skipped (production${process.env.SEED_USERS === "true" ? "; SEED_USERS=true is ignored here" : ""})`);
  } else {
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
  }

  // ── Machines ─────────────────────────────────────────────────────
  // The one catalog table that keeps its update payload: /admin has no machine
  // editor, so there is no hand-entered data here to overwrite.
  await inChunks(machines as MachineRow[], (m) =>
    prisma.washingMachine.upsert({
      where: { id: m.id },
      update: { brand: m.brand, model: m.model, yearFrom: m.yearFrom, yearTo: m.yearTo, imageUrl: m.imageUrl, description: m.description },
      create: { id: m.id, brand: m.brand, model: m.model, yearFrom: m.yearFrom, yearTo: m.yearTo, imageUrl: m.imageUrl, description: m.description },
    })
  );
  console.log(`  ✓ ${machines.length} machines`);

  // ── Parts ────────────────────────────────────────────────────────
  // Production: only into an empty Part table, with stock 0. src/data/parts.json
  // carries generated stock numbers and costs derived from the selling price
  // (scripts/add-part-costs.mjs); presented as real they let the shop sell
  // units nobody has and report margins nobody measured. Once the owner has
  // any part, the catalogue belongs to the database: a part deleted in /admin
  // stays deleted and an edited price stays edited.
  const existingParts = await prisma.part.count();
  const seedParts = !production || existingParts === 0;
  if (!seedParts) {
    console.log(`  ⏭  parts skipped (production, ${existingParts} already in the database)`);
  } else {
    await inChunks(parts as PartRow[], (p) => {
      const data = {
        sku: p.sku,
        name: p.name,
        description: p.description ?? null,
        brand: p.brand,
        category: p.category,
        priceEur: p.priceEur,
        costEur: p.costEur ?? null,
        // Every cost in the JSON is an estimate; a QUOTE is only ever set by hand in /admin.
        costSource: "ESTIMATE",
        imageUrl: p.imageUrl ?? null,
        isOriginal: p.isOriginal,
        supplier: p.supplier ?? null,
      };
      // Create-only: from here on the database owns the row. Stock was already
      // protected this way so live inventory survives a re-seed; price, cost and
      // copy need the same protection, because /admin/onderdelen writes them and
      // an update payload put every one of them back to the JSON value.
      return prisma.part.upsert({ where: { id: p.id }, update: {}, create: { id: p.id, stock: production ? 0 : p.stock, ...data } });
    });
    console.log(`  ✓ ${parts.length} parts${production ? " (stock 0, cost source ESTIMATE)" : ""}`);
  }

  // ── Error codes ──────────────────────────────────────────────────
  await inChunks(errorCodes as ErrorCodeRow[], (ec) => {
    const data = { code: ec.code, machineId: ec.machineId, title: ec.title, description: ec.description, likelyCauses: ec.likelyCauses, severity: ec.severity, diyFriendly: ec.diyFriendly, provenance: ec.provenance, sourceUrl: ec.sourceUrl, sourceName: ec.sourceName };
    // Create-only: /admin/foutcodes owns these fields, and a verification pass
    // recorded there (provenance VERIFIED + source) must not be reset to
    // REPORTED by the next content deploy.
    return prisma.errorCode.upsert({ where: { id: ec.id }, update: {}, create: { id: ec.id, ...data } });
  });
  console.log(`  ✓ ${errorCodes.length} error codes`);

  // ── Guides ───────────────────────────────────────────────────────
  await inChunks(guides as GuideRow[], (g) => {
    const data = { title: g.title, slug: g.slug, machineId: g.machineId, difficulty: g.difficulty, timeMinutes: g.timeMinutes, steps: g.steps, tools: g.tools, summary: g.summary, warnings: g.warnings, isPremium: g.isPremium };
    // Create-only, like parts: /admin/gidsen owns the title, the difficulty and
    // the isPremium flag once the row exists. views was already protected.
    return prisma.repairGuide.upsert({
      where: { id: g.id },
      update: {},
      create: { id: g.id, views: g.views, createdAt: new Date(g.createdAt), ...data },
    });
  });
  console.log(`  ✓ ${guides.length} guides`);

  // ── Relations ────────────────────────────────────────────────────
  const machineIds = new Set((machines as MachineRow[]).map((m) => m.id));
  // Relations may only point at parts that exist: in production a part the
  // owner deleted must not come back through its relation rows.
  const partIds = new Set((await prisma.part.findMany({ select: { id: true } })).map((p) => p.id));
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
