/**
 * Decides how prisma/seed.ts treats the database it was pointed at.
 *
 * PRODUCTION mode (no users, parts only into an EMPTY Part table, stock 0) is
 * chosen when NODE_ENV=production, and also when the database is not on this
 * machine and the caller did not say SEED_DEMO=true. The second rule exists
 * because the documented deploy step is `DATABASE_URL=<production> npm run
 * db:setup` run from a laptop, where NODE_ENV is unset: with only a NODE_ENV
 * check that run would load invented stock and the demo accounts into the
 * live database.
 *
 * DEMO mode (the previous behaviour: demo users, the stock from
 * src/data/parts.json, create-only upserts) applies on a local database, or on
 * a remote one when SEED_DEMO=true.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

export type SeedMode = "production" | "demo";

/**
 * The DATABASE_URL Prisma will actually use: the process environment first, then
 * the `.env` file in `cwd` (Prisma's own client reads it when the variable is
 * unset). Deciding the mode from process.env alone treated a developer's local
 * database as "host unknown" and seeded it as production (stock 0, no demo
 * users) whenever the URL lived only in .env. Quotes and `export ` prefixes are
 * tolerated; comments and other variables are ignored. Does not modify process.env.
 */
export function resolveDatabaseUrl(env: Record<string, string | undefined>, cwd: string = process.cwd()): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  try {
    const text = readFileSync(path.join(cwd, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      const value = m[1].replace(/^(["'])(.*)\1$/, "$2").trim();
      if (value) return value;
    }
  } catch {
    // No .env file: the caller keeps "no URL".
  }
  return undefined;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]);

/** The host of a Postgres URL, or null when it cannot be parsed or is a unix socket. */
export function databaseHost(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  try {
    const host = new URL(databaseUrl).hostname.toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

export function isLocalDatabase(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  try {
    const u = new URL(databaseUrl);
    // postgresql:///db?host=/var/run/postgresql is a unix socket on this machine.
    if ((u.searchParams.get("host") ?? "").startsWith("/")) return true;
    return LOCAL_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    // Unparseable: do not assume it is harmless.
    return false;
  }
}

export function seedMode(env: { NODE_ENV?: string; DATABASE_URL?: string; SEED_DEMO?: string }): { mode: SeedMode; reason: string } {
  if (env.NODE_ENV === "production") return { mode: "production", reason: "NODE_ENV=production" };
  if (isLocalDatabase(env.DATABASE_URL)) return { mode: "demo", reason: "local database" };
  if (env.SEED_DEMO === "true") return { mode: "demo", reason: "SEED_DEMO=true" };
  return {
    mode: "production",
    reason: `the database host (${databaseHost(env.DATABASE_URL) ?? "unknown"}) is not local and SEED_DEMO is not "true"`,
  };
}
