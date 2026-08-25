// Week-view helpers for /monteur/planning. Deliberately dependency-free
// (no date-fns/dayjs in package.json) — this app only needs Monday-start
// week bucketing in the server's local time, matching the rest of the
// dashboard which already renders dates via toLocaleString("nl-NL").

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Monday 00:00 of the week containing `anchor`. */
export function startOfWeek(anchor: Date): Date {
  const d = startOfDay(anchor);
  const day = d.getDay(); // 0 = Sunday ... 6 = Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return addDays(d, diffToMonday);
}

export function weekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function isSameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/** Parses a `?week=YYYY-MM-DD` search param, falling back to today. */
export function parseWeekParam(value: string | undefined): Date {
  if (value) {
    const parsed = new Date(`${value}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

export function toWeekParam(date: Date): string {
  return startOfDay(date).toISOString().slice(0, 10);
}

const WEEKDAY_LABELS_NL = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];

export function weekdayLabelNl(date: Date): string {
  const day = date.getDay();
  return WEEKDAY_LABELS_NL[day === 0 ? 6 : day - 1];
}
