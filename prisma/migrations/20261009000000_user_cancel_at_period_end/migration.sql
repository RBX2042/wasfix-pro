-- Additive and safe on a populated table: a NOT NULL column with a constant
-- default is written without rewriting existing rows' meaning (all false).
ALTER TABLE "User" ADD COLUMN "stripeCancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
