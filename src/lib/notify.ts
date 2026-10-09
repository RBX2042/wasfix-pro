/**
 * Owner notifications: the one module that tells the owner something happened.
 *
 * CONTRACT
 *   notifyOwner({event, title, lines?, url?, level?}, overrides?)
 *       -> Promise<NotifyResult>, NEVER throws, never rejects.
 *   notifyError(err, context?)
 *       -> Promise<NotifyResult>, same guarantees; identical errors are sent at
 *          most once a minute per process so a failure loop cannot flood a channel.
 *   hasNotifyChannel()   true when at least one channel can deliver.
 *
 * CHANNELS (all optional, any subset)
 *   SLACK_WEBHOOK_URL     JSON {text}
 *   DISCORD_WEBHOOK_URL   JSON {content}
 *   e-mail                to ORDER_NOTIFY_EMAIL, else COMPANY_EMAIL, through
 *                         Resend; only when RESEND_API_KEY is set AND one of
 *                         the two addresses is actually configured. The
 *                         built-in default address (support@wasfix.nl) is an
 *                         invention, not a channel: counting it hid the fact
 *                         that nobody was being told anything.
 * There is no other webhook variable. When NO channel is configured the first
 * call logs one warning per process (not one per call) and returns
 * {configured: false}: the owner learns from the log, once, that nobody is
 * being told anything.
 *
 * DELIVERY RULES
 *   - Every channel gets a 3 s AbortController timeout and they run in
 *     parallel (Promise.allSettled), so a dead Slack cannot delay Discord or
 *     the caller by more than 3 s.
 *   - A non-2xx answer, a network error and a timeout are all "failed" and are
 *     logged at warn level with a FIXED reason code (invalid_url, timeout_Nms,
 *     http_NNN, network_error), never the text of the underlying error: a fetch
 *     error can echo the whole webhook URL, which is the secret. They never propagate to the caller: a missing
 *     notification must not fail an order.
 *   - Callers inside a request should call it through next/server `after()`
 *     (or `void notifyOwner(...)`) so the response is not held for up to 3 s.
 *
 * NO PII. The channels are shared. A message carries an order number, a total,
 * an item count and an admin link, never a customer's name, address or e-mail.
 * That is the caller's job; as a second line of defence every string has e-mail
 * addresses replaced before it leaves this module, and Slack/Discord control
 * characters are neutralised so customer-controlled text cannot become a link
 * or an @everyone ping.
 *
 * `overrides` exists for tests (a local HTTP server standing in for Slack and
 * Discord); production code never passes it.
 */
import { env } from "./env";
import { logger } from "./logger";
import { getResend, sendRaw, type MailResult, type RawMail } from "./emails/transport";
import { ownerAlertEmail } from "./emails/owner-alert";

export type NotifyLevel = "info" | "warn" | "error";

export type NotifyInput = {
  /** Machine-readable event name, e.g. "order.paid". Shown in the footer. */
  event: string;
  title: string;
  /** Short facts, one per line. No customer details. */
  lines?: string[];
  /** Admin deep link. A path ("/admin/bestellingen") is made absolute. */
  url?: string;
  level?: NotifyLevel;
};

export type NotifyChannel = "slack" | "discord" | "email";

export type NotifyResult = {
  /** False when no channel exists at all. */
  configured: boolean;
  delivered: NotifyChannel[];
  failed: Array<{ channel: NotifyChannel; reason: string }>;
  /** True when notifyError dropped a repeat of a message sent less than a minute ago. */
  throttled?: boolean;
};

export type NotifyOverrides = {
  /** undefined = environment, null = channel off. */
  slackUrl?: string | null;
  discordUrl?: string | null;
  emailTo?: string | null;
  timeoutMs?: number;
  /** Replaces the Resend transport. When set, the e-mail channel counts as configured. */
  sendMail?: (mail: RawMail) => Promise<MailResult>;
};

