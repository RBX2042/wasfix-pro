-- Order domain, credit notes, Stripe webhook lease, cost provenance.
--
-- ADDITIVE, and safe on a database that already holds orders, invoices, users
-- with a Stripe subscription and parts: no column is dropped or altered, no
-- row is deleted, and every existing value is kept. RmaRequest.orderId in
-- particular stays the free-text NOT NULL column /api/retour writes to; the
-- link to a real order is a new nullable column next to it (see 3).
-- Verified by scripts/qa-migration.ts, which builds a database in the previous
-- migration state, loads an order with an invoice, a user with a Stripe
-- subscription, a part, an RMA and a webhook event, applies this migration and
-- compares every pre-existing row column by column.
--
-- Backfills (each needed before the constraint that follows it):
--   1. Order.accessToken: a random value for EVERY existing order, before the
--      unique index is built. Without it an old order could not be opened by
--      its guest link. 64 hex characters from two random UUIDs; the app uses
--      randomBytes(24) for new rows.
--   2. StripeEvent: existing rows are treated as completed (claimedAt and
--      completedAt = processedAt, attempts = 1). Until now a row only survived
--      when the handler finished, because a failing handler deleted its claim.
--   3. RmaRequest.orderId holds whatever the customer typed and is NOT touched.
--      The new linkedOrderId (a real foreign key) is filled where the typed text
--      is an Order.id, or the short reference shown to customers (first 8
--      characters of the id, case-insensitive, "#" ignored) and that reference
--      matches exactly ONE order. An ambiguous or unknown reference stays NULL.
--   4. Order.cancelledAt for rows already CANCELLED: approximated by updatedAt,
--      which is when the expiry sweep flipped them (nothing else writes
--      CANCELLED today). It is an approximation, not a recorded fact.
-- Part.costSource defaults to ESTIMATE for every existing part: no existing part
-- is known to carry a real supplier quote.

-- 1. Order
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "accessToken" TEXT,
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "customerNote" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "refundedEur" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "stripePaymentIntentId" TEXT,
ADD COLUMN     "trackingCode" TEXT;

-- Backfill BEFORE the unique index below.
UPDATE "Order"
SET "accessToken" = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE "accessToken" IS NULL;

UPDATE "Order"
SET "cancelledAt" = "updatedAt"
WHERE "status" = 'CANCELLED' AND "cancelledAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Order_accessToken_key" ON "Order"("accessToken");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_stripePaymentIntentId_idx" ON "Order"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- 2. Part
-- AlterTable
ALTER TABLE "Part" ADD COLUMN     "costSource" TEXT NOT NULL DEFAULT 'ESTIMATE';

-- 3. RmaRequest
-- AlterTable
ALTER TABLE "RmaRequest" ADD COLUMN     "adminNote" TEXT,
ADD COLUMN     "linkedOrderId" TEXT,
ADD COLUMN     "refundEur" DOUBLE PRECISION,
ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- Match what the customer typed to a real order: the full id, or the short
-- reference, but only when exactly one order carries that short reference.
UPDATE "RmaRequest" r
SET "linkedOrderId" = o."id"
FROM "Order" o
WHERE o."id" = r."orderId";

UPDATE "RmaRequest" r
SET "linkedOrderId" = m."id"
FROM (
  SELECT upper(left("id", 8)) AS ref, min("id") AS id
  FROM "Order"
  GROUP BY upper(left("id", 8))
  HAVING count(*) = 1
) m
WHERE r."linkedOrderId" IS NULL
  AND m.ref = upper(btrim(replace(r."orderId", '#', '')));

-- CreateIndex
CREATE INDEX "RmaRequest_orderId_idx" ON "RmaRequest"("orderId");

-- CreateIndex
CREATE INDEX "RmaRequest_linkedOrderId_idx" ON "RmaRequest"("linkedOrderId");

-- AddForeignKey
ALTER TABLE "RmaRequest" ADD CONSTRAINT "RmaRequest_linkedOrderId_fkey" FOREIGN KEY ("linkedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. StripeEvent: idempotency as a lease
-- AlterTable
ALTER TABLE "StripeEvent" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT;

UPDATE "StripeEvent"
SET "claimedAt" = "processedAt", "completedAt" = "processedAt", "attempts" = 1;

-- CreateIndex
CREATE INDEX "StripeEvent_completedAt_claimedAt_idx" ON "StripeEvent"("completedAt", "claimedAt");

-- 5. User
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "stripeCurrentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "stripeSubStatus" TEXT,
ADD COLUMN     "trialUsedAt" TIMESTAMP(3);

-- 6. Credit notes
-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "subtotalEur" DOUBLE PRECISION NOT NULL,
    "vatRate" DOUBLE PRECISION NOT NULL,
    "vatEur" DOUBLE PRECISION NOT NULL,
    "totalEur" DOUBLE PRECISION NOT NULL,
    "sellerJson" TEXT NOT NULL,
    "buyerJson" TEXT NOT NULL,
    "linesJson" TEXT NOT NULL,
    "stripeRefundId" TEXT,
    "idempotencyKey" TEXT,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNoteSequence" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CreditNoteSequence_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_stripeRefundId_key" ON "CreditNote"("stripeRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_idempotencyKey_key" ON "CreditNote"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE INDEX "CreditNote_year_idx" ON "CreditNote"("year");

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
