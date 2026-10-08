/**
 * Part categories as the shopper sees them.
 *
 * The catalogue holds 18 category codes, but the shop sidebar used to list a
 * hand-written 10 of them. Eight categories (33 parts, including every
 * mainboard at EUR 145-295) had no link anywhere, so the highest-ticket items
 * could only be found by typing an exact name. The sidebar is now generated
 * from the categories that actually exist, using the labels below; a category
 * that is not in this table still gets a link (its raw code as the label), so
 * a part can never become unreachable because someone forgot to add a label.
 *
 * Client-safe on purpose: no data imports, no server-only modules.
 */

export type CategoryInfo = {
  /** Singular-ish label for badges ("Pomp"). */
  label: string;
  /** Plural label for the sidebar ("Pompen"). */
  plural: string;
  /** Other category codes that belong in the same sidebar entry. */
  alsoIncludes?: string[];
};

export const PART_CATEGORY_INFO: Record<string, CategoryInfo> = {
  PUMP: { label: "Pomp", plural: "Pompen" },
  DOOR: { label: "Deur", plural: "Deuren & pakkingen" },
  SEAL: { label: "Pakking", plural: "Pakkingen" },
  LOCK: { label: "Deurslot", plural: "Deursloten" },
  MOTOR: { label: "Motor", plural: "Motoren" },
  // HEATER and HEATING are two codes for the same thing in the catalogue; one
  // sidebar entry covers both so a shopper does not have to guess which.
  HEATING: { label: "Verwarming", plural: "Verwarming", alsoIncludes: ["HEATER"] },
  HEATER: { label: "Verwarmingselement", plural: "Verwarmingselementen" },
  VALVE: { label: "Ventiel", plural: "Ventielen" },
  BEARING: { label: "Lager", plural: "Lagers" },
  BELT: { label: "Snaar", plural: "Snaren" },
  FILTER: { label: "Filter", plural: "Filters" },
  ELECTRONICS: { label: "Elektronica", plural: "Elektronica" },
  BOARD: { label: "Moederbord", plural: "Moederborden" },
  HOSE: { label: "Slang", plural: "Slangen" },
  DAMPER: { label: "Schokdemper", plural: "Schokdempers" },
  KNOB: { label: "Knop", plural: "Knoppen" },
  NTC: { label: "Temperatuursensor", plural: "Temperatuursensoren" },
  PANEL: { label: "Bedieningspaneel", plural: "Bedieningspanelen" },
  OTHER: { label: "Overig", plural: "Overig" },
};

/** "PUMP" -> "Pomp". Unknown codes are shown as written rather than hidden. */
export function categoryLabel(category: string): string {
  return PART_CATEGORY_INFO[category]?.label ?? category;
}

export function categoryPlural(category: string): string {
  return PART_CATEGORY_INFO[category]?.plural ?? category;
}

/** Every category code a sidebar entry stands for (the entry itself first). */
export function categoryGroup(category: string): string[] {
  return [category, ...(PART_CATEGORY_INFO[category]?.alsoIncludes ?? [])];
}

/** Codes that are folded into another entry and get no sidebar line of their own. */
export const FOLDED_CATEGORIES: ReadonlySet<string> = new Set(
  Object.values(PART_CATEGORY_INFO).flatMap((i) => i.alsoIncludes ?? []),
);

/**
 * How much of this part's stock to admit to. The seeded stock numbers (2-201)
 * are not an inventory, and even a real number should not be promised as an
 * exact count to the shopper, so the page says in stock / few left / sold out.
 */
export type Availability = "in_stock" | "low" | "out";

export const LOW_STOCK_THRESHOLD = 5;

export function availabilityOf(stock: number): Availability {
  if (stock <= 0) return "out";
  return stock <= LOW_STOCK_THRESHOLD ? "low" : "in_stock";
}