const DEFAULT_TIMEOUT_MS = 3000;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9-]+(\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
const LEVEL_TAG: Record<NotifyLevel, string> = { info: "", warn: "[LET OP] ", error: "[FOUT] " };

let warnedNoChannel = false;
const recentErrors = new Map<string, number>();

/** For tests only: forget the once-per-process warning and the error throttle. */
export function _resetNotifyStateForTests(): void {
  warnedNoChannel = false;
  recentErrors.clear();
}

function scrub(value: string, max: number): string {
  const clean = value.replace(EMAIL_RE, "[e-mailadres verborgen]").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function absoluteUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  return `${env.APP_URL.replace(/\/+$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}

function resolveChannels(o: NotifyOverrides | undefined) {
  const slackUrl = o && "slackUrl" in o ? o.slackUrl ?? undefined : env.SLACK_WEBHOOK_URL;
  const discordUrl = o && "discordUrl" in o ? o.discordUrl ?? undefined : env.DISCORD_WEBHOOK_URL;
  // null switches the e-mail channel off; undefined falls back to the
  // environment. Only CONFIGURED addresses count (see the module comment).
  const emailTo = o && "emailTo" in o && o.emailTo !== undefined ? o.emailTo ?? undefined : env.ORDER_NOTIFY_EMAIL ?? env.COMPANY_EMAIL;
  const emailEnabled = Boolean(emailTo) && (Boolean(o?.sendMail) || Boolean(getResend()));
  return { slackUrl, discordUrl, emailTo, emailEnabled };
}

export function hasNotifyChannel(): boolean {
  const c = resolveChannels(undefined);
  return Boolean(c.slackUrl || c.discordUrl || c.emailEnabled);
}

/** Reason codes that are safe to log and return: fixed strings, no URL, no address. */
const SAFE_REASON = /^(invalid_url|timeout_\d+ms|http_\d{3}|network_error|mail_failed|no_resend_key|resend_timeout)$/;

/** A webhook URL must parse as http(s). Checked before fetch, whose parse error quotes the whole URL. */
function checkWebhookUrl(url: string): void {
  let ok = false;
  try {
    const u = new URL(url);
    ok = u.protocol === "https:" || u.protocol === "http:";
  } catch {
    ok = false;
  }
  if (!ok) throw new Error("invalid_url");
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<void> {
  checkWebhookUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // Free the socket; the body is irrelevant (Slack answers "ok").
    await res.body?.cancel().catch(() => undefined);
    if (!res.ok) throw new Error(`http_${res.status}`);
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`timeout_${timeoutMs}ms`);
    // Our own http_NNN passes; anything thrown by fetch itself (DNS, refused,
    // TLS, a URL quoted in its message) collapses to one fixed code.
    if (err instanceof Error && /^http_\d{3}$/.test(err.message)) throw err;
    throw new Error("network_error");
  } finally {
    clearTimeout(timer);
  }
}

function slackText(title: string, lines: string[], url: string | undefined, level: NotifyLevel, event: string): string {
  // Slack treats & < > as control characters (<url|label>, <!channel>).
  const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const parts = [`*${LEVEL_TAG[level]}${x(title)}*`, ...lines.map(x)];
  if (url) parts.push(url);
  parts.push(`_${x(event)}_`);
  return parts.join("\n").slice(0, 3000);
}

function discordText(title: string, lines: string[], url: string | undefined, level: NotifyLevel, event: string): string {
  // A zero-width space after "@" stops @everyone / @here / <@id> pings that
  // customer-controlled text could otherwise trigger.
  const x = (s: string) => s.replace(/@/g, "@​").replace(/</g, "​<");
  const parts = [`**${LEVEL_TAG[level]}${x(title)}**`, ...lines.map(x)];
  if (url) parts.push(url);
  parts.push(`-# ${x(event)}`);
  return parts.join("\n").slice(0, 1900);
}

export async function notifyOwner(input: NotifyInput, overrides?: NotifyOverrides): Promise<NotifyResult> {
  const result: NotifyResult = { configured: false, delivered: [], failed: [] };
  try {
    const level: NotifyLevel = input.level ?? "info";
    const title = scrub(input.title, 150);
    const lines = (input.lines ?? []).map((l) => scrub(l, 300)).filter(Boolean).slice(0, 12);
    const url = absoluteUrl(input.url);
    const event = scrub(input.event, 80);
    const timeoutMs = overrides?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ch = resolveChannels(overrides);

    const tasks: Array<{ channel: NotifyChannel; run: () => Promise<void> }> = [];
    if (ch.slackUrl) {
      const u = ch.slackUrl;
      tasks.push({ channel: "slack", run: () => postJson(u, { text: slackText(title, lines, url, level, event) }, timeoutMs) });
    }
    if (ch.discordUrl) {
      const u = ch.discordUrl;
      tasks.push({ channel: "discord", run: () => postJson(u, { content: discordText(title, lines, url, level, event) }, timeoutMs) });
    }
    if (ch.emailEnabled && ch.emailTo) {
      const to = ch.emailTo;
      const send = overrides?.sendMail ?? sendRaw;
      tasks.push({
        channel: "email",
        run: async () => {
          const { subject, html } = ownerAlertEmail({ title, lines, url, level });
          // The Resend transport has its own, longer timeout; the 3 s promise of
          // this module covers every channel, so the mail is raced against it too.
          let timer: ReturnType<typeof setTimeout> | undefined;
          const limit = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timeout_${timeoutMs}ms`)), timeoutMs);
          });
          const sent = await Promise.race([send({ template: "owner-alert", to, subject, html }), limit]).finally(() => clearTimeout(timer));
          if (!sent.ok) throw new Error(sent.error ?? "mail_failed");
        },
      });
    }

    if (tasks.length === 0) {
      if (!warnedNoChannel) {
        warnedNoChannel = true;
        logger.warn(
          "[notify] no owner notification channel is configured (SLACK_WEBHOOK_URL, DISCORD_WEBHOOK_URL, or RESEND_API_KEY together with ORDER_NOTIFY_EMAIL or COMPANY_EMAIL) — the owner is not being told about orders, payments or failures",
        );
      }
      return result;
    }
    result.configured = true;

    const settled = await Promise.allSettled(tasks.map((t) => t.run()));
    settled.forEach((s, i) => {
      const channel = tasks[i].channel;
      if (s.status === "fulfilled") {
        result.delivered.push(channel);
      } else {
        const raw = s.reason instanceof Error ? s.reason.message : String(s.reason);
        // Webhook failures already carry a fixed code. The e-mail channel can
        // carry a Resend message, which may quote an address: scrub that one,
        // and collapse anything that is not a known code for a webhook.
        const reason = channel === "email" ? scrub(raw, 120) : SAFE_REASON.test(raw) ? raw : "network_error";
        result.failed.push({ channel, reason });
        logger.warn("[notify] channel failed", { channel, event, reason });
      }
    });
    return result;
  } catch (err) {
    // Last line of defence: a bug in this module must not break the caller.
    logger.warn("[notify] unexpected failure", err instanceof Error ? err.message : String(err));
    return result;
  }
}

/**
 * Report an error that someone should look at. `context` is shown as key=value
 * lines; pass identifiers (order number), never personal data.
 */
export async function notifyError(
  err: unknown,
  context: Record<string, string | number | boolean | null | undefined> & { where?: string } = {},
  overrides?: NotifyOverrides,
): Promise<NotifyResult> {
  try {
    const message = err instanceof Error ? err.message : String(err);
    const { where, ...rest } = context;
    const title = where ? `Fout in ${where}` : "Onverwachte fout";
    const key = `${title}|${message}`.slice(0, 300);
    const last = recentErrors.get(key);
    const now = Date.now();
    if (last && now - last < 60_000) return { configured: true, delivered: [], failed: [], throttled: true };
    recentErrors.set(key, now);
    if (recentErrors.size > 200) recentErrors.delete(recentErrors.keys().next().value as string);
    const lines = [scrub(message, 300), ...Object.entries(rest).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}=${String(v)}`)];
    return await notifyOwner({ event: "error", title, lines, level: "error" }, overrides);
  } catch {
    return { configured: false, delivered: [], failed: [] };
  }
}
