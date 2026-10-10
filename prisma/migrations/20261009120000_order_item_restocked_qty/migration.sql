-- OrderItem.restockedQty: the restock record as a column.
--
-- ADDITIVE and safe on a populated database: one new NOT NULL column with a
-- constant default (no row is rewritten in meaning), then a backfill that only
-- writes that new column. Nothing is dropped, renamed or retyped, and no credit
-- note is touched: an issued document is immutable. Verified by
-- scripts/qa-migration.ts, which builds a database in the previous migration
-- state, loads credit notes in the old format, applies this migration and
-- compares every pre-existing value column by column.
--
-- WHY. Until now a refund that put returned units back on the shelf recorded
-- WHICH units on the first printed line of its credit note's linesJson, as a
-- "restock" array, and the cap "ordered minus already restocked" was computed
-- by parsing every credit note of the order. That hid stock bookkeeping inside
-- a fiscal document and made the cap depend on JSON parsing. From this
-- migration on the units live on the order line itself and the cap is a
-- conditional update on that column (src/lib/invoicing.ts, applyRestock).
--
-- BACKFILL. For every credit note: parse linesJson, take the "restock" array of
-- each line, sum the quantities per (order of the invoice, part) and write the
-- sum to OrderItem.restockedQty, capped at the line's ordered quantity. Guards,
-- so that a malformed value contributes nothing instead of aborting the
-- migration: a linesJson that is not valid JSON parses to NULL (the pg_temp
-- function below; it vanishes with the session), a document that is not an
-- array contributes nothing, a line that is not an object or has no "restock"
-- array contributes nothing, and an entry is skipped when its partId is not a
-- string or its quantity is not a number between 0 and 2147483647 (the int4
-- range; negative and out-of-range numbers are hand-edited data, the code
-- only ever wrote positive integers up to the ordered quantity). The cast of a
-- quantity to numeric sits inside a CASE on its jsonb_typeof, because Postgres
-- evaluates the conjuncts of a WHERE clause in no documented order: a quantity
-- that is not a JSON number (a string such as "abc", true, an object) is never
-- cast, whatever the planner decides. The sums are taken in numeric and capped
-- at the line's int4 quantity before the one cast to int, so no arithmetic in
-- the backfill can overflow. Should an order carry
-- two lines for one part (the cart merges duplicates, so it does not today),
-- the units are spread over them in id order, each line capped at its own
-- quantity.
--
-- The backfill UPDATE SETS the column (it does not add to it), so that statement
-- is idempotent for a database the new code has not written to yet. The FILE is
-- not re-runnable and must not be: Prisma applies it once, ADD COLUMN is
-- deliberately without IF NOT EXISTS, and once the application writes the
-- column a second backfill would overwrite restocks booked since, which carry
-- no annotation.

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "restockedQty" INTEGER NOT NULL DEFAULT 0;

-- A tolerant cast: text -> jsonb, or NULL when the text is not JSON. Temporary
-- (pg_temp), so nothing is left behind in the schema.
CREATE FUNCTION pg_temp.wasfix_try_jsonb(raw text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN raw::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$$;

-- Backfill from the restock annotation of credit notes issued before this migration.
WITH note_lines AS (
  SELECT inv."orderId", line.value AS line
  FROM "CreditNote" cn
  JOIN "Invoice" inv ON inv."id" = cn."invoiceId"
  CROSS JOIN LATERAL (SELECT pg_temp.wasfix_try_jsonb(cn."linesJson") AS doc) AS parsed
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(parsed.doc) = 'array' THEN parsed.doc ELSE '[]'::jsonb END) AS line(value)
),
units AS (
  -- quantity stays numeric here (a JSON number can exceed int4; the guard below
  -- skips such an entry, and nothing is cast to int before the cap). The one
  -- cast text -> numeric sits INSIDE a CASE on jsonb_typeof (q.quantity below):
  -- Postgres documents no evaluation order for the conjuncts of a WHERE clause,
  -- so a plain conjunct `(... ->> 'quantity')::numeric BETWEEN ...` next to a
  -- typeof test could be evaluated first and raise on a quantity such as "abc".
  -- Inside the CASE the cast runs only for a JSON number, whatever the planner
  -- decides; a quantity that is not a number yields NULL and fails BETWEEN.
  SELECT nl."orderId", entry.value ->> 'partId' AS "partId", floor(q.quantity) AS quantity
  FROM note_lines nl
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(nl.line) = 'object' AND jsonb_typeof(nl.line -> 'restock') = 'array' THEN nl.line -> 'restock' ELSE '[]'::jsonb END
  ) AS entry(value)
  CROSS JOIN LATERAL (
    SELECT CASE WHEN jsonb_typeof(entry.value -> 'quantity') = 'number' THEN (entry.value ->> 'quantity')::numeric END AS quantity
  ) AS q
  WHERE jsonb_typeof(entry.value) = 'object'
    AND jsonb_typeof(entry.value -> 'partId') = 'string'
    AND q.quantity BETWEEN 0 AND 2147483647
),
totals AS (
  SELECT "orderId", "partId", SUM(quantity) AS total
  FROM units
  GROUP BY "orderId", "partId"
),
ranked AS (
  SELECT oi."id", oi."quantity", t.total,
         COALESCE(SUM(oi."quantity") OVER (PARTITION BY oi."orderId", oi."partId" ORDER BY oi."id" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS earlier
  FROM "OrderItem" oi
  JOIN totals t ON t."orderId" = oi."orderId" AND t."partId" = oi."partId"
)
UPDATE "OrderItem" oi
-- LEAST against the int4 quantity bounds the value before the only cast to int.
SET "restockedQty" = GREATEST(0, LEAST(r."quantity", r.total - r.earlier))::int
FROM ranked r
WHERE r."id" = oi."id";
