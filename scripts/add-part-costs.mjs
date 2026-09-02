/**
 * Adds a costEur (purchase price, ex VAT) to every part in the catalog.
 *
 * These are ESTIMATES so margin reporting has something to work with out of
 * the box — original-brand parts carry a thinner trade margin than universal
 * aftermarket ones, which is how the spare-parts trade actually prices. The
 * owner replaces them with real supplier prices via /admin/onderdelen.
 *
 * Deterministic: same input always yields the same costs, so re-running never
 * churns the diff.
 *
 * Usage: node scripts/add-part-costs.mjs
 */
import { readFileSync, writeFileSync } from "fs";

const FILE = "src/data/parts.json";
const VAT = 0.21;

// Gross margin on the ex-VAT selling price, by part type.
const MARGIN = {
  original: 0.28,   // brand-original parts: tight, the brand takes the value
  universal: 0.45,  // aftermarket/universal: where the money is
};

// A small deterministic wobble so every part is not exactly the same margin.
function wobble(sku) {
  let h = 0;
  for (let i = 0; i < sku.length; i++) h = (h * 31 + sku.charCodeAt(i)) >>> 0;
  return ((h % 11) - 5) / 100; // -0.05 .. +0.05
}

const parts = JSON.parse(readFileSync(FILE, "utf8"));
let changed = 0;

for (const part of parts) {
  if (typeof part.costEur === "number") continue;
  const base = part.isOriginal ? MARGIN.original : MARGIN.universal;
  const margin = Math.min(0.6, Math.max(0.15, base + wobble(part.sku)));
  const exVat = part.priceEur / (1 + VAT);
  part.costEur = Math.round(exVat * (1 - margin) * 100) / 100;
  changed++;
}

writeFileSync(FILE, JSON.stringify(parts, null, 2) + "\n");

const totalRetail = parts.reduce((s, p) => s + p.priceEur / (1 + VAT), 0);
const totalCost = parts.reduce((s, p) => s + (p.costEur ?? 0), 0);
console.log(`${changed} parts given a cost price (${parts.length} total)`);
console.log(`Blended gross margin: ${(((totalRetail - totalCost) / totalRetail) * 100).toFixed(1)}%`);
