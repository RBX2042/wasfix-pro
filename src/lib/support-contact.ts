import { env } from "./env";

/**
 * Where a customer can reach the owner, as the OWNER configured it (COMPANY_EMAIL).
 * null when it is not configured: a built-in address such as support@wasfix.nl
 * is a guess about a mailbox that may not exist, and a customer who mails it
 * gets a bounce at the moment they most need an answer. Server-side only
 * (the value is passed to client components as a prop).
 */
export function supportEmail(): string | null {
  return env.COMPANY_EMAIL?.trim() || null;
}

export { supportHint } from "./support-hint";
