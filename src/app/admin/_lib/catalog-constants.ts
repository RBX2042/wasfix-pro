/** Shared between the admin server actions and the client forms. */
export const PART_CATEGORIES = [
  "PUMP", "DOOR", "LOCK", "BEARING", "BELT", "MOTOR", "HEATING", "VALVE",
  "ELECTRONICS", "FILTER", "HOSE", "DAMPER", "KNOB", "PANEL", "OTHER",
] as const;

export const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;
export const SEVERITIES = ["LOW", "MEDIUM", "HIGH"] as const;

export type ActionResult = { ok: boolean; error?: string };
