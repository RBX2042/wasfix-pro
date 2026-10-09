import { env } from "@/lib/env";
import { centsSafe } from "@/lib/emails/money";

/** Stripe dashboard link for a payment; test-mode keys get the /test path. Informational only. */
export function stripeDashboardUrl(paymentIntentId: string | null | undefined): string | null {
  if (!paymentIntentId || !/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)) return null;
  const key = env.STRIPE_SECRET_KEY ?? "";
  const test = key.startsWith("sk_test_") || key.startsWith("rk_test_");
  return `https://dashboard.stripe.com/${test ? "test/" : ""}payments/${paymentIntentId}`;
}

export type ShippingAddress = {
  name: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  raw: Record<string, unknown>;
};

/**
 * Order.shippingAddress is a JSON string written by checkout ({name, street,
 * postalCode, city, country, ...}). Older or odd rows may not parse or may use
 * other key names, so every field is read defensively and nothing throws.
 */
export function parseShippingAddress(json: string): ShippingAddress {
  let raw: Record<string, unknown> = {};
  try {
    const v = JSON.parse(json);
    if (v && typeof v === "object") raw = v as Record<string, unknown>;
  } catch {
    /* keep empty */
  }
  const s = (...keys: string[]) => {
    for (const k of keys) {
      const v = raw[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  const street = [s("street", "address", "line1"), s("houseNumber", "number"), s("addition")].filter(Boolean).join(" ");
  return { name: s("name", "fullName"), street, postalCode: s("postalCode", "zip", "postcode"), city: s("city"), country: s("country") || "Nederland", raw };
}

export const EUR = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
// centsSafe: an empty VAT quarter printed "€ -0,00" (negated zero) on the economics page.
export const eur = (n: number) => EUR.format(centsSafe(n));
export const dateNl = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Amsterdam" }).format(d) : "-";
export const dateTimeNl = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }).format(d) : "-";
