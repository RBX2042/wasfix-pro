/**
 * Centralized environment variable access.
 *
 * Never throws at import time. Consumers detect missing keys via the
 * is*Configured() helpers and fall back to demo behavior.
 *
 * Use assertEnv(name) only inside functions that can't run without that
 * specific value.
 */

function read(name: string): string | undefined {
  const value = process.env[name];
  // Trimmed: a value pasted into a hosting dashboard often carries a trailing
  // newline or space, which would end up in a URL, an address or a key.
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

// Absent means OFF, matching src/middleware.ts. Defaulting this to ON while
// the middleware defaulted it OFF meant a deployment with Clerk keys but no
// DEMO_MODE var authenticated users through Clerk and then handed every one of
// them the hardcoded superadmin account.
const isDemoMode = process.env.DEMO_MODE === "true";

// A DATABASE_URL is only "real" when it is a Postgres connection string
// without the Supabase placeholder password.
const rawDatabaseUrl = read("DATABASE_URL");
const databaseConfigured =
  !!rawDatabaseUrl &&
  /^postgres(ql)?:\/\//i.test(rawDatabaseUrl) &&
  !/\[YOUR-PASSWORD\]|<your-password-here>|\[password\]/i.test(rawDatabaseUrl);

export const env = {
  DATABASE_URL: rawDatabaseUrl,
  APP_URL: read("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",

  CLERK_SECRET_KEY: read("CLERK_SECRET_KEY"),
  CLERK_PUBLISHABLE_KEY: read("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"),
  CLERK_WEBHOOK_SECRET: read("CLERK_WEBHOOK_SECRET") ?? read("CLERK_WEBHOOK_SIGNING_SECRET"),

  GEMINI_API_KEY: read("GEMINI_API_KEY") ?? read("GOOGLE_AI_API_KEY"),
  GEMINI_MODEL: read("GEMINI_MODEL") ?? "gemini-2.0-flash",

  STRIPE_SECRET_KEY: read("STRIPE_SECRET_KEY"),
  STRIPE_WEBHOOK_SECRET: read("STRIPE_WEBHOOK_SECRET"),
  STRIPE_PUBLISHABLE_KEY: read("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"),
  STRIPE_PRICE_PARTICULIER: read("STRIPE_PRICE_PARTICULIER"),
  STRIPE_PRICE_MONTEUR: read("STRIPE_PRICE_MONTEUR"),
  STRIPE_PRICE_BEDRIJF: read("STRIPE_PRICE_BEDRIJF"),

  RESEND_API_KEY: read("RESEND_API_KEY"),
  RESEND_FROM_EMAIL: read("RESEND_FROM_EMAIL") ?? "WasFix Pro <noreply@wasfix.nl>",
  RESEND_AUDIENCE_ID: read("RESEND_AUDIENCE_ID"),

  UPSTASH_REDIS_REST_URL: read("UPSTASH_REDIS_REST_URL"),
  UPSTASH_REDIS_REST_TOKEN: read("UPSTASH_REDIS_REST_TOKEN"),

  // ── Owner operations ──────────────────────────────────────────────
  // Comma-separated e-mail addresses that may become ADMIN. DECLARED HERE ONLY:
  // this bundle does not read it. The rule the sign-in code must apply (decision
  // D7) is that only an address Clerk reports as VERIFIED may be promoted or
  // claim an existing row. Until that code exists, nothing consumes the variable.
  ADMIN_EMAILS: read("ADMIN_EMAILS"),
  // Owner notifications (src/lib/notify.ts). Any subset may be set. Messages
  // carry order number, total, item count and an admin link, never customer
  // details, because these channels are shared.
  SLACK_WEBHOOK_URL: read("SLACK_WEBHOOK_URL"),
  DISCORD_WEBHOOK_URL: read("DISCORD_WEBHOOK_URL"),
  // Where the owner e-mail goes; falls back to COMPANY_EMAIL.
  ORDER_NOTIFY_EMAIL: read("ORDER_NOTIFY_EMAIL"),
  // Bearer secret for scheduled routes (/api/cron/*).
  CRON_SECRET: read("CRON_SECRET"),
  // Direct (non-pooled) Postgres connection for migrations. Deliberately not
  // referenced by prisma/schema.prisma: with `directUrl = env("DIRECT_URL")`
  // `prisma validate` fails whenever DIRECT_URL is unset (checked), so every
  // environment without it would break.
  DIRECT_URL: read("DIRECT_URL"),

  // Company / fiscal identity printed on invoices and legal pages.
  // Fallbacks for development live in src/lib/plans.ts; companyReadiness()
  // (same file) decides from these raw values whether the company may invoice.
  COMPANY_NAME: read("COMPANY_NAME"),
  COMPANY_STREET: read("COMPANY_STREET"),
  COMPANY_POSTAL_CODE: read("COMPANY_POSTAL_CODE"),
  COMPANY_CITY: read("COMPANY_CITY"),
  COMPANY_KVK: read("COMPANY_KVK"),
  COMPANY_VAT: read("COMPANY_VAT"),
  COMPANY_IBAN: read("COMPANY_IBAN"),
  COMPANY_EMAIL: read("COMPANY_EMAIL"),
  COMPANY_PHONE: read("COMPANY_PHONE"),

  DEMO_MODE: isDemoMode,
  IS_PRODUCTION: process.env.NODE_ENV === "production",
} as const;

export function assertEnv(name: keyof typeof env): string {
  const value = env[name];
  if (!value || (typeof value === "string" && value.length === 0)) {
    throw new Error(`Missing required environment variable: ${String(name)}`);
  }
  return String(value);
}

/** True when a usable Postgres DATABASE_URL is present. */
export function isDatabaseConfigured(): boolean {
  return databaseConfigured;
}

export function isGeminiConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

export function isResendConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

export function isClerkConfigured(): boolean {
  return Boolean(env.CLERK_SECRET_KEY && env.CLERK_PUBLISHABLE_KEY);
}

export function isUpstashConfigured(): boolean {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}
