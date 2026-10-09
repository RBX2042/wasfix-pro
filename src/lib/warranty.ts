/**
 * Warranty periods, in one place.
 *
 * /garantie states four periods in a table and the product page used to print
 * "2 jaar garantie" on every part - wrong for the 49 of 96 parts that are
 * universal (12 months) and for filters and seals (6 months). The page now asks
 * warrantyFor(); /garantie renders its table from WARRANTY_ROWS. Change a period
 * here and both follow.
 *
 * Which row applies when a part falls into several (a universal board is both
 * "universeel" and "elektronica")? The page promises the SHORTEST applicable
 * period, so it can never promise more than the terms grant. Whether that
 * precedence is what the owner means to offer is a question for the owner's
 * lawyer: it is listed in the S7 report under ownerActions.
 */

export type WarrantyRow = { key: "original" | "universal" | "consumable" | "electronics"; label: string; months: number; coverage: string };

export const WARRANTY_ROWS: WarrantyRow[] = [
  { key: "original", label: "Origineel onderdeel", months: 24, coverage: "Materiaal + fabricage" },
  { key: "universal", label: "Universeel/compatibel", months: 12, coverage: "Materiaal + fabricage" },
  { key: "consumable", label: "Verbruiksartikel (filter, dichting)", months: 6, coverage: "Materiaal" },
  { key: "electronics", label: "Elektronica (PCB, display)", months: 24, coverage: "Materiaal + fabricage" },
];

const CONSUMABLE_CATEGORIES = new Set(["FILTER", "SEAL"]);
const ELECTRONICS_CATEGORIES = new Set(["BOARD", "PANEL", "ELECTRONICS"]);

export function warrantyFor(part: { isOriginal: boolean; category: string; name: string }): { months: number; row: WarrantyRow["key"] } {
  const byKey = (k: WarrantyRow["key"]) => WARRANTY_ROWS.find((r) => r.key === k)!;
  const applicable: WarrantyRow[] = [byKey(part.isOriginal ? "original" : "universal")];
  if (CONSUMABLE_CATEGORIES.has(part.category) || /pakking|dichting|manchet/i.test(part.name)) applicable.push(byKey("consumable"));
  if (ELECTRONICS_CATEGORIES.has(part.category)) applicable.push(byKey("electronics"));
  const shortest = applicable.reduce((a, b) => (b.months < a.months ? b : a));
  return { months: shortest.months, row: shortest.key };
}

export function formatWarranty(months: number): string {
  return months % 12 === 0 ? `${months / 12} jaar` : `${months} maanden`;
}
