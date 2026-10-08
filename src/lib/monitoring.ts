/**
 * Turning server errors into owner notifications without flooding anyone.
 *
 * Two entry points feed this (both installed by src/instrumentation.ts):
 *   - onRequestError: an exception that escaped a route, page or action.
 *   - the logger.error sink: failures the code caught, logged and carried on
 *     from (a Stripe call that failed, an invoice that could not be issued).
 * Both end in notifyError() from src/lib/notify.ts, the single module that knows
 * the owner's channels. This file adds what notify.ts does not have: a
 * cool-down per error SIGNATURE and a hard cap on the total, because a failing
 * dependency produces thousands of identical errors and the channel is also the
 * owner's phone.
 *
 * What is sent: the route PATTERN (/bestelling/[id]), the method, the error
 * name and the FIRST LINE of its message, plus Next's digest so the owner can
 * find the full stack in the platform log. Never the query string (an order
 * link carries its access token there), never headers or bodies, and only the
 * first line of the message: a Prisma validation error puts the offending
 * values on the following lines. notify.ts additionally strips e-mail addresses.
 *
 * logger.error is called with an Error, a string or (most often on the money
 * paths) a plain object such as { orderId, code }. An object is rendered as an
 * ALLOW-LIST of scalar fields (ids, codes, counts), never as a whole: the other
 * keys are dropped, so a payload that later gains a customer field does not leak.
 */



import { after } from "next/server";
import { checkAppUrl, type EnvLike } from "./site-url";

export type GateOptions = {
  /** An identical signature is sent at most once per this many ms. */
  cooldownMs?: number;
  /** At most this many alerts in any `windowMs`, whatever their signature. */
  maxPerWindow?: number;
  windowMs?: number;
  now?: () => number;
};

export type Admission = { send: boolean; suppressed: number; reason?: "cooldown" | "cap" };

export class AlertGate {
  private readonly cooldownMs: number;
  private readonly maxPerWindow: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly seen = new Map<string, { lastSent: number; suppressed: number }>();
  private sentAt: number[] = [];

  constructor(opts: GateOptions = {}) {
    this.cooldownMs = opts.cooldownMs ?? 15 * 60_000;
    this.maxPerWindow = opts.maxPerWindow ?? 20;
    this.windowMs = opts.windowMs ?? 60 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  /** Ask whether an alert with this signature may go out now. Counts the ones that may not. */
  admit(signature: string): Admission {
    const t = this.now();
    const entry = this.seen.get(signature);
    if (entry && t - entry.lastSent < this.cooldownMs) {
      entry.suppressed++;
      return { send: false, suppressed: entry.suppressed, reason: "cooldown" };
    }
    this.sentAt = this.sentAt.filter((at) => t - at < this.windowMs);
    if (this.sentAt.length >= this.maxPerWindow) {
      if (entry) entry.suppressed++;
      return { send: false, suppressed: entry?.suppressed ?? 0, reason: "cap" };
    }
    this.sentAt.push(t);
    const suppressed = entry?.suppressed ?? 0;
    this.seen.set(signature, { lastSent: t, suppressed: 0 });
    // Bounded: forget the oldest signatures first.
    if (this.seen.size > 500) this.seen.delete(this.seen.keys().next().value as string);
    return { send: true, suppressed };
  }
}

/** Ids, numbers and tokens differ per request but are the same error. */
export function normaliseForSignature(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "#")
    .replace(/\b[0-9a-f]{16,}\b/g, "#")
    .replace(/\b(c[a-z0-9]{20,}|[a-z0-9_]{24,})\b/g, "#")
    .replace(/\d+/g, "#")
    .slice(0, 160);
}

/** First NON-EMPTY line: real Prisma messages start with "\n", so line 0 is empty. */
export function firstLine(text: string, max = 160): string {
  const line = (text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

type Described = { name: string; line: string; code?: string };

function codeOf(err: unknown): string | undefined {
  if (!err || typeof err !== "object" || !("code" in err)) return undefined;
  const c = (err as { code?: unknown }).code;
  return (typeof c === "string" || typeof c === "number") && String(c).length <= 40 ? String(c) : undefined;
}

function describe(err: unknown): Described {
  if (err instanceof Error) return { name: err.name || "Error", line: firstLine(err.message), code: codeOf(err) };
  if (typeof err === "string") return { name: "Error", line: firstLine(err) };
  return { name: "NonError", line: "", code: codeOf(err) };
}

/**
 * The keys of a logger.error payload that may reach the owner's channel. These
 * are identifiers, codes and counts. Anything else (names, addresses, free text
 * from a customer) is dropped even if a caller adds it later.
 */
export const REPORTABLE_FIELDS = [
  "orderId", "order", "userId", "refund", "stripeRefundId", "dispute", "subscription", "stored", "priceId",
  "type", "id", "code", "reason", "missing", "parts", "attempt", "statusCode", "stage", "template", "plan",
  "tier", "day", "cap", "message", "detail", "amountCents", "dueBy", "route",
] as const;

type Scalar = string | number | boolean;
function scalarText(v: unknown): string | undefined {
  if (typeof v === "string") return firstLine(v, 120) || undefined;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const parts = v.filter((x): x is Scalar => typeof x === "string" || typeof x === "number" || typeof x === "boolean").map((x) => firstLine(String(x), 40));
    const text = parts.slice(0, 8).join(",") + (parts.length > 8 ? `,+${parts.length - 8}` : "");
    return text || undefined;
  }
  return undefined;
}

/** The allow-listed scalar fields of a plain object, as strings. */
export function reportableFields(data: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data || typeof data !== "object" || data instanceof Error || Array.isArray(data)) return out;
  const record = data as Record<string, unknown>;
  for (const key of REPORTABLE_FIELDS) {
    const text = scalarText(record[key]);
    if (text !== undefined) out[key] = text;
  }
  return out;
}

