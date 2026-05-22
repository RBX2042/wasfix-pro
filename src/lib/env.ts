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
  return value && value.trim().length > 0 ? value : undefined;
}

const isDemoMode = (process.env.DEMO_MODE ?? "true") === "true";

export const env = {
  DATABASE_URL: read("DATABASE_URL") ?? "file:./dev.db",
  APP_URL: read("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",

  CLERK_SECRET_KEY: read("CLERK_SECRET_KEY"),
  CLERK_PUBLISHABLE_KEY: read("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"),

  GEMINI_API_KEY: read("GEMINI_API_KEY") ?? read("GOOGLE_AI_API_KEY"),
  GEMINI_MODEL: read("GEMINI_MODEL") ?? "gemini-2.0-flash",

  STRIPE_SECRET_KEY: read("STRIPE_SECRET_KEY"),
  STRIPE_WEBHOOK_SECRET: read("STRIPE_WEBHOOK_SECRET"),
  STRIPE_PUBLISHABLE_KEY: read("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"),
  STRIPE_PRICE_PARTICULIER: read("STRIPE_PRICE_PARTICULIER"),
  STRIPE_PRICE_MONTEUR: read("STRIPE_PRICE_MONTEUR"),
  STRIPE_PRICE_BEDRIJF: read("STRIPE_PRICE_BEDRIJF"),

  RESEND_API_KEY: read("RESEND_API_KEY"),
  RESEND_FROM_EMAIL: read("RESEND_FROM_EMAIL") ?? "WasFix Pro <noreply@wasfixpro.nl>",

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
  return Boolean(env.CLERK_SECRET_KEY);
}
