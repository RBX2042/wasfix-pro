/** Shared between the admin server actions and the client forms. */
/**
 * Every category code the catalogue uses (src/lib/part-categories.ts has the labels). The
 * editor used to offer 15 of the 19 codes in the database: opening a BOARD, HEATER, NTC or
 * SEAL part showed the select on its first option (PUMP), so a price-only edit would have
 * moved the part to Pompen. scripts/qa-admin.ts checks this list against the database.
 */
export const PART_CATEGORIES = [
  "PUMP", "DOOR", "SEAL", "LOCK", "MOTOR", "HEATING", "HEATER", "VALVE", "BEARING", "BELT",
  "FILTER", "ELECTRONICS", "BOARD", "HOSE", "DAMPER", "KNOB", "NTC", "PANEL", "OTHER",
] as const;

export const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;
export const SEVERITIES = ["LOW", "MEDIUM", "HIGH"] as const;

export type ActionResult = { ok: boolean; error?: string };
