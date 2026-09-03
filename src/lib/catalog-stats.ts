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
