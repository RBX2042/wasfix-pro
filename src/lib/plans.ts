/**
 * Single source of truth for everything commercial: plan definitions, prices,
 * VAT and the company's fiscal identity.
 *
 * Prices were previously hardcoded in four places that disagreed with each
 * other (Bedrijf was €199 on /prijzen and €99 in the docs; Monteur Pro was
 * "ex BTW" on the homepage while the other tiers were not). Every surface —
 * pricing page, homepage, upgrade page, Stripe checkout and the plan limits
 * used for entitlements — now reads from here.
 *
 * All amounts are integer cents to avoid float drift in money math.
 */

import { env } from "./env";

export type PlanId = "FREE" | "PARTICULIER" | "MONTEUR_PRO" | "BEDRIJF";

/** Dutch standard VAT rate. Consumer prices on the site include this. */
export const VAT_RATE = 0.21;

/**
 * Company and fiscal identity, printed on invoices and legal pages.
 * These are placeholders until the company is registered — see BLOCKED.md.
 * Overridable via env so production doesn't need a code change.
 */
export const COMPANY = {
  name: env.COMPANY_NAME ?? "WasFix Pro B.V.",
  street: env.COMPANY_STREET ?? "Hoofdstraat 1",
  postalCode: env.COMPANY_POSTAL_CODE ?? "1234 AB",
  city: env.COMPANY_CITY ?? "Amsterdam",
  country: "Nederland",
  kvk: env.COMPANY_KVK ?? "12345678",
  vatNumber: env.COMPANY_VAT ?? "NL123456789B01",
  iban: env.COMPANY_IBAN ?? "NL00ABCD0123456789",
  email: env.COMPANY_EMAIL ?? "support@wasfix.nl",
  phone: env.COMPANY_PHONE ?? "085 - 123 45 67",
  /** True once real registration details are configured. */
  get isPlaceholder() {
    return this.kvk === "12345678";
  },
} as const;

/**
 * The stand-in values above. Public pages must not print these as if they were
 * real registration details — a visitor reading "KvK 12345678" is being told
 * something false — so they render `null` until the real value is configured.
 */
const COMPANY_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "Hoofdstraat 1",
  "1234 AB",
  "12345678",
  "NL123456789B01",
  "NL00ABCD0123456789",
  "085 - 123 45 67",
]);

/** The value, or null when it is still the placeholder. */
export function realOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  return COMPANY_PLACEHOLDERS.has(value) ? null : value;
}

/** Text to show in place of a registration detail we do not have yet. */
export const PENDING_REGISTRATION = "volgt na inschrijving";

/**
 * Shipping, in one place. The checkout route, the cart summary, the product
 * structured data and the terms page all read these — the site used to quote
 * &euro;4,95 in three places while the card was charged &euro;5,95, and the cart
 * applied the free-shipping threshold before the discount while the server
 * applied it after.
 */
export const SHIPPING = {
  /** Flat rate for NL/BE below the free-shipping threshold. */
  rateEur: 5.95,
  /** Order value (after discount) from which shipping is free. */
  freeFromEur: 50,
} as const;

/** Shipping due on an order, given its subtotal and any discount. */
export function shippingFor(subtotalEur: number, discountEur = 0): number {
  return subtotalEur - discountEur >= SHIPPING.freeFromEur ? 0 : SHIPPING.rateEur;
}

export type Plan = {
  id: PlanId;
  name: string;
  /** Monthly price in cents, including VAT for consumer-facing display. */
  priceCents: number;
  /** Who the plan is for — drives the ex/incl BTW label. */
  audience: "consumer" | "business";
  tagline: string;
  /** Free trial in days; 0 means no trial. Passed to Stripe. */
  trialDays: number;
  /** -1 = unlimited. */
  diagnosesPerMonth: number;
  /** Fraction off the parts catalog price. */
  partsDiscount: number;
  premiumGuides: boolean;
  technicianDashboard: boolean;
  /** Included B2B API calls per month; 0 = no API access. */
  apiCallsPerMonth: number;
  features: string[];
  /** Env var holding the Stripe price id, when the plan is billable. */
  stripePriceId?: string;
  highlight?: boolean;
};

