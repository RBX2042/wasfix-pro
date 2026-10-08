/**
 * Proves that the order-domain migration is safe on a database that already
 * holds data.
 *
 *   1. creates a scratch database,
 *   2. brings it to the state BEFORE the migration under test (every earlier
 *      migration, applied through a temporary copy of the prisma directory),
 *   3. loads an order with an invoice, a user with a Stripe subscription, a
 *      part, an RMA with a free-text order reference and a webhook event,
 *   4. snapshots every row, applies the real migrations directory,
 *   5. checks that no pre-existing value changed, that the backfills are right
 *      and that the resulting schema has no drift from prisma/schema.prisma,
 *   6. drops the scratch database.
 *
 * Usage: DATABASE_URL=postgresql://user:pw@host:5432/anydb npx tsx scripts/qa-migration.ts
 * The user in DATABASE_URL must be allowed to CREATE DATABASE. Only the
 * credentials and host of DATABASE_URL are used; its database is never touched.
 */
import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

/** The migration this script is about. Everything before it is "the old state". */
const MIGRATION_UNDER_TEST = "20261008100000_order_domain_credit_notes_stripe_lease";

const ROOT = path.resolve(__dirname, "..");
const results: string[] = [];
const check = (cond: boolean, ok: string, bad: string) => results.push(cond ? `✅ ${ok}` : `❌ ${bad}`);

function urlFor(base: string, db: string): string {
  const u = new URL(base);
  u.pathname = `/${db}`;
  u.search = "";
  return u.toString();
}

