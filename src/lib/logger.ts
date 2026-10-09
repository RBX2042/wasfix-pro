type LogLevel = "info" | "warn" | "error";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function format(level: LogLevel, msg: string, data?: unknown) {
  const ts = new Date().toISOString();
  const prefix = `[WasFix ${ts}] [${level.toUpperCase()}]`;
  if (data !== undefined) {
    return [prefix, msg, data];
  }
  return [prefix, msg];
}

// An Error survives JSON.stringify as "{}" — the message and stack are
// non-enumerable. Without this every production error line would be a level and
// a message with no cause attached.
function serialize(data: unknown): unknown {
  if (data instanceof Error) {
    return { name: data.name, message: data.message, stack: data.stack };
  }
  return data;
}

/**
 * Production emits one JSON object per line. The platform log is the only sink
 * we have (no @sentry package is installed, and sentry.client.config.ts is
 * browser-only), so the line itself has to be the machine-readable record: any
 * collector pointed at stdout can ingest it as-is, without a parser written for
 * our prefix format.
 */
function line(level: LogLevel, msg: string, data?: unknown): string {
  const ts = new Date().toISOString();
  const entry = {
    ts,
    level,
    service: "wasfix",
    msg,
    ...(data !== undefined ? { data: serialize(data) } : {}),
  };
  try {
    return JSON.stringify(entry);
  } catch {
    // Circular or otherwise non-serialisable payload: never lose the audit
    // line over the shape of its data.
    return JSON.stringify({ ts, level, service: "wasfix", msg, data: String(data) });
  }
}

/**
 * Where logger.error lines are ALSO sent, installed once at boot by
 * src/instrumentation.ts (it forwards to the owner channels in src/lib/notify.ts
 * with a per-signature cool-down). Kept on globalThis under a registered Symbol
 * because Next bundles the instrumentation entry separately from the route
 * handlers: a module-level variable would be a different variable in each.
 * The sink must never throw into the caller; this file guards it anyway.
 */
const SINK_KEY = Symbol.for("wasfix.logger.errorSink");
export type ErrorSink = (msg: string, data?: unknown) => void;

export function setErrorSink(sink: ErrorSink | null): void {
  (globalThis as Record<symbol, unknown>)[SINK_KEY] = sink;
}

function forwardToSink(msg: string, data?: unknown): void {
  const sink = (globalThis as Record<symbol, unknown>)[SINK_KEY] as ErrorSink | null | undefined;
  if (!sink) return;
  try {
    sink(msg, data);
  } catch {
    // Reporting a problem must never create another one.
  }
}

export const logger = {
  // info carries the audit trail — invoices issued, orders marked paid, RMA
  // requests, GDPR erasures and exports. Silencing it in production emptied the
  // record exactly where a customer dispute or a regulator needs it, so it is
  // emitted there too, as structured JSON.
  info: (msg: string, data?: unknown) => {
    if (IS_PRODUCTION) {
      console.log(line("info", msg, data));
    } else {
      console.log(...format("info", msg, data));
    }
  },
  warn: (msg: string, data?: unknown) => {
    if (IS_PRODUCTION) {
      console.warn(line("warn", msg, data));
    } else {
      console.warn(...format("warn", msg, data));
    }
  },
  // `report: false` writes the line without handing it to the sink; for callers
  // that report the failure themselves (src/instrumentation.ts onRequestError)
  // and would otherwise tell the owner twice.
  error: (msg: string, data?: unknown, opts?: { report?: boolean }) => {
    if (IS_PRODUCTION) {
      console.error(line("error", msg, data));
    } else {
      console.error(...format("error", msg, data));
    }
    // The platform log stays the record. The sink (if installed) additionally
    // tells the owner, so a failure is not only a line nobody reads.
    if (opts?.report !== false) forwardToSink(msg, data);
  },
};

export default logger;
