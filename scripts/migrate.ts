/**
 * Run Prisma migrations (and the seed) over the DIRECT database connection.
 *
 *   npx tsx scripts/migrate.ts deploy      apply pending migrations   (npm run db:migrate:deploy)
 *   npx tsx scripts/migrate.ts status      list applied / pending     (npm run db:migrate:status)
 *   npx tsx scripts/migrate.ts seed        run prisma/seed.ts         (npm run db:seed)
 *   npx tsx scripts/migrate.ts resolve --applied 00000000000000_init   (any other `prisma migrate ...` argument list)
 *
 * WHY a wrapper: on Supabase the application connects through the transaction
 * pooler (port 6543, pgbouncer). Prisma Migrate takes an advisory lock and uses
 * prepared statements, which a transaction-mode pooler does not support: the
 * migration hangs or fails. It needs a session or direct connection (DIRECT_URL).
 * `directUrl` in schema.prisma would solve that but makes DIRECT_URL mandatory for
 * every Prisma command including the postinstall `prisma generate` (checked: a
 * copy of the schema with directUrl fails validation without it), so the schema
 * stays as it is and this script swaps the URL for the child process instead:
 * DATABASE_URL is replaced by DIRECT_URL when DIRECT_URL is set, and left alone
 * when it is not (local development, CI).
 *
 * Reads .env.local / .env from the repository root when a variable is not already
 * in the environment. Never prints a connection string, only host:port/database.
 */
import type { EnvLike } from "../src/lib/site-url";



import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function loadEnvFiles(cwd: string = process.cwd(), env: EnvLike = process.env): void {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(cwd, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || env[m[1]] !== undefined) continue;
      env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
}

/** host:port/database of a connection string, or null when it does not parse. Never includes credentials. */
export function describeUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return null;
  }
}

/** True for a connection string that goes through a transaction-mode pooler. */
export function looksPooled(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.searchParams.get("pgbouncer") === "true" || u.port === "6543";
  } catch {
    return false;
  }
}

export type MigrateEnv = { env: EnvLike; usingDirect: boolean; warnings: string[]; error: string | null };

/** The environment the Prisma child process gets. Pure; the CLI wrapper below spawns with it. */
export function buildMigrateEnv(base: EnvLike): MigrateEnv {
  const direct = base.DIRECT_URL?.trim();
  const pooled = base.DATABASE_URL?.trim();
  const warnings: string[] = [];
  if (!direct && !pooled) {
    return { env: base, usingDirect: false, warnings, error: "Geen DIRECT_URL en geen DATABASE_URL gevonden (omgeving, .env.local of .env)." };
  }
  if (direct) {
    if (looksPooled(direct)) {
      warnings.push("DIRECT_URL lijkt een pooler-verbinding (poort 6543 of pgbouncer=true). Migraties hebben een directe of session-pooler-verbinding nodig (poort 5432); verwacht een time-out of een fout.");
    }
    return { env: { ...base, DATABASE_URL: direct }, usingDirect: true, warnings, error: null };
  }
  if (looksPooled(pooled)) {
    warnings.push("DIRECT_URL is niet ingesteld en DATABASE_URL lijkt een pooler-verbinding (poort 6543 of pgbouncer=true). Zet DIRECT_URL op de directe of session-pooler-verbinding (poort 5432); anders blijft migreren hangen of mislukt het.");
  }
  return { env: base, usingDirect: false, warnings, error: null };
}

function run(cmd: string, args: string[], env: EnvLike): number {
  const res = spawnSync(cmd, args, { stdio: "inherit", env: env as NodeJS.ProcessEnv, shell: process.platform === "win32" });
  return res.status ?? 1;
}

function main(): number {
  loadEnvFiles();
  const [sub = "deploy", ...rest] = process.argv.slice(2);
  const built = buildMigrateEnv(process.env);
  if (built.error) {
    console.error(built.error);
    return 2;
  }
  for (const w of built.warnings) console.warn(`WAARSCHUWING: ${w}`);
  const target = describeUrl(built.env.DATABASE_URL);
  console.log(`Database: ${target ?? "(onleesbare URL)"} via ${built.usingDirect ? "DIRECT_URL" : "DATABASE_URL"}`);

  if (sub === "seed") return run("npx", ["--no-install", "tsx", "prisma/seed.ts", ...rest], built.env);
  return run("npx", ["--no-install", "prisma", "migrate", sub, ...rest], built.env);
}

if (process.argv[1] && /migrate\.[cm]?[tj]s$/.test(process.argv[1])) {
  process.exit(main());
}
