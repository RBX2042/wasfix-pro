/**
 * Link lists for the site footer. Plain data, no imports, so the client footer
 * stays small and scripts/qa-storefront.ts can check every entry against the
 * catalogue: a code that is pruned from the catalogue used to leave a 404 in the
 * footer of ~105 pages (Miele F101), and nothing noticed.
 *
 * The brand and comparison lists double as the internal links that stop the
 * programmatic pages from being orphans: before this, the 15 brand-repair pages,
 * the 3 /vs pages and two tools were in the sitemap but linked from nowhere.
 */

export const FOOTER_CODES: Array<{ brand: string; codes: string[] }> = [
  { brand: "Bosch", codes: ["E18", "E17", "F21", "F23", "F43", "F63"] },
  { brand: "Miele", codes: ["F11", "F19", "F36", "F53"] },
  { brand: "Samsung", codes: ["OE", "dC", "HE", "5E", "4E"] },
  { brand: "LG", codes: ["UE", "DE", "HE", "OE", "LE"] },
  { brand: "AEG", codes: ["E20", "E40", "E61", "EHO"] },
];

export const FOOTER_PARTS: Array<{ sku: string; label: string }> = [
  { sku: "WF-PUMP-04", label: "Samsung afvoerpomp" },
  { sku: "WF-FILTER-09", label: "Pluizenfilter" },
  { sku: "WF-HEAT-03", label: "Verwarmingselement 1800W" },
  { sku: "WF-BEAR-03", label: "Trommellager 6205" },
  { sku: "WF-BELT-06", label: "V-snaar 1196 J5" },
  { sku: "WF-LOCK-09", label: "Deurslot Bosch ZV-446" },
  { sku: "WF-NTC-15", label: "NTC sensor Bosch" },
  { sku: "WF-DOOR-04", label: "Deurpakking Bosch S6" },
  { sku: "WF-DAMP-16", label: "Schokdempers Bosch" },
  { sku: "WF-VALVE-08", label: "Magneetventiel" },
];

/** slug -> label; the page is /{slug}-wasmachine-reparatie. Mirrors src/data/brands.json (checked by qa-storefront). */
export const FOOTER_BRAND_REPAIR: Array<{ slug: string; label: string }> = [
  { slug: "bosch", label: "Bosch" },
  { slug: "siemens", label: "Siemens" },
  { slug: "miele", label: "Miele" },
  { slug: "samsung", label: "Samsung" },
  { slug: "lg", label: "LG" },
  { slug: "aeg", label: "AEG" },
  { slug: "electrolux", label: "Electrolux" },
  { slug: "whirlpool", label: "Whirlpool" },
  { slug: "indesit", label: "Indesit" },
  { slug: "beko", label: "Beko" },
  { slug: "zanussi", label: "Zanussi" },
  { slug: "hotpoint", label: "Hotpoint" },
  { slug: "candy", label: "Candy" },
  { slug: "haier", label: "Haier" },
  { slug: "panasonic", label: "Panasonic" },
];

/** Mirrors src/data/comparisons.json (checked by qa-storefront). */
export const FOOTER_COMPARE: Array<{ slug: string; label: string }> = [
  { slug: "coolblue", label: "WasFix of Coolblue" },
  { slug: "repaircafe", label: "WasFix of Repair Café" },
  { slug: "monteur", label: "WasFix of een monteur" },
];

export const FOOTER_TOOLS: Array<{ href: string; label: string }> = [
  { href: "/tools/repareren-of-vervangen", label: "Repareren of vervangen?" },
  { href: "/tools/garantie-check", label: "Garantie-check" },
  { href: "/tools/predictive", label: "Onderhoudsvoorspelling" },
  { href: "/tools/qr-sticker", label: "QR-sticker voor je machine" },
];
