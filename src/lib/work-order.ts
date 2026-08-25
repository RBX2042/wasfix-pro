// Work order status flow, per WASFIX_ROADMAP.md P1.2:
// NEW -> PRE_DIAGNOSIS -> SCHEDULED -> ON_THE_WAY -> IN_PROGRESS ->
// WAITING_FOR_PART -> COMPLETED -> INVOICED -> PAID -> WARRANTY
// CANCELLED is reachable from any non-terminal status.

export const WORK_ORDER_STATUSES = [
  "NEW",
  "PRE_DIAGNOSIS",
  "SCHEDULED",
  "ON_THE_WAY",
  "IN_PROGRESS",
  "WAITING_FOR_PART",
  "COMPLETED",
  "INVOICED",
  "PAID",
  "WARRANTY",
  "CANCELLED",
] as const;

export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  NEW: "Nieuw",
  PRE_DIAGNOSIS: "AI pre-diagnose",
  SCHEDULED: "Ingepland",
  ON_THE_WAY: "Onderweg",
  IN_PROGRESS: "Bezig",
  WAITING_FOR_PART: "Wacht op onderdeel",
  COMPLETED: "Afgerond",
  INVOICED: "Gefactureerd",
  PAID: "Betaald",
  WARRANTY: "Garantie",
  CANCELLED: "Geannuleerd",
};

const TERMINAL_STATUSES: WorkOrderStatus[] = ["WARRANTY", "CANCELLED"];

const FORWARD_FLOW: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  NEW: ["PRE_DIAGNOSIS", "SCHEDULED"],
  PRE_DIAGNOSIS: ["SCHEDULED"],
  SCHEDULED: ["ON_THE_WAY"],
  ON_THE_WAY: ["IN_PROGRESS"],
  IN_PROGRESS: ["WAITING_FOR_PART", "COMPLETED"],
  WAITING_FOR_PART: ["IN_PROGRESS"],
  COMPLETED: ["INVOICED"],
  INVOICED: ["PAID"],
  PAID: ["WARRANTY"],
  WARRANTY: [],
  CANCELLED: [],
};

export function isWorkOrderStatus(value: string): value is WorkOrderStatus {
  return (WORK_ORDER_STATUSES as readonly string[]).includes(value);
}

/** Statuses this work order may move to next, given its current status. */
export function allowedNextStatuses(current: WorkOrderStatus): WorkOrderStatus[] {
  if (TERMINAL_STATUSES.includes(current)) return [];
  const forward = FORWARD_FLOW[current] ?? [];
  return [...forward, "CANCELLED"];
}

export function isValidStatusTransition(from: string, to: string): boolean {
  if (!isWorkOrderStatus(from) || !isWorkOrderStatus(to)) return false;
  return allowedNextStatuses(from).includes(to);
}