/** An Error nested in a plain payload ({ orderId, err }). */
function nestedError(data: unknown): unknown {
  if (!data || typeof data !== "object" || data instanceof Error) return undefined;
  const r = data as { err?: unknown; error?: unknown };
  return r.err ?? r.error;
}

/** The path without its query string or fragment. */
export function pathOnly(p: string | undefined): string {
  return (p ?? "").split(/[?#]/)[0] ?? "";
}

export type Sender = (err: Error, context: Record<string, string | number | boolean | null | undefined> & { where?: string }) => Promise<unknown>;

export type RequestErrorInfo = { path: string; method: string };
export type RequestErrorContext = { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string };

export class ErrorReporter {
  constructor(
    private readonly gate: AlertGate,
    private readonly send: Sender,
  ) {}

  /** An exception that escaped a route, page or action. Resolves when handed to the sender (or dropped). */
  async requestError(err: unknown, request: RequestErrorInfo, context: RequestErrorContext = {}): Promise<boolean> {
    const { name, line, code } = describe(err);
    const route = context.routePath || pathOnly(request.path);
    // The code is part of the signature: two different database failures on one
    // route (P2002 vs P1001) must not hide behind each other.
    const signature = `request|${request.method}|${route}|${name}|${code ?? ""}|${normaliseForSignature(line)}`;
    const admission = this.gate.admit(signature);
    if (!admission.send) return false;
    const digest = err && typeof err === "object" && "digest" in err ? String((err as { digest?: unknown }).digest) : undefined;
    await this.send(new Error(`${name}: ${line}`), {
      where: `${request.method} ${route}`,
      type: context.routeType,
      code,
      digest,
      herhaald: admission.suppressed > 0 ? `${admission.suppressed} gelijke fouten onderdrukt sinds de vorige melding` : undefined,
    });
    return true;
  }

  /** A failure the code logged with logger.error and carried on from. */
  async loggedError(msg: string, data?: unknown): Promise<boolean> {
    const title = firstLine(msg, 120);
    const nested = nestedError(data);
    const subject = nested !== undefined ? nested : data;
    const { name, line, code: subjectCode } = subject === undefined ? ({ name: "", line: "" } as Described) : describe(subject);
    const fields = reportableFields(data);
    const code = fields.code ?? subjectCode;
    const signature = `log|${normaliseForSignature(title)}|${name}|${code ?? ""}|${normaliseForSignature(line)}`;
    const admission = this.gate.admit(signature);
    if (!admission.send) return false;
    // The message line: the nested error's reason when there is one, otherwise
    // the title carries the meaning and the fields below carry the identifiers.
    const reason = line ? (name && name !== "NonError" ? `${name}: ${line}` : line) : title;
    const { code: _code, ...rest } = fields;
    await this.send(new Error(reason), {
      where: title,
      code,
      ...rest,
      herhaald: admission.suppressed > 0 ? `${admission.suppressed} gelijke meldingen onderdrukt sinds de vorige` : undefined,
    });
    return true;
  }
}

export type StartupProblem = { level: "error" | "warn"; message: string };

/**
 * Configuration that makes a PRODUCTION deployment quietly not work. Checked once
 * per process at boot and written to the log (errors also reach the owner through
 * the logger sink). `npm run preflight` is the thorough version of this; this is
 * the net under it for a deployment nobody preflighted. Pure: takes the environment.
 */
export function startupProblems(env: EnvLike): StartupProblem[] {
  if (env.NODE_ENV !== "production") return [];
  const problems: StartupProblem[] = [];
  const set = (name: string) => Boolean(env[name]?.trim());
  const appUrl = checkAppUrl(env.NEXT_PUBLIC_APP_URL);
  for (const e of appUrl.errors) problems.push({ level: "error", message: `${e}. Zonder dit staan er localhost-adressen in Stripe-terugkeerlinks, e-mails en de sitemap; bestellen is geblokkeerd.` });
  if (!set("DATABASE_URL")) problems.push({ level: "error", message: "DATABASE_URL is niet ingesteld: bestellen is geblokkeerd en niets wordt opgeslagen." });
  if (!(set("CLERK_SECRET_KEY") && set("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"))) problems.push({ level: "error", message: "Clerk-sleutels ontbreken: niemand kan inloggen, dus ook niet in /admin." });
  if (!set("CRON_SECRET")) problems.push({ level: "warn", message: "CRON_SECRET is niet ingesteld: alle geplande taken (verlopen bestellingen, herinneringen, Stripe-afstemming) weigeren te draaien." });
  if (!set("ADMIN_EMAILS")) problems.push({ level: "warn", message: "ADMIN_EMAILS is niet ingesteld: er kan alleen een beheerder komen via 'npx tsx scripts/make-admin.ts <e-mail>'." });
  if (env.DEMO_MODE === "true") problems.push({ level: "warn", message: "DEMO_MODE=true staat in een productie-omgeving. Het heeft daar geen effect (demo-modus bestaat alleen buiten productie), haal het weg om verwarring te voorkomen." });
  return problems;
}

// On globalThis, not in a module variable: in development the module is re-evaluated on every
// reload and a plain variable would let process.on() pile up listeners. The same holds for the
// gates: Next bundles instrumentation.ts and each route separately, so a module-level gate would
// be a different gate in each and "the total cap" would be several caps.
const INSTALLED_KEY = Symbol.for("wasfix.monitoring.installed");
const GATE_KEY = Symbol.for("wasfix.monitoring.gate");
const CLIENT_GATE_KEY = Symbol.for("wasfix.monitoring.clientGate");

function onGlobal<T>(key: symbol, make: () => T): T {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[key]) g[key] = make();
  return g[key] as T;
}

/** The one gate every owner error alert passes (server errors, logged errors, browser errors) in this process. */
export function sharedGate(): AlertGate {
  return onGlobal(GATE_KEY, () => new AlertGate());
}

/**
 * A second, much smaller gate in FRONT of the shared one for alerts triggered by
 * anonymous browsers (src/app/api/client-error/route.ts). Without it a visitor
 * could use up the shared hourly cap with invented error reports and so
 * suppress the real server errors behind them.
 */
export function clientErrorGate(): AlertGate {
  return onGlobal(CLIENT_GATE_KEY, () => new AlertGate({ maxPerWindow: 3 }));
}

type AfterFn = (task: () => Promise<unknown>) => void;

/**
 * The function installed as the logger.error sink. The alert is a network call;
 * on a serverless host the function may be frozen as soon as the response is
 * sent, so inside a request it is registered with after() to be awaited. Outside
 * a request (boot, a timer) after() throws and the call simply runs.
 * `afterFn` is a test seam.
 */
export function makeErrorSink(reporter: ErrorReporter, afterFn: AfterFn = after): (msg: string, data?: unknown) => void {
  return (msg, data) => {
    const work = reporter.loggedError(msg, data).catch(() => undefined);
    try {
      afterFn(() => work);
    } catch {
      // Not in a request scope: `work` is already running.
    }
  };
}

/**
 * Install the process-level hooks. Called once from register() in the Node.js
 * runtime. Idempotent (dev reloads call register again).
 */
export async function initMonitoring(): Promise<void> {
  if ((globalThis as Record<symbol, unknown>)[INSTALLED_KEY]) return;
  (globalThis as Record<symbol, unknown>)[INSTALLED_KEY] = true;
  const { logger, setErrorSink } = await import("./logger");
  const { notifyError } = await import("./notify");
  const reporter = getReporter(notifyError);

  // logger.error must not wait for Slack, so the alert is not awaited by the caller.
  setErrorSink(makeErrorSink(reporter));

  // A rejected promise nobody awaited. Node's default is to crash the process,
  // which on a serverless host drops every request in flight on that instance;
  // log it (which also tells the owner) and keep serving.
  process.on("unhandledRejection", (reason) => {
    logger.error("[process] unhandled promise rejection", reason);
  });
  for (const p of startupProblems(process.env)) {
    if (p.level === "error") logger.error(`[startup] ${p.message}`);
    else logger.warn(`[startup] ${p.message}`);
  }

  process.on("uncaughtExceptionMonitor", (err) => {
    // Monitor only: does not change Node's decision to exit. Best effort before it does.
    logger.error("[process] uncaught exception", err);
  });
}

let sharedReporter: ErrorReporter | null = null;
/** The reporter used by instrumentation. The sender defaults to notifyError. */
export function getReporter(send: Sender): ErrorReporter {
  if (!sharedReporter) sharedReporter = new ErrorReporter(sharedGate(), send);
  return sharedReporter;
}
