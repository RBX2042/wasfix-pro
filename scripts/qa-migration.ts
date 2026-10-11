/**
 * Proves that the order-domain migrations are safe on a database that already
 * holds data. Two migrations are under test, in the order they ship:
 *
 *   A. 20261008100000_order_domain_credit_notes_stripe_lease (orders, credit
 *      notes, the Stripe webhook lease, cost provenance), and
 *   B. 20261009120000_order_item_restocked_qty (the restock record moves from an
 *      annotation on the credit note's lines to OrderItem.restockedQty, with a
 *      backfill from the old annotation).
 *
 * The script
 *   1. creates a scratch database,
 *   2. brings it to the state BEFORE A (every earlier migration, applied through
 *      a temporary copy of the prisma directory),
 *   3. loads an order with an invoice, a user with a Stripe subscription, a
 *      part, an RMA with a free-text order reference and a webhook event,
 *   4. snapshots every row, applies everything up to but excluding B, and
 *      checks that no pre-existing value changed and that A's backfills are right,
 *   5. loads, against that state, an order with two lines and credit notes in
 *      the OLD format (the "restock" annotation as the code before B wrote it,
 *      plus notes that must contribute nothing: no array, no JSON, odd entries,
 *      negative and out-of-int4-range quantities, quantities that are not
 *      numbers at all and would raise if they were ever cast),
 *   6. snapshots every row again, applies the real migrations directory,
 *   7. checks that no pre-existing value changed (credit notes included: an
 *      issued document is immutable), that restockedQty is backfilled exactly
 *      and capped, and that the resulting schema has no drift from
 *      prisma/schema.prisma,
 *   8. drops the scratch database.
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

/** A: the order-domain migration. Everything before it is "the old state". */
const ORDER_DOMAIN_MIGRATION = "20261008100000_order_domain_credit_notes_stripe_lease";
/** B: the restock column with its backfill. Everything before it (A included) is "the middle state". */
const RESTOCK_MIGRATION = "20261009120000_order_item_restocked_qty";

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

type Snapshot = Record<string, Record<string, Record<string, unknown>>>;

/**
 * Every column of every row that existed in `before` must be byte-identical in
 * `after` (a column that only exists in `after` is not compared: that is a new
 * column), and no table may have gained or lost rows.
 */