function prisma(args: string[], databaseUrl: string, schema: string) {
  const r = spawnSync("npx", ["prisma", ...args, "--schema", schema], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
  return { code: r.status ?? 1, out: `${r.stdout}\n${r.stderr}` };
}

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required (only its host and credentials are used)");
  const scratchName = `wasfix_mig_${randomBytes(4).toString("hex")}`;
  const admin = new PrismaClient({ datasourceUrl: urlFor(base, "postgres") });
  const scratchUrl = urlFor(base, scratchName);
  const tmp = mkdtempSync(path.join(tmpdir(), "wasfix-mig-"));
  let db: PrismaClient | null = null;

  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${scratchName}"`);

    // The old state: every migration except the one under test.
    const oldDir = path.join(tmp, "old", "prisma");
    mkdirSync(path.join(oldDir, "migrations"), { recursive: true });
    copyFileSync(path.join(ROOT, "prisma", "schema.prisma"), path.join(oldDir, "schema.prisma"));
    const all = readdirSync(path.join(ROOT, "prisma", "migrations")).filter((n) => n !== "migration_lock.toml");
    check(all.includes(MIGRATION_UNDER_TEST), `migration ${MIGRATION_UNDER_TEST} exists`, `migration ${MIGRATION_UNDER_TEST} is missing`);
    copyFileSync(path.join(ROOT, "prisma", "migrations", "migration_lock.toml"), path.join(oldDir, "migrations", "migration_lock.toml"));
    for (const name of all.filter((n) => n < MIGRATION_UNDER_TEST)) {
      cpSync(path.join(ROOT, "prisma", "migrations", name), path.join(oldDir, "migrations", name), { recursive: true });
    }
    const old = prisma(["migrate", "deploy"], scratchUrl, path.join(oldDir, "schema.prisma"));
    check(old.code === 0, "scratch database brought to the pre-migration state", `could not build the old state:\n${old.out}`);
    if (old.code !== 0) return;

    db = new PrismaClient({ datasourceUrl: scratchUrl });
    const has = async (table: string, column: string) =>
      ((await db!.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
        table,
        column,
      ))[0].n) > 0n;
    check(!(await has("Order", "accessToken")), "before: Order.accessToken does not exist yet", "before: the old state already has the new columns");

    // ── Fixtures, written with raw SQL against the OLD schema ────────────────
    await db.$executeRawUnsafe(`
      INSERT INTO "User" (id, email, name, role, plan, "stripeCustomerId", "stripeSubId", "updatedAt")
      VALUES ('u-sub', 'sub@example.test', 'Sub Scriber', 'CONSUMER', 'PARTICULIER', 'cus_123', 'sub_123', now()),
             ('u-guest', 'guest@example.test', 'Gast', 'CONSUMER', 'FREE', NULL, NULL, now())`);
    await db.$executeRawUnsafe(`
      INSERT INTO "Part" (id, sku, name, brand, category, "priceEur", "costEur", stock, "isOriginal", supplier)
      VALUES ('p-1', 'MIG-PUMP-01', 'Pomp', 'Bosch', 'PUMP', 24.5, 12.25, 7, true, NULL)`);
    // 1: Stripe order, PAID, with an invoice.  2: bank-transfer, OPENSTAAND, no stock change needed.
    // 3: CANCELLED bank-transfer order (cancelledAt gets approximated from updatedAt).
    await db.$executeRawUnsafe(`
      INSERT INTO "Order" (id, "userId", status, "subtotalEur", "totalEur", "vatRate", "vatEur", "stripePaymentId", "shippingAddress", email, "paymentMethod", "paidAt", "updatedAt")
      VALUES ('o-paid', 'u-sub', 'PAID', 24.5, 30.45, 0.21, 5.29, 'cs_test_1', '{"name":"Sub Scriber"}', 'sub@example.test', 'STRIPE', now(), now()),
             ('o-open', 'u-guest', 'OPENSTAAND', 24.5, 30.45, 0.21, 5.29, NULL, '{"name":"Gast"}', 'guest@example.test', 'BANK_TRANSFER', NULL, now()),
             ('o-cancelled', 'u-guest', 'CANCELLED', 24.5, 30.45, 0.21, 5.29, NULL, '{"name":"Gast"}', 'guest@example.test', 'BANK_TRANSFER', NULL, '2026-09-01T10:00:00Z'),
             -- two orders that share the short reference AMBIG-01: a typed "ambig-01" must NOT be linked to either
             ('ambig-01-a', 'u-guest', 'PAID', 24.5, 30.45, 0.21, 5.29, NULL, '{"name":"Gast"}', 'guest@example.test', 'BANK_TRANSFER', now(), now()),
             ('ambig-01-b', 'u-guest', 'PAID', 24.5, 30.45, 0.21, 5.29, NULL, '{"name":"Gast"}', 'guest@example.test', 'BANK_TRANSFER', now(), now())`);
    await db.$executeRawUnsafe(`
      INSERT INTO "OrderItem" (id, "orderId", "partId", quantity, "unitPrice")
      VALUES ('i-1', 'o-paid', 'p-1', 1, 24.5), ('i-2', 'o-open', 'p-1', 1, 24.5), ('i-3', 'o-cancelled', 'p-1', 1, 24.5)`);
    await db.$executeRawUnsafe(`
      INSERT INTO "Invoice" (id, number, year, "orderId", "subtotalEur", "vatRate", "vatEur", "totalEur", "sellerJson", "buyerJson", "linesJson")
      VALUES ('inv-1', '2026-00001', 2026, 'o-paid', 24.5, 0.21, 5.29, 30.45, '{"name":"Seller"}', '{"name":"Buyer"}', '[]')`);
    await db.$executeRawUnsafe(`INSERT INTO "InvoiceSequence" (year, last) VALUES (2026, 1)`);
    await db.$executeRawUnsafe(`
      INSERT INTO "RmaRequest" (id, "rmaNumber", "orderId", name, email, reason, notes, "updatedAt")
      VALUES ('r-real', 'RMA-1', 'o-paid', 'Sub', 'sub@example.test', 'DEFECT', 'kapot', now()),
             ('r-typed', 'RMA-2', 'WF-12345 (mijn bestelling)', 'Gast', 'guest@example.test', 'DEFECT', 'kapot', now()),
             ('r-open', 'RMA-4', 'o-open', 'Gast', 'guest@example.test', 'DEFECT', 'kapot', now()),
             ('r-short', 'RMA-5', ' #o-PAID ', 'Sub', 'sub@example.test', 'DEFECT', 'kapot', now()),
             ('r-amb', 'RMA-6', 'ambig-01', 'Gast', 'guest@example.test', 'DEFECT', 'kapot', now())`);
    await db.$executeRawUnsafe(`INSERT INTO "StripeEvent" (id, "stripeEventId", type, "processedAt") VALUES ('se-1', 'evt_1', 'checkout.session.completed', '2026-09-02T08:00:00Z')`);

    const TABLES = ["User", "Part", "Order", "OrderItem", "Invoice", "InvoiceSequence", "RmaRequest", "StripeEvent"];
    const snapshot = async () => {
      const out: Record<string, Record<string, Record<string, unknown>>> = {};
      for (const t of TABLES) {
        const rows = await db!.$queryRawUnsafe<{ j: Record<string, unknown> }[]>(`SELECT to_jsonb(t) AS j FROM "${t}" t`);
        out[t] = Object.fromEntries(rows.map((r) => [String(r.j.id ?? r.j.year), r.j]));
      }
      return out;
    };
    const before = await snapshot();

    // ── Apply the real migrations directory ──────────────────────────────────
    const applied = prisma(["migrate", "deploy"], scratchUrl, path.join(ROOT, "prisma", "schema.prisma"));
    check(applied.code === 0, "migrate deploy applied the new migration", `migrate deploy failed:\n${applied.out}`);
    if (applied.code !== 0) return;
    check(await has("Order", "accessToken"), "after: Order.accessToken exists", "after: Order.accessToken is missing");

    const after = await snapshot();

    // Nothing that existed may have changed, in any column of any table. That
    // includes RmaRequest.orderId, which holds free text and stays untouched.
    const changed: string[] = [];
    for (const t of TABLES) {
      for (const [key, pre] of Object.entries(before[t])) {
        const post = after[t][key];
        if (!post) {
          changed.push(`${t}/${key} disappeared`);
          continue;
        }
        for (const [col, val] of Object.entries(pre)) {
          if (JSON.stringify(post[col]) !== JSON.stringify(val)) changed.push(`${t}/${key}.${col}: ${JSON.stringify(val)} -> ${JSON.stringify(post[col])}`);
        }
      }
      if (Object.keys(after[t]).length !== Object.keys(before[t]).length) changed.push(`${t}: row count changed`);
    }
    check(changed.length === 0, `no pre-existing value changed across ${TABLES.length} tables (${Object.values(before).reduce((n, t) => n + Object.keys(t).length, 0)} rows compared)`, `existing data changed: ${changed.join("; ")}`);

    // ── Backfills ────────────────────────────────────────────────────────────
    const tokens = Object.values(after.Order).map((o) => o.accessToken as string | null);
    check(tokens.every((t) => typeof t === "string" && /^[0-9a-f]{64}$/.test(t)), "every existing order got a 64-hex accessToken", `accessToken backfill wrong: ${JSON.stringify(tokens)}`);
    check(new Set(tokens).size === tokens.length, "the backfilled access tokens are distinct", "duplicate access tokens after backfill");
    check(after.Order["o-paid"].refundedEur === 0 && after.Order["o-paid"].shippedAt === null, "new Order columns default to 0/NULL", "new Order columns have unexpected values");
    check(after.Order["o-cancelled"].cancelledAt === after.Order["o-cancelled"].updatedAt, "a CANCELLED order got cancelledAt = updatedAt (approximation)", `cancelledAt backfill wrong: ${after.Order["o-cancelled"].cancelledAt}`);
    check(after.Order["o-open"].cancelledAt === null, "a non-cancelled order has no cancelledAt", "cancelledAt set on a live order");
    check(after.Part["p-1"].costSource === "ESTIMATE", "existing part is costSource ESTIMATE", `costSource is ${after.Part["p-1"].costSource}`);
    const u = after.User["u-sub"];
    check(
      u.plan === "PARTICULIER" && u.stripeSubId === "sub_123" && u.stripeCustomerId === "cus_123" && u.stripeSubStatus === null && u.stripeCurrentPeriodEnd === null && u.trialUsedAt === null,
      "user with a Stripe subscription keeps plan and ids; new subscription columns are NULL",
      "user subscription columns wrong after migration",
    );
    const se = after.StripeEvent["se-1"];
    check(
      se.claimedAt === se.processedAt && se.completedAt === se.processedAt && se.attempts === 1 && se.lastError === null,
      "existing webhook event became a completed lease (claimedAt = completedAt = processedAt, attempts 1)",
      `StripeEvent backfill wrong: ${JSON.stringify(se)}`,
    );
    const rma = after.RmaRequest;
    check(rma["r-real"].orderId === "o-paid" && rma["r-real"].linkedOrderId === "o-paid", "RMA that pointed at a real order id: orderId untouched, linkedOrderId set", `RMA with a real order wrong: ${JSON.stringify(rma["r-real"])}`);
    check(rma["r-typed"].orderId === "WF-12345 (mijn bestelling)" && rma["r-typed"].linkedOrderId === null, "RMA with a free-text reference: the typed text stays in orderId (the live /api/retour and the admin page keep reading it), linkedOrderId is NULL", `RMA free-text wrong: ${JSON.stringify(rma["r-typed"])}`);
    check(rma["r-short"].orderId === " #o-PAID " && rma["r-short"].linkedOrderId === "o-paid", "RMA typed as ' #o-PAID ' (short reference with # and spaces, any case) is linked to the one order it names", `RMA short reference wrong: ${JSON.stringify(rma["r-short"])}`);
    check(rma["r-amb"].linkedOrderId === null && rma["r-amb"].orderId === "ambig-01", "RMA whose short reference matches TWO orders is not linked to either", `RMA ambiguous reference wrong: ${JSON.stringify(rma["r-amb"])}`);

    // ── The new constraints and tables work ──────────────────────────────────
    // What /api/retour does: any typed text goes into orderId and must be accepted.
    let freeTextAccepted = true;
    try {
      await db.$executeRawUnsafe(`INSERT INTO "RmaRequest" (id, "rmaNumber", "orderId", name, email, reason, notes, "updatedAt") VALUES ('r-new', 'RMA-7', 'CMUZKSN0', 'x', 'x@example.test', 'x', 'x', now())`);
    } catch {
      freeTextAccepted = false;
    }
    check(freeTextAccepted, "after: a free-text order reference can still be inserted into RmaRequest.orderId (the live return form keeps working)", "after: RmaRequest.orderId rejects free text");
    let fkRejected = false;
    try {
      await db.$executeRawUnsafe(`INSERT INTO "RmaRequest" (id, "rmaNumber", "orderId", "linkedOrderId", name, email, reason, notes, "updatedAt") VALUES ('r-bad', 'RMA-3', 'x', 'nope', 'x', 'x@example.test', 'x', 'x', now())`);
    } catch {
      fkRejected = true;
    }
    check(fkRejected, "RmaRequest.linkedOrderId is a foreign key (a made-up id is refused)", "RmaRequest.linkedOrderId accepts any text");
    await db.$executeRawUnsafe(`DELETE FROM "Order" WHERE id = 'o-open'`);
    const rmaOpen = await db.$queryRawUnsafe<{ id: string; orderId: string; linkedOrderId: string | null }[]>(`SELECT id, "orderId", "linkedOrderId" FROM "RmaRequest" WHERE id = 'r-open'`);
    check(rmaOpen.length === 1 && rmaOpen[0].linkedOrderId === null && rmaOpen[0].orderId === "o-open", "deleting an order keeps its RMA, nulls the link (SET NULL) and keeps the typed reference", `RMA lost or still linked after its order was deleted: ${JSON.stringify(rmaOpen)}`);
    await db.$executeRawUnsafe(`DELETE FROM "OrderItem" WHERE "orderId" = 'o-paid'`);
    await db.$executeRawUnsafe(
      `INSERT INTO "CreditNote" (id, number, year, "invoiceId", reason, "subtotalEur", "vatRate", "vatEur", "totalEur", "sellerJson", "buyerJson", "linesJson") VALUES ('cn-1', 'CN-2026-00001', 2026, 'inv-1', 'test', 25.16, 0.21, 5.29, 30.45, '{}', '{}', '[]')`,
    );
    let restrictHeld = false;
    try {
      await db.$executeRawUnsafe(`DELETE FROM "Invoice" WHERE id = 'inv-1'`);
    } catch {
      restrictHeld = true;
    }
    check(restrictHeld, "an invoice with a credit note cannot be deleted (ON DELETE RESTRICT)", "an invoice with a credit note was deleted");

    // ── No drift: the migrated database equals prisma/schema.prisma ──────────
    const driftRun = spawnSync(
      "npx",
      ["prisma", "migrate", "diff", "--from-url", scratchUrl, "--to-schema-datamodel", path.join(ROOT, "prisma", "schema.prisma"), "--exit-code"],
      { cwd: ROOT, encoding: "utf8" },
    );
    check(driftRun.status === 0, "no schema drift: migrated database matches prisma/schema.prisma", `schema drift after migration:\n${driftRun.stdout}${driftRun.stderr}`);

    const history = await db.$queryRawUnsafe<{ migration_name: string; finished_at: Date | null }[]>(`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name`);
    check(history.length === all.length && history.every((h) => h.finished_at), `_prisma_migrations lists all ${all.length} migrations as finished`, `migration history incomplete: ${JSON.stringify(history)}`);

    // Re-running deploy must be a no-op.
    const again = prisma(["migrate", "deploy"], scratchUrl, path.join(ROOT, "prisma", "schema.prisma"));
    check(again.code === 0 && /No pending migrations/i.test(again.out), "a second migrate deploy is a no-op", `second deploy not clean:\n${again.out}`);
  } finally {
    if (db) await db.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`).catch(() => undefined);
    await admin.$disconnect();
    rmSync(tmp, { recursive: true, force: true });
    console.log(results.join("\n"));
    const failures = results.filter((l) => l.startsWith("❌")).length;
    console.log(`\n${results.length - failures}/${results.length} migration checks passed`);
    if (failures > 0) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
