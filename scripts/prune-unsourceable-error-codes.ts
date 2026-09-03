/**
 * Deletes error codes that verification could not place on the brand they were
 * filed under, from a database that was seeded before they were removed.
 *
 * The seed upserts; it never deletes. So dropping a row from
 * src/data/error-codes.json removes it from a fresh database but leaves it
 * standing in one that already has it. This script closes that gap.
 *
 * It works from data/verification/*.json and removes ONLY the rows whose
 * verdict is UNVERIFIED — never "everything not in the seed", which would also
 * destroy codes an admin added through /admin/foutcodes.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/prune-unsourceable-error-codes.ts [--dry-run]
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

type Verdict = { id: string; brand: string; code: string; verdict: string; note?: string };

const prisma = new PrismaClient();
const VERDICT_DIR = join(process.cwd(), "data/verification");
const dryRun = process.argv.includes("--dry-run");

async function main() {
  if (!existsSync(VERDICT_DIR)) {
    console.error(`No verdict directory at ${VERDICT_DIR}`);
    process.exitCode = 1;
    return;
  }

  const unsourceable: Verdict[] = [];
  for (const file of readdirSync(VERDICT_DIR).filter((f) => f.endsWith(".json"))) {
    const rows = JSON.parse(readFileSync(join(VERDICT_DIR, file), "utf8")) as Verdict[];
    unsourceable.push(...rows.filter((r) => r.verdict === "UNVERIFIED"));
  }

  if (unsourceable.length === 0) {
    console.log("No unsourceable codes in the verdicts — nothing to prune.");
    return;
  }

  const ids = unsourceable.map((r) => r.id);
  const present = await prisma.errorCode.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, machine: { select: { brand: true } } },
  });

  if (present.length === 0) {
    console.log(`Nothing to do — none of the ${ids.length} unsourceable codes are in this database.`);
    return;
  }

  for (const row of present) {
    const v = unsourceable.find((u) => u.id === row.id);
    console.log(`  ${row.machine.brand} ${row.code}${v?.note ? ` — ${v.note}` : ""}`);
  }

  if (dryRun) {
    console.log(`\n--dry-run: would delete ${present.length} code(s)`);
    return;
  }

  // Link rows cascade on delete (onDelete: Cascade on ErrorCodeParts/Guides).
  const { count } = await prisma.errorCode.deleteMany({ where: { id: { in: present.map((r) => r.id) } } });
  console.log(`\nDeleted ${count} unsourceable error code(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