export const PLANS: Record<PlanId, Plan> = {
  FREE: {
    id: "FREE",
    name: "Gratis",
    priceCents: 0,
    audience: "consumer",
    tagline: "Ideaal om te proeven",
    trialDays: 0,
    diagnosesPerMonth: 3,
    partsDiscount: 0,
    premiumGuides: false,
    technicianDashboard: false,
    apiCallsPerMonth: 0,
    features: [
      "3 AI diagnoses per maand",
      "Volledige foutcode database",
      "Toegang tot gratis gidsen",
    ],
  },
  PARTICULIER: {
    id: "PARTICULIER",
    name: "Particulier",
    priceCents: 499,
    audience: "consumer",
    tagline: "Voor de slimme klusser",
    trialDays: 14,
    diagnosesPerMonth: -1,
    partsDiscount: 0.05,
    premiumGuides: true,
    technicianDashboard: false,
    apiCallsPerMonth: 0,
    features: [
      "Onbeperkte AI diagnoses",
      "Alle premium reparatiegidsen",
      "5% korting op alle onderdelen",
      "Diagnoses geschiedenis",
      "Prioriteit e-mail support",
    ],
    highlight: true,
  },
  MONTEUR_PRO: {
    id: "MONTEUR_PRO",
    name: "Monteur Pro",
    priceCents: 2900,
    audience: "business",
    tagline: "Voor zelfstandige monteurs",
    trialDays: 14,
    diagnosesPerMonth: -1,
    partsDiscount: 0.1,
    premiumGuides: true,
    technicianDashboard: true,
    apiCallsPerMonth: 1000,
    features: [
      "Alles in Particulier",
      "10% korting op onderdelen",
      "Klanten-CRM en werkorders",
      "Bulk onderdelen bestellen",
      "B2B API (1.000 calls/maand)",
    ],
  },
  BEDRIJF: {
    id: "BEDRIJF",
    name: "Bedrijf",
    priceCents: 19900,
    audience: "business",
    tagline: "Voor reparatiebedrijven",
    trialDays: 14,
    diagnosesPerMonth: -1,
    partsDiscount: 0.15,
    premiumGuides: true,
    technicianDashboard: true,
    apiCallsPerMonth: 10000,
    features: [
      "Alles in Monteur Pro",
      "15% korting op onderdelen",
      "Tot 20 gebruikers",
      "B2B API (10.000 calls/maand)",
      "Witlabel optie",
    ],
  },
};

/** Order in which plans are shown on pricing surfaces. */
export const PLAN_ORDER: PlanId[] = ["FREE", "PARTICULIER", "MONTEUR_PRO", "BEDRIJF"];

/** Plans a customer can buy themselves (FREE needs no checkout). */
export const BILLABLE_PLANS: PlanId[] = ["PARTICULIER", "MONTEUR_PRO", "BEDRIJF"];

export function getPlan(plan: string): Plan {
  return PLANS[plan as PlanId] ?? PLANS.FREE;
}

/** Stripe price id for a plan, or undefined when it isn't configured yet. */
export function stripePriceIdFor(plan: PlanId): string | undefined {
  switch (plan) {
    case "PARTICULIER":
      return env.STRIPE_PRICE_PARTICULIER;
    case "MONTEUR_PRO":
      return env.STRIPE_PRICE_MONTEUR;
    case "BEDRIJF":
      return env.STRIPE_PRICE_BEDRIJF;
    default:
      return undefined;
  }
}

/** "€ 4,99" — the price as shown to customers. */
export function formatPlanPrice(plan: Plan): string {
  if (plan.priceCents === 0) return "€ 0";
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(plan.priceCents / 100);
}

/**
 * The per-month suffix. Business plans quote ex BTW (their customers deduct
 * it), consumer plans quote incl BTW — which is what NL price-display rules
 * require for consumers.
 */
export function planPriceSuffix(plan: Plan): string {
  if (plan.priceCents === 0) return "voor altijd";
  return plan.audience === "business" ? "per maand · excl. btw" : "per maand · incl. btw";
}
