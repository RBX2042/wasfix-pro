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
import {
  DEFAULT_COMPANY_NAME,
  canonicalCompanyValue,
  companyTradeName,
  evaluateCompany,
  isPlaceholderValue,
  type CompanyInput,
  type CompanyReadiness,
} from "./company-validate";

export type PlanId = "FREE" | "PARTICULIER" | "MONTEUR_PRO" | "BEDRIJF";

/** Dutch standard VAT rate. Consumer prices on the site include this. */
export const VAT_RATE = 0.21;

/**
 * Company and fiscal identity, printed on invoices and legal pages.
 *
 * SERVER ONLY IN PRACTICE. These values come from COMPANY_* environment
 * variables, which exist on the server and nowhere else. A client component
 * that reads COMPANY in the browser sees the fallbacks below instead of the
 * configured values, so the server-rendered HTML and the hydrated DOM disagree
 * (React error #418). Client components must receive what they need as props
 * from a server component: see publicCompany() in src/lib/company.ts.
 * scripts/qa-money.ts fails when a "use client" file imports COMPANY.
 *
 * The fallbacks exist so local development and the demo render something. They
 * are never accepted as real: companyReadiness() looks at the environment, not
 * at these fields, and `isPlaceholder` is true until ALL of name, street,
 * postal code, city, KvK, btw-nummer and IBAN are configured and valid.
 */
// Every fiscal field goes through canonicalCompanyValue(), the same function
// companyReadiness() judges, so a trailing newline or a lower-case btw-nummer in
// the environment can neither pass the check and then be printed as typed, nor
// end up in the permanent invoice seller block.
const canon = (field: Parameters<typeof canonicalCompanyValue>[0], raw: string | undefined, fallback: string) =>
  canonicalCompanyValue(field, raw) || fallback;

export const COMPANY = {
  // No legal form in the default: "B.V." is a claim that the company is
  // registered as one.
  name: canon("name", env.COMPANY_NAME, DEFAULT_COMPANY_NAME),
  /** The name without a trailing "(in oprichting)", for sentences that say so themselves. */
  tradeName: companyTradeName(canon("name", env.COMPANY_NAME, DEFAULT_COMPANY_NAME)),
  street: canon("street", env.COMPANY_STREET, "Hoofdstraat 1"),
  postalCode: canon("postalCode", env.COMPANY_POSTAL_CODE, "1234 AB"),
  // Empty rather than a plausible-looking city: "Amsterdam" was printed as the
  // address of a company that has none.
  city: canon("city", env.COMPANY_CITY, ""),
  country: "Nederland",
  kvk: canon("kvk", env.COMPANY_KVK, "12345678"),
  vatNumber: canon("vatNumber", env.COMPANY_VAT, "NL123456789B01"),
  iban: canon("iban", env.COMPANY_IBAN, "NL00ABCD0123456789"),
  email: env.COMPANY_EMAIL?.trim() || "support@wasfix.nl",
  phone: env.COMPANY_PHONE?.trim() || "085 - 123 45 67",
  /** True until the whole fiscal identity is real. See companyReadiness(). */
  get isPlaceholder() {
    return !companyReadiness().ready;
  },
} as const;

/** The seven fields (plus the contact e-mail) as configured in the environment (no fallbacks). */
export function companyInputFromEnv(): CompanyInput {
  return {
    name: env.COMPANY_NAME,
    street: env.COMPANY_STREET,
    postalCode: env.COMPANY_POSTAL_CODE,
    city: env.COMPANY_CITY,
    kvk: env.COMPANY_KVK,
    vatNumber: env.COMPANY_VAT,
    iban: env.COMPANY_IBAN,
    // Not mandatory; companyReadiness() only reports it in `warnings`.
    email: env.COMPANY_EMAIL,
  };
}

/**
 * Whether the company may invoice and ask for money.
 *
 * `ready` is true only when name, street, postal code, city, KvK (8 digits),
 * btw-nummer (NL + 9 digits + B + 2 digits) and IBAN (valid mod-97, not the
 * placeholder) are ALL real. A partial configuration is not ready: the old
 * check looked at the KvK alone, so setting only COMPANY_KVK let checkout
 * invoice with a placeholder IBAN and btw-nummer.
 *
 * Pass `input` to evaluate other values (tests, a preflight dry run); without
 * it the environment is read.
 */
export function companyReadiness(input: CompanyInput = companyInputFromEnv()): CompanyReadiness {
  return evaluateCompany(input);
}

/**
 * The stand-in values above. Public pages must not print these as if they were
 * real registration details — a visitor reading "KvK 12345678" is being told
 * something false — so they render `null` until the real value is configured.
 */
/** The value, or null when it is still the placeholder. */
export function realOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  return isPlaceholderValue(value) ? null : value;
}

/** Text to show in place of a registration detail we do not have yet. */
export const PENDING_REGISTRATION = "volgt na inschrijving";

/**
 * One-line seller identity for e-mail footers and legal pages.
 *
 * Renders only what is actually registered. The privacy page and both e-mail
 * footers used to hardcode "Hoofdstraat 1, 1234 AB Amsterdam · KvK 12345678"
 * as literal strings — so they printed a fake KvK as fact, and setting the
 * real COMPANY_* env vars would not have corrected them. Everything that
 * states our identity must go through here or through realOrNull().
 */
export function companyIdentityLine(): string {
  const postcodeCity = [realOrNull(COMPANY.postalCode), realOrNull(COMPANY.city)].filter(Boolean).join(" ");
  const address = [realOrNull(COMPANY.street), postcodeCity || null].filter(Boolean).join(", ");
  const kvk = realOrNull(COMPANY.kvk);
  const registration = kvk ? `KvK ${kvk}` : /in oprichting/i.test(COMPANY.name) ? null : "in oprichting";
  return [COMPANY.name, address || null, registration].filter(Boolean).join(" · ");
}

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
      "Volledige stappen van de premium reparatiegidsen",
      "5% korting op onderdelen (vanaf je eerste betaling)",
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
      "10% korting op onderdelen (vanaf je eerste betaling)",
      "Klanten-CRM en werkorders met factuur",
      "B2B API (1.000 calls/maand, max. 120 per uur)",
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
    // "Tot 20 gebruikers" en "Witlabel optie" stonden hier, maar er bestaat geen
    // organisatie-, team- of rollenmodel (elk zakelijk object hangt aan één
    // ownerId) en geen witlabel-implementatie. Een feature verkopen die niet
    // bestaat is een misleidende handelspraktijk (art. 6:193c BW); zet ze pas
    // terug als ze echt gebouwd zijn.
    features: [
      "Alles in Monteur Pro",
      "15% korting op onderdelen (vanaf je eerste betaling)",
      "B2B API (10.000 calls/maand, max. 600 per uur)",
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
