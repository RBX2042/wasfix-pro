/**
 * The seed must not put invented stock or demo accounts into a production
 * database, and must not resurrect what the owner deleted.
 *
 * Builds scratch databases (CREATE DATABASE on the server DATABASE_URL points
 * to, same credentials), migrates them, runs the REAL prisma/seed.ts as a child
 * process, and inspects the result.
 *
 * Usage: DATABASE_URL=postgresql://user:pw@localhost:5432/anydb npx tsx scripts/qa-seed.ts
 */
import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolveDatabaseUrl, seedMode } from "../prisma/seed-mode";

const ROOT = path.resolve(__dirname, "..");
const log: string[] = [];
const check = (cond: boolean, ok: string, bad: string) => log.push(cond ? `✅ ${ok}` : `❌ ${bad}`);

function urlFor(base: string, db: string): string {
  const u = new URL(base);
  u.pathname = `/${db}`;
  u.search = "";
  return u.toString();
}

function run(cmd: string[], env: Record<string, string | undefined>) {
  // Start from the caller's environment minus anything that steers the seed, then add what the case needs.
  const base: Record<string, string | undefined> = { ...process.env };
  for (const k of ["NODE_ENV", "SEED_USERS", "SEED_DEMO"]) delete base[k];
  const r = spawnSync("npx", cmd, { cwd: ROOT, encoding: "utf8", env: { ...base, ...env } as NodeJS.ProcessEnv });
  return { code: r.status ?? 1, out: `${r.stdout}\n${r.stderr}` };
}

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required");
  const admin = new PrismaClient({ datasourceUrl: urlFor(base, "postgres") });
  const names: string[] = [];
  const mkdb = async () => {
    const name = `wasfix_seed_${randomBytes(4).toString("hex")}`;
    names.push(name);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    const url = urlFor(base, name);
    const m = run(["prisma", "migrate", "deploy"], { DATABASE_URL: url });
    if (m.code !== 0) throw new Error(`migrate failed: ${m.out}`);
    return { url, db: new PrismaClient({ datasourceUrl: url }) };
  };

  try {
    // ── Pure decision ──────────────────────────────────────────────────────
    check(seedMode({ NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@localhost/x" }).mode === "production", "Mode: NODE_ENV=production is production even on localhost", "Mode: production on localhost not recognised");
    check(seedMode({ DATABASE_URL: "postgresql://u:p@localhost:5432/x" }).mode === "demo", "Mode: a local database without NODE_ENV is demo", "Mode: local database not demo");
    check(seedMode({ DATABASE_URL: "postgresql://u:p@db.example.supabase.co:5432/postgres" }).mode === "production", "Mode: a remote database with NODE_ENV unset is treated as production (the documented laptop deploy)", "Mode: remote database seeded as demo");
    check(seedMode({ DATABASE_URL: "postgresql://u:p@db.example.supabase.co:5432/postgres", SEED_DEMO: "true" }).mode === "demo", "Mode: SEED_DEMO=true opts a remote database into demo data explicitly", "Mode: SEED_DEMO ignored");
    check(seedMode({ DATABASE_URL: "garbage" }).mode === "production" && seedMode({}).mode === "production", "Mode: an unparseable or missing URL is not assumed harmless", "Mode: garbage URL treated as demo");

    // ── DATABASE_URL that lives only in .env ───────────────────────────────
    // Prisma's own client reads .env, so the seed must decide the mode from the same URL.
    // (Deciding from process.env alone called a local database "host unknown" and seeded it as production.)
    const envDir = mkdtempSync(path.join(tmpdir(), "qa-seed-env-"));
    const dotEnv = (body: string) => { writeFileSync(path.join(envDir, ".env"), body); return envDir; };
    check(resolveDatabaseUrl({}, dotEnv('# DATABASE_URL="postgresql://u:p@wrong/x"\nOTHER=1\nDATABASE_URL="postgresql://u:p@localhost:5432/fromfile"\n')) === "postgresql://u:p@localhost:5432/fromfile", ".env: a quoted DATABASE_URL is found, a commented one is ignored", ".env: quoted/commented DATABASE_URL mis-read");
    check(resolveDatabaseUrl({}, dotEnv("export DATABASE_URL=postgresql://u:p@db.example.com/x\r\n")) === "postgresql://u:p@db.example.com/x", ".env: 'export ' prefix and CRLF line endings are tolerated", ".env: export/CRLF mis-read");
    check(resolveDatabaseUrl({ DATABASE_URL: "postgresql://u:p@localhost/env" }, dotEnv("DATABASE_URL=postgresql://u:p@other/file")) === "postgresql://u:p@localhost/env", ".env: the process environment wins over the file", ".env: file overrode process.env");
    check(resolveDatabaseUrl({}, mkdtempSync(path.join(tmpdir(), "qa-seed-noenv-"))) === undefined && resolveDatabaseUrl({}, dotEnv("NOTHING=1")) === undefined, ".env: no file or no DATABASE_URL line means no URL (the mode stays 'production, host unknown')", ".env: invented a URL");
    {
      // End to end: no DATABASE_URL in the environment, a local one in ./.env of the working directory.
      const local = await mkdb();
      const dir = dotEnv(`DATABASE_URL="${local.url}"\n`);
      const base: Record<string, string | undefined> = { ...process.env };
      for (const k of ["NODE_ENV", "SEED_USERS", "SEED_DEMO", "DATABASE_URL"]) delete base[k];
      const r = spawnSync("npx", ["tsx", path.join(ROOT, "prisma", "seed.ts")], { cwd: dir, encoding: "utf8", env: base as NodeJS.ProcessEnv });
      const stock = await local.db.part.aggregate({ _sum: { stock: true } });
      check(/mode: demo \(local database\)/.test(r.stdout) && (stock._sum.stock ?? 0) > 0 && (await local.db.user.count()) >= 4, "Seed with DATABASE_URL only in .env (local database): demo mode, demo stock and demo users", `Seed with .env only: ${r.stdout.slice(0, 300)} ${r.stderr.slice(-300)} stock ${stock._sum.stock}`);
      await local.db.$disconnect();
    }

    // ── Production seed on an empty database ───────────────────────────────
    const prod = await mkdb();
    const first = run(["tsx", "prisma/seed.ts"], { DATABASE_URL: prod.url, NODE_ENV: "production", SEED_USERS: "true" });
    check(first.code === 0, "Production seed: runs to completion", `Production seed failed: ${first.out.slice(-600)}`);
    const agg = await prod.db.part.aggregate({ _count: true, _sum: { stock: true }, _max: { stock: true } });
    const estimates = await prod.db.part.count({ where: { costSource: "ESTIMATE" } });
    check(agg._count > 0 && agg._sum.stock === 0 && agg._max.stock === 0, `Production seed: all ${agg._count} parts have stock 0 (the shop cannot sell units nobody counted)`, `Production seed stock: sum ${agg._sum.stock}, max ${agg._max.stock}`);
    check(estimates === agg._count, "Production seed: every part is costSource ESTIMATE", `Production seed: ${agg._count - estimates} parts are not ESTIMATE`);
    check((await prod.db.user.count()) === 0, "Production seed: NO users, even with SEED_USERS=true (D7)", `Production seed created ${await prod.db.user.count()} users`);
    check(/SEED_USERS=true is ignored/.test(first.out), "Production seed: says out loud that SEED_USERS=true is ignored", "Production seed: silent about SEED_USERS");

    // ── The owner edits, deletes, and redeploys ────────────────────────────
    const keep = await prod.db.part.findFirstOrThrow({ orderBy: { sku: "asc" } });
    const gone = await prod.db.part.findFirstOrThrow({ orderBy: { sku: "desc" } });
    await prod.db.part.update({ where: { id: keep.id }, data: { stock: 7, priceEur: 99.99, costEur: 41, costSource: "QUOTE" } });
    await prod.db.part.delete({ where: { id: gone.id } });
    const second = run(["tsx", "prisma/seed.ts"], { DATABASE_URL: prod.url, NODE_ENV: "production" });
    const after = await prod.db.part.findUniqueOrThrow({ where: { id: keep.id } });
    check(second.code === 0 && (await prod.db.part.findUnique({ where: { id: gone.id } })) === null, "Re-seed in production: a part the owner deleted is NOT resurrected", `Re-seed resurrected ${gone.sku}: ${second.out.slice(-300)}`);
    check(after.stock === 7 && after.priceEur === 99.99 && after.costEur === 41 && after.costSource === "QUOTE", "Re-seed in production: an edited price, stock, cost and costSource survive", `Re-seed overwrote the edit: ${JSON.stringify(after)}`);
    check((await prod.db.part.count()) === agg._count - 1, "Re-seed in production: the Part table is untouched (skipped, not merged)", "Re-seed changed the Part table");
    check((await prod.db.partMachine.count({ where: { partId: gone.id } })) === 0, "Re-seed in production: relation rows of a deleted part do not come back", "Re-seed recreated relations of a deleted part");
    check((await prod.db.errorCode.count()) > 0 && (await prod.db.washingMachine.count()) > 0 && (await prod.db.repairGuide.count()) > 0, "Re-seed in production: machines, error codes and guides are still seeded", "Re-seed lost the content catalogue");

    // ── An unset NODE_ENV against a non-local host is production, end to end ─
    const remote = run(["tsx", "prisma/seed.ts"], { DATABASE_URL: "postgresql://wasfix:wasfix@127.0.0.2:5432/never_used" });
    check(/mode: production \(the database host \(127\.0\.0\.2\) is not local/.test(remote.out) && /treating this database as production/.test(remote.out), "Seed wiring: NODE_ENV unset + non-local host announces production mode before touching anything", `Seed wiring: ${remote.out.slice(0, 400)}`);

    // ── Demo seed keeps the demo data ──────────────────────────────────────
    const demo = await mkdb();
    const d = run(["tsx", "prisma/seed.ts"], { DATABASE_URL: demo.url });
    const dagg = await demo.db.part.aggregate({ _count: true, _sum: { stock: true } });
    check(d.code === 0 && (dagg._sum.stock ?? 0) > 0 && (await demo.db.user.count()) >= 4, `Demo seed (local database): keeps the demo stock (${dagg._sum.stock} units) and the demo users`, `Demo seed changed: stock ${dagg._sum.stock}, users ${await demo.db.user.count()} ${d.out.slice(-300)}`);
    check((await demo.db.part.count({ where: { costSource: "ESTIMATE" } })) === dagg._count, "Demo seed: every part is costSource ESTIMATE too", "Demo seed: a part is not ESTIMATE");
    await prod.db.$disconnect();
    await demo.db.$disconnect();
  } finally {
    for (const name of names) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => undefined);
    await admin.$disconnect();
    console.log(log.join("\n"));
    const failures = log.filter((l) => l.startsWith("❌")).length;
    console.log(`\n${log.length - failures}/${log.length} seed checks passed`);
    if (failures > 0) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
