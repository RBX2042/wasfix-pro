/**
 * The Idempotency-Key of a checkout attempt, remembered in the browser.
 *
 * WHY STORED. The key is what makes "I pressed the button twice" and "the response got lost, I pressed
 * it again" safe: the server answers a repeated key with the order it already made. A key kept only in
 * one component's memory does not protect against the same customer submitting from a second tab, or
 * after a reload, because each of those starts with a new key and therefore places a second order.
 * Keeping it in localStorage lets every tab that is about to submit the SAME order (same cart, same
 * payment method, same typed details: the fingerprint) reuse one key.
 *
 * It is forgotten after 30 minutes, when the confirmation page opens (that order is done, the next
 * attempt is a new order) and whenever the server says the attempt is closed. Client-only; every
 * access is wrapped because storage can be blocked.
 */
const STORAGE_KEY = "wasfix-checkout-attempt";
export const ATTEMPT_TTL_MS = 30 * 60 * 1000;

type Stored = { fingerprint: string; key: string; at: number };

export function newAttemptKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Old browsers without randomUUID: 128 random bits in hex is just as good for this purpose.
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  }
}

export function readSharedAttempt(fingerprint: string, now: number = Date.now()): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<Stored>;
    if (stored.fingerprint !== fingerprint || typeof stored.key !== "string" || typeof stored.at !== "number") return null;
    return now - stored.at < ATTEMPT_TTL_MS ? stored.key : null;
  } catch {
    return null;
  }
}

export function writeSharedAttempt(fingerprint: string, key: string, now: number = Date.now()): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ fingerprint, key, at: now } satisfies Stored));
  } catch {
    /* storage blocked: the in-memory key still protects a double click in this tab */
  }
}

export function clearSharedAttempt(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}