function diffSnapshots(before: Snapshot, after: Snapshot): string[] {
  const changed: string[] = [];
  for (const t of Object.keys(before)) {
    for (const [key, pre] of Object.entries(before[t])) {
      const post = after[t]?.[key];
      if (!post) {
        changed.push(`${t}/${key} disappeared`);
        continue;
      }
      for (const [col, val] of Object.entries(pre)) {
        if (JSON.stringify(post[col]) !== JSON.stringify(val)) changed.push(`${t}/${key}.${col}: ${JSON.stringify(val)} -> ${JSON.stringify(post[col])}`);
      }
    }
    if (Object.keys(after[t] ?? {}).length !== Object.keys(before[t]).length) changed.push(`${t}: row count changed`);
  }
  return changed;
}

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is required (only its host and credentials are used)");
  const scratchName = `wasfix_mig_${randomBytes(4).toString("hex")}`;
  const admin = new PrismaClient({ datasourceUrl: urlFor(base, "postgres") });
  const scratchUrl = urlFor(base, scratchName);
  const tmp = mkdtempSync(path.join(tmpdir(), "wasfix-mig-"));
  let db: PrismaClient | null = null;

  /** A temporary prisma directory holding every migration whose name sorts before `upTo`. */
  const partialPrismaDir = (label: string, upTo: string, all: string[]) => {
    const dir = path.join(tmp, label, "prisma");
    mkdirSync(path.join(dir, "migrations"), { recursive: true });
    copyFileSync(path.join(ROOT, "prisma", "schema.prisma"), path.join(dir, "schema.prisma"));
    copyFileSync(path.join(ROOT, "prisma", "migrations", "migration_lock.toml"), path.join(dir, "migrations", "migration_lock.toml"));
    for (const name of all.filter((n) => n < upTo)) {
      cpSync(path.join(ROOT, "prisma", "migrations", name), path.join(dir, "migrations", name), { recursive: true });
    }
    return path.join(dir, "schema.prisma");
  };

  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${scratchName}"`);

    const all = readdirSync(path.join(ROOT, "prisma", "migrations")).filter((n) => n !== "migration_lock.toml");
    check(all.includes(ORDER_DOMAIN_MIGRATION), `migration ${ORDER_DOMAIN_MIGRATION} exists`, `migration ${ORDER_DOMAIN_MIGRATION} is missing`);
    check(all.includes(RESTOCK_MIGRATION), `migration ${RESTOCK_MIGRATION} exists`, `migration ${RESTOCK_MIGRATION} is missing`);

    // The old state: every migration before A.
    const old = prisma(["migrate", "deploy"], scratchUrl, partialPrismaDir("old", ORDER_DOMAIN_MIGRATION, all));
    check(old.code === 0, "scratch database brought to the pre-migration state (before A)", `could not build the old state:\n${old.out}`);
    if (old.code !== 0) return;

    db = new PrismaClient({ datasourceUrl: scratchUrl });
    const has = async (table: string, column: string) =>
      ((await db!.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
        table,
        column,
      ))[0].n) > 0n;
    check(!(await has("Order", "accessToken")), "before A: Order.accessToken does not exist yet", "before A: the old state already has the new columns");

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
    const snapshot = async (tables: string[]) => {
      const out: Snapshot = {};
      for (const t of tables) {
        const rows = await db!.$queryRawUnsafe<{ j: Record<string, unknown> }[]>(`SELECT to_jsonb(t) AS j FROM "${t}" t`);
        out[t] = Object.fromEntries(rows.map((r) => [String(r.j.id ?? r.j.year), r.j]));
      }
      return out;
    };
    const before = await snapshot(TABLES);

    // ── Apply A (and anything else before B) ─────────────────────────────────
    const middle = prisma(["migrate", "deploy"], scratchUrl, partialPrismaDir("middle", RESTOCK_MIGRATION, all));
    check(middle.code === 0, "migrate deploy applied the order-domain migration (A) and stopped before the restock migration (B)", `migrate deploy up to A failed:\n${middle.out}`);
    if (middle.code !== 0) return;
    check(await has("Order", "accessToken"), "after A: Order.accessToken exists", "after A: Order.accessToken is missing");
    check(!(await has("OrderItem", "restockedQty")), "after A, before B: OrderItem.restockedQty does not exist yet", "after A: the middle state already has restockedQty");

    const afterA = await snapshot(TABLES);
    // Nothing that existed may have changed, in any column of any table. That
    // includes RmaRequest.orderId, which holds free text and stays untouched.
    const changedByA = diffSnapshots(before, afterA);
    check(changedByA.length === 0, `A: no pre-existing value changed across ${TABLES.length} tables (${Object.values(before).reduce((n, t) => n + Object.keys(t).length, 0)} rows compared)`, `A: existing data changed: ${changedByA.join("; ")}`);

    // ── Fixtures for B, written against the MIDDLE schema: credit notes in the OLD format ──
    // An order with two lines (part p-1 ordered 2, part p-2 ordered 3) and the notes its refunds left behind as the
    // code before B wrote them: the restock record as a "restock" array on the first printed line. Together the
    // notes claim 6 of p-1 (1 + 5: more than ordered, so the backfill must cap at 2) and 2 of p-2 (exact). The other
    // notes must contribute nothing and abort nothing: a line without the array, a document that is not an array,
    // text that is not JSON, entries of the wrong shape (a string quantity, a numeric partId, a bare number), and
    // numbers the old code could never have written: a negative quantity (-100 of p-1, which would zero the line
    // if it counted) and quantities beyond int4 (1e12 and 2147483648 of p-2: an unguarded ::int cast raises
    // "integer out of range" and aborts the whole migration; counted, they would lift p-2 to its cap of 3). The last
    // note carries quantities that are not JSON numbers and cannot be cast at all ("abc", true, an object, null):
    // Postgres evaluates the conjuncts of a WHERE clause in no documented order, so the backfill keeps its one cast
    // inside a CASE on jsonb_typeof; a cast that is reached raises 'invalid input syntax for type numeric: "abc"'
    // and aborts the migration.
    await db.$executeRawUnsafe(`
      INSERT INTO "Part" (id, sku, name, brand, category, "priceEur", "costEur", stock, "isOriginal", supplier)
      VALUES ('p-2', 'MIG-BELT-02', 'Snaar', 'Bosch', 'BELT', 10, 5, 9, true, NULL)`);
    await db.$executeRawUnsafe(`
      INSERT INTO "Order" (id, "userId", status, "subtotalEur", "totalEur", "vatRate", "vatEur", "shippingAddress", email, "paymentMethod", "paidAt", "shippedAt", "updatedAt", "accessToken", "refundedEur")
      VALUES ('o-restock', 'u-sub', 'SHIPPED', 79, 79, 0.21, 13.71, '{"name":"Sub Scriber"}', 'sub@example.test', 'STRIPE', now(), now(), now(), 'tok-restock-0000000000000000000000000000000000000000000000000000', 20)`);
    await db.$executeRawUnsafe(`
      INSERT INTO "OrderItem" (id, "orderId", "partId", quantity, "unitPrice")
      VALUES ('i-r1', 'o-restock', 'p-1', 2, 24.5), ('i-r2', 'o-restock', 'p-2', 3, 10)`);
    await db.$executeRawUnsafe(`
      INSERT INTO "Invoice" (id, number, year, "orderId", "subtotalEur", "vatRate", "vatEur", "totalEur", "sellerJson", "buyerJson", "linesJson")
      VALUES ('inv-r', '2026-00002', 2026, 'o-restock', 79, 0.21, 13.71, 79, '{"name":"Seller"}', '{"name":"Buyer"}', '[]')`);
    const legacyNote = (id: string, number: string, linesJson: string) =>
      `('${id}', '${number}', 2026, 'inv-r', 'retour', 4.13, 0.21, 0.87, 5, '{"name":"Seller"}', '{"name":"Buyer"}', '${linesJson.replace(/'/g, "''")}')`;
    const oldFormat = (restock: Array<{ partId: string; quantity: number }>, extraLine = false) =>
      JSON.stringify([
        { sku: "", name: "Gedeeltelijke creditering van factuur 2026-00002", quantity: 1, unitPriceEur: 5, lineTotalEur: 5, restock },
        ...(extraLine ? [{ sku: "", name: "Verzendkosten", quantity: 1, unitPriceEur: 0, lineTotalEur: 0 }] : []),
      ]);
    await db.$executeRawUnsafe(`
      INSERT INTO "CreditNote" (id, number, year, "invoiceId", reason, "subtotalEur", "vatRate", "vatEur", "totalEur", "sellerJson", "buyerJson", "linesJson") VALUES
      ${[
        legacyNote("cn-leg-1", "CN-2026-00001", oldFormat([{ partId: "p-1", quantity: 1 }, { partId: "p-2", quantity: 2 }])),
        legacyNote("cn-leg-2", "CN-2026-00002", oldFormat([{ partId: "p-1", quantity: 5 }], true)),
        legacyNote("cn-leg-3", "CN-2026-00003", '{"not":"an array"}'),
        legacyNote("cn-leg-4", "CN-2026-00004", "not json at all"),
        legacyNote("cn-leg-5", "CN-2026-00005", '[null, 3, "x", {"restock": "nope"}, {"restock": [1, {"partId": 7, "quantity": 1}, {"partId": "p-2", "quantity": "2"}]}]'),
        legacyNote("cn-leg-6", "CN-2026-00006", '[{"restock": [{"partId": "p-1", "quantity": -100}, {"partId": "p-2", "quantity": 1e12}, {"partId": "p-2", "quantity": 2147483648}]}]'),
        legacyNote("cn-leg-7", "CN-2026-00007", '[{"restock": [{"partId": "p-1", "quantity": "abc"}, {"partId": "p-1", "quantity": true}, {"partId": "p-2", "quantity": {"n": 1}}, {"partId": "p-2", "quantity": null}]}]'),
      ].join(",\n      ")}`);
    await db.$executeRawUnsafe(`INSERT INTO "CreditNoteSequence" (year, last) VALUES (2026, 7)`);

    const TABLES_B = [...TABLES, "CreditNote", "CreditNoteSequence"];
    const beforeB = await snapshot(TABLES_B);

    // ── Apply the real migrations directory (B and anything after it) ────────
    const applied = prisma(["migrate", "deploy"], scratchUrl, path.join(ROOT, "prisma", "schema.prisma"));
    check(applied.code === 0, "migrate deploy applied the restock migration (B)", `migrate deploy failed:\n${applied.out}`);
    if (applied.code !== 0) return;
    check(await has("OrderItem", "restockedQty"), "after B: OrderItem.restockedQty exists", "after B: OrderItem.restockedQty is missing");

    const after = await snapshot(TABLES_B);
    const changedByB = diffSnapshots(beforeB, after);
    check(changedByB.length === 0, `B: no pre-existing value changed across ${TABLES_B.length} tables (${Object.values(beforeB).reduce((n, t) => n + Object.keys(t).length, 0)} rows compared); the old-format credit notes are byte-identical`, `B: existing data changed: ${changedByB.join("; ")}`);

    // ── Backfills of A ───────────────────────────────────────────────────────
    const tokens = Object.values(after.Order).filter((o) => o.id !== "o-restock").map((o) => o.accessToken as string | null);
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

    // ── Backfill of B: OrderItem.restockedQty from the old-format credit notes ──
    const item = (id: string) => after.OrderItem[id].restockedQty;
    check(item("i-r1") === 2, "restockedQty backfill: p-1 ordered 2, the old notes claim 1 + 5 = 6 (and a negative -100, a string \"abc\" and a boolean that are skipped), the column is CAPPED at 2", `restockedQty of i-r1 is ${item("i-r1")} (expected 2, capped; a negative entry must be skipped, not subtracted)`);
    check(item("i-r2") === 2, "restockedQty backfill: p-2 ordered 3, the old notes claim exactly 2 (the string quantities, the odd entries, an object and a null quantity and the out-of-int4 quantities 1e12 and 2147483648 count for nothing), the column is 2", `restockedQty of i-r2 is ${item("i-r2")} (expected 2; an out-of-range quantity must be skipped, not counted)`);
    check(item("i-1") === 0 && item("i-2") === 0 && item("i-3") === 0, "restockedQty backfill: lines of orders without credit notes stay 0 (the annotation of another order's notes never leaks)", `restockedQty of untouched lines: ${[item("i-1"), item("i-2"), item("i-3")]}`);
    check(
      Object.values(after.CreditNote).every((cn) => cn.linesJson === beforeB.CreditNote[String(cn.id)].linesJson) && /"restock"/.test(String(after.CreditNote["cn-leg-1"].linesJson)),
      "the old-format credit notes keep their annotation, byte for byte (an issued document is immutable; the export strips it on the way out)",
      "a credit note's linesJson was rewritten by the migration",
    );

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
      `INSERT INTO "CreditNote" (id, number, year, "invoiceId", reason, "subtotalEur", "vatRate", "vatEur", "totalEur", "sellerJson", "buyerJson", "linesJson") VALUES ('cn-1', 'CN-2026-00008', 2026, 'inv-1', 'test', 25.16, 0.21, 5.29, 30.45, '{}', '{}', '[]')`,
    );
    let restrictHeld = false;
    try {
      await db.$executeRawUnsafe(`DELETE FROM "Invoice" WHERE id = 'inv-1'`);
    } catch {
      restrictHeld = true;
    }
    check(restrictHeld, "an invoice with a credit note cannot be deleted (ON DELETE RESTRICT)", "an invoice with a credit note was deleted");
    // The new column is what the application writes from now on: a plain row insert takes the default.
    await db.$executeRawUnsafe(`INSERT INTO "OrderItem" (id, "orderId", "partId", quantity, "unitPrice") VALUES ('i-new', 'o-restock', 'p-2', 1, 10)`);
    const fresh = await db.$queryRawUnsafe<{ restockedQty: number }[]>(`SELECT "restockedQty" FROM "OrderItem" WHERE id = 'i-new'`);
    check(fresh[0]?.restockedQty === 0, "a line inserted after B gets restockedQty 0 by default", `fresh line restockedQty: ${JSON.stringify(fresh)}`);

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
