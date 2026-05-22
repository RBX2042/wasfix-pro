type LogLevel = "info" | "warn" | "error";

function format(level: LogLevel, msg: string, data?: unknown) {
  const ts = new Date().toISOString();
  const prefix = `[WasFix ${ts}] [${level.toUpperCase()}]`;
  if (data !== undefined) {
    return [prefix, msg, data];
  }
  return [prefix, msg];
}

export const logger = {
  info: (msg: string, data?: unknown) => {
    if (process.env.NODE_ENV !== "production") {
       
      console.log(...format("info", msg, data));
    }
  },
  warn: (msg: string, data?: unknown) => {
     
    console.warn(...format("warn", msg, data));
  },
  error: (msg: string, data?: unknown) => {
     
    console.error(...format("error", msg, data));
    // In production: hook into Sentry/Datadog/etc here
  },
};

export default logger;
