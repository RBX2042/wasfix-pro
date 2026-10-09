/**
 * Real counts from the catalog, for anywhere the site states how much it
 * covers.
 *
 * The homepage used to advertise "3.420+ modellen", "2.180 foutcodes",
 * "5.600+ onderdelen" and "1.247 reparatiegidsen" — inflated 40 to 130 times
 * over what the catalog actually holds. Deriving the numbers from the data
 * means a claim can never drift from the product again.
 */

import { machines, parts, errorCodes, guides } from "./static-db";

export type CatalogStats = {
  machines: number;
  brands: number;
  errorCodes: number;
  /**
   * Error codes whose meaning we checked against a public source and recorded
   * the URL for. Always use THIS number, never `errorCodes`, whenever the
   * surrounding copy says "geverifieerd", "gecontroleerd" or similar — the
   * total counts rows, not verification.
   */
  verifiedErrorCodes: number;
  parts: number;
  /**
   * DEPRECATED for anything customer-facing. This counts the stock numbers in
   * src/data/parts.json, which are seed values (2-201), not an inventory, and in
   * production the database starts with stock 0 - so "N onderdelen op voorraad"
   * built from this is a claim nobody checked. Say "N onderdelen in de catalogus"
   * (`parts`) or use liveCatalogStats().partsInStock, which asks the database.
   */
  partsInStock: number;
  guides: number;
};

export function catalogStats(): CatalogStats {
  return {
    machines: machines.length,
    brands: new Set(machines.map((m) => m.brand)).size,
    errorCodes: errorCodes.length,
    verifiedErrorCodes: errorCodes.filter((ec) => ec.provenance === "VERIFIED").length,
    parts: parts.length,
    partsInStock: parts.filter((p) => p.stock > 0).length,
    guides: guides.length,
  };
}

/** "331" — Dutch thousand separators for display. */
export function formatCount(n: number): string {
  return new Intl.NumberFormat("nl-NL").format(n);
}

/**
 * The same counts, but from the live catalogue (database when there is one,
 * otherwise the JSON): parts, guides, error codes and machines as the shop would
 * serve them, and partsInStock as the number of parts with stock above zero.
 */
export async function liveCatalogStats(): Promise<CatalogStats> {
  const base = catalogStats();
  const { dbStats, dbParts } = await import("./static-db");
  const [live, stocked] = await Promise.all([dbStats(), dbParts({ where: { minStock: 0 } })]);
  return {
    ...base,
    machines: live.machinesCount,
    errorCodes: live.errorCodesCount,
    parts: live.partsCount,
    guides: live.guidesCount,
    partsInStock: stocked.length,
  };
}
