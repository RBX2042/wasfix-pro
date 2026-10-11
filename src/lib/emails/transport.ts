/**
 * The one place that talks to Resend.
 *
 * CONTRACT
 *   getResend()      the Resend client, or null without RESEND_API_KEY.
 *   FROM             the From header (RESEND_FROM_EMAIL).
 *   sendRaw(msg)     send one message, return {ok, error?, id?}. NEVER throws.
 *                    Reads the {error} that Resend RETURNS (it does not throw
 *                    for an invalid key or an unverified domain), enforces a
 *                    10 s timeout, and logs without the recipient address.
 *
 * sendRaw does NOT notify the owner when a send fails. That is deliberate: the
 * owner notification has an e-mail channel of its own (src/lib/notify.ts), and
 * if its failure escalated to notifyOwner again the two would loop. Callers
 * that want escalation use sendMail() from src/lib/email.ts.
 */
import { Resend } from "resend";
import { env } from "../env";
import { logger } from "../logger";

export type MailResult = { ok: boolean; error?: string; id?: string };

export type RawMail = {
  /** Short template name, for logs. Never put an address or an order id here. */
  template: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  from?: string;
  /** Extra message headers, forwarded to Resend as given (e.g. List-Unsubscribe / List-Unsubscribe-Post from src/lib/newsletter.ts). */
  headers?: Record<string, string>;
};

const SEND_TIMEOUT_MS = 10_000;

let _resend: Resend | null = null;

export function getResend(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(env.RESEND_API_KEY);
  return _resend;
}

export const FROM = env.RESEND_FROM_EMAIL;

/** Plain-text alternative of an HTML mail: better deliverability, and what a text client shows. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => `${label.replace(/<[^>]+>/g, "").trim()} (${href})`)
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "  ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendRaw(msg: RawMail): Promise<MailResult> {
  const resend = getResend();
  if (!resend) return { ok: false, error: "no_resend_key" };
  try {
    const call = resend.emails.send({
      from: msg.from ?? FROM,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text ?? htmlToText(msg.html),
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
      ...(msg.headers ? { headers: msg.headers } : {}),
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("resend_timeout")), SEND_TIMEOUT_MS);
    });
    const res = await Promise.race([call, timeout]).finally(() => clearTimeout(timer));
    // Resend resolves with {data, error}; an invalid key or an unverified
    // sending domain arrives as `error`, not as an exception.
    if (res.error) {
      const detail = `${res.error.name ?? "error"}: ${res.error.message ?? ""}`.trim();
      logger.error("[email] Resend rejected the message", { template: msg.template, detail });
      return { ok: false, error: detail };
    }
    return { ok: true, id: res.data?.id };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("[email] send threw", { template: msg.template, detail });
    return { ok: false, error: detail };
  }
}
