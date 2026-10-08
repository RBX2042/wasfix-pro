import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export type StockReason = "ONTVANGEN" | "CORRECTIE";
export const STOCK_REASON_LABEL: Record<StockReason, string> = { ONTVANGEN: "Goederen ontvangen", CORRECTIE: "Correctie (telling)" };

export type StockAdjustResult = { ok: true; sku: string; previous: number; stock: number; delta: number } | { ok: false; error: string };

/**
 * Change a part's stock by a DELTA, in one statement.
 *
 * The old part form sent the stock number it had rendered and saved it back as
 * an absolute value, so a customer's order placed while the owner had the form
 * open was wiped out by the save (the shop then oversells). A delta is applied
 * on the CURRENT value in the database (`stock = stock + delta`), so concurrent
 * orders and concurrent adjustments all count, and the guard `stock + delta >= 0`
 * in the WHERE keeps a correction from driving the stock negative.
 *
 * There is no stock-movement table (the schema is not this bundle's), so the
 * movement is recorded as a structured log line: who, which SKU, delta, before
 * and after, reason. That is an audit trail in the server log, not a ledger.
 */
export async function adjustStock(input: { partId: string; delta: number; reason: StockReason; note?: string; actor: string }): Promise<StockAdjustResult> {
  const { partId, delta } = input;
  if (!Number.isInteger(delta) || delta === 0) return { ok: false, error: "Vul een aantal in dat niet 0 is." };
  if (Math.abs(delta) > 100_000) return { ok: false, error: "Dit aantal is te groot." };
  if (input.reason === "ONTVANGEN" && delta < 0) return { ok: false, error: "Goederen ontvangen kan alleen een positief aantal zijn. Gebruik Correctie om voorraad te verlagen." };

  const part = await prisma.part.findUnique({ where: { id: partId }, select: { sku: true } });
  if (!part) return { ok: false, error: "Onderdeel niet gevonden." };

  const rows = await prisma.$queryRaw<{ stock: number }[]>`
    UPDATE "Part" SET "stock" = "stock" + ${delta}
     WHERE "id" = ${partId} AND "stock" + ${delta} >= 0
 RETURNING "stock"`;
  if (rows.length === 0) return { ok: false, error: "De voorraad kan niet onder 0 komen. Controleer het aantal." };
  const stock = Number(rows[0].stock);
  logger.info("[stock] adjusted", { sku: part.sku, delta, previous: stock - delta, stock, reason: input.reason, note: input.note?.slice(0, 200), by: input.actor });
  return { ok: true, sku: part.sku, previous: stock - delta, stock, delta };
}
