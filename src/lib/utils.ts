import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatEur(value: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

// A Dutch site shows Dutch dates. Without an explicit timeZone, Intl follows
// the server's zone (UTC in production) or the viewer's browser, so a moment
// between 00:00 and 02:00 in Amsterdam prints as the previous day — which on an
// invoice contradicts the year its number was allocated in.
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

// Re-export from env for convenience; modules that import isDemoMode keep working.
export { isDemoMode } from "./demo-mode";

export function pickArr(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split("|").map((x) => x.trim()).filter(Boolean);
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
