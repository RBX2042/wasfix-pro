/** Shared between the monteur server actions and the client forms. */
export const WORK_ORDER_STATUSES = ["OPEN", "GEPLAND", "WACHT_OP_ONDERDEEL", "VOLTOOID", "GEANNULEERD"] as const;

export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export type ActionResult = { ok: boolean; error?: string };
