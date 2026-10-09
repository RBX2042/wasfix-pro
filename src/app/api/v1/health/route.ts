import { NextResponse } from "next/server";
import { PLAN_API_HOURLY_BURST, PLAN_API_MONTHLY_CALLS } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { env, isDatabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Liveness AND readiness, for an uptime monitor.
 *
 * It used to answer 200 {"status":"ok"} whatever the state of the database, so
 * a dead database, or a deploy whose migrations were never applied, looked
 * healthy while every order failed. Now:
 *   database    "ok" | "unreachable" | "not_configured"
 *   migrations  "ok" | "pending" | "unknown"
 * and the HTTP status is 503 when the shop cannot work: in production, a database
 * that is missing, unreachable or behind the code. Outside production a missing
 * DATABASE_URL is normal (the app serves the static catalogue), so it is "ok"
 * with database "not_configured".
 *
 * Nothing here says WHY (no host names, no error text, no migration names): the
 * route is public. The reason goes to the server log.
 *
 * "pending" means a migration folder that existed when the app was BUILT
 * (next.config.ts bakes the list into WASFIX_EXPECTED_MIGRATIONS) is not recorded
 * as finished in _prisma_migrations. "unknown" = no list was baked in.
 *
 * The DB result is cached for CACHE_MS so a monitor (or a loop) polling this
 * route cannot turn it into database load.
 */

type DbState = "ok" | "unreachable" | "not_configured";
type MigrationState = "ok" | "pending" | "unknown";
type Probe = { database: DbState; migrations: MigrationState; at: number };

const CACHE_MS = 5_000;
const DB_TIMEOUT_MS = 3_000;
let cached: Probe | null = null;

function expectedMigrations(): string[] | null {
  const raw = process.env.WASFIX_EXPECTED_MIGRATIONS;
  if (!raw) return null;
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) && list.every((n) => typeof n === "string") ? (list as string[]) : null;
  } catch {
    return null;
  }
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}

async function probe(): Promise<Probe> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached;

  let result: Probe;
  if (!isDatabaseConfigured()) {
    result = { database: "not_configured", migrations: "unknown", at: now };
  } else {
    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, DB_TIMEOUT_MS);
      let migrations: MigrationState = "unknown";
      const expected = expectedMigrations();
      if (expected) {
        try {
          const rows = await withTimeout(
            prisma.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
            DB_TIMEOUT_MS,
          );
          const applied = new Set(rows.map((r) => r.migration_name));
          const missing = expected.filter((name) => !applied.has(name));
          migrations = missing.length === 0 ? "ok" : "pending";
          if (missing.length > 0) logger.error(`[health] ${missing.length} migration(s) in this build are not applied to the database; run npm run db:migrate:deploy`, { missing });
        } catch (err) {
          // The table is missing (database never migrated) or unreadable.
          migrations = "pending";
          logger.error("[health] cannot read _prisma_migrations; the database has probably never been migrated", err);
        }
      }
      result = { database: "ok", migrations, at: now };
    } catch (err) {
      logger.error("[health] database is unreachable", err);
      result = { database: "unreachable", migrations: "unknown", at: now };
    }
  }
  cached = result;
  return result;
}

// "API" is an internal legacy plan and is not listed. The limits are read from the same constants api-auth.ts enforces (and
// /api-docs prints), so this answer cannot drift from the behaviour.
export async function GET() {
  const limits = Object.fromEntries(
    Object.keys(PLAN_API_MONTHLY_CALLS).filter((plan) => plan !== "API").map((plan) => [plan, { callsPerMonth: PLAN_API_MONTHLY_CALLS[plan], callsPerHour: PLAN_API_HOURLY_BURST[plan] }]),
  );

  const state = await probe();
  const cannotWork =
    state.database === "unreachable" ||
    state.migrations === "pending" ||
    (env.IS_PRODUCTION && state.database === "not_configured");

  return NextResponse.json(
    {
      status: cannotWork ? "unavailable" : "ok",
      version: "v1",
      timestamp: new Date().toISOString(),
      checks: { database: state.database, migrations: state.migrations },
      endpoints: [
        { method: "POST", path: "/api/v1/diagnose", auth: "api_key" },
        { method: "GET", path: "/api/v1/parts/{sku}", auth: "api_key" },
        { method: "GET", path: "/api/v1/errorcodes/{brand}/{code}", auth: "api_key" },
        { method: "GET", path: "/api/v1/health", auth: "none" },
      ],
      // One hourly limit per key across all endpoints, plus the monthly allowance of the plan.
      limits,
    },
    { status: cannotWork ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
