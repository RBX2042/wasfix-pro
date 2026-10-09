-- Data-only migration. No schema change.
--
-- MonteurInvoice.subtotalEur is the amount excluding btw, and
-- src/lib/monteur-invoicing.ts writes splitVatInclusive().exVatEur into it.
-- An earlier version wrote the gross amount there instead, so rows issued
-- before that fix hold total-inclusive-btw in a column documented as net.
--
-- The read path (deserialize() in src/lib/monteur-invoicing.ts) already
-- derives the net as totalEur - vatEur and never trusts the column, so no
-- invoice has ever *printed* a wrong figure. This aligns the stored data with
-- its meaning, so anything reading the column directly — a report, an export,
-- a query by the accountant — gets the same number the invoice shows.
--
-- The predicate selects exactly the broken rows: for a correct row
-- subtotalEur = totalEur - vatEur, so subtotalEur = totalEur can only hold
-- when vatEur = 0, which "vatEur > 0" excludes. Rows on the
-- kleineondernemersregeling (vatRate 0, vatEur 0) are therefore untouched,
-- and re-running this is a no-op.
UPDATE "MonteurInvoice"
SET "subtotalEur" = ROUND(("totalEur" - "vatEur")::numeric, 2)
WHERE "subtotalEur" = "totalEur" AND "vatEur" > 0;
