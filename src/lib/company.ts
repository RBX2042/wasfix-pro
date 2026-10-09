/**
 * Server-side door to the company identity.
 *
 * CONTRACT
 *   COMPANY, companyReadiness(), companyIdentityLine(), realOrNull(),
 *   PENDING_REGISTRATION   re-exported from ./plans unchanged.
 *   publicCompany()        a plain, serialisable snapshot of what may be shown
 *                          to visitors, for passing to client components as
 *                          props. Placeholders are already turned into null;
 *                          `ready` says whether bank details and invoices may
 *                          be offered.
 *
 * Importing this file from a client component is a build error ("server-only"):
 * that is the point. COMPANY is built from server environment variables, which
 * do not exist in the browser, so reading it there renders placeholders after
 * hydration (React error #418).
 */
import "server-only";
import { COMPANY, companyReadiness, companyIdentityLine, realOrNull, PENDING_REGISTRATION } from "./plans";

export { COMPANY, companyReadiness, companyIdentityLine, realOrNull, PENDING_REGISTRATION };

export type PublicCompany = {
  name: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  kvk: string | null;
  vatNumber: string | null;
  /** Only set when the whole identity is ready: never show a bare IBAN otherwise. */
  iban: string | null;
  /** COMPANY_EMAIL, or null when it is not configured (checkout is closed then; never an invented address). */
  email: string | null;
  phone: string | null;
  /** True when the complete fiscal identity is configured. */
  ready: boolean;
  /** "Name · address · KvK ..." for footers. */
  identityLine: string;
};

export function publicCompany(): PublicCompany {
  const ready = companyReadiness().ready;
  return {
    name: COMPANY.name,
    street: realOrNull(COMPANY.street),
    postalCode: realOrNull(COMPANY.postalCode),
    city: realOrNull(COMPANY.city),
    country: COMPANY.country,
    kvk: realOrNull(COMPANY.kvk),
    vatNumber: realOrNull(COMPANY.vatNumber),
    iban: ready ? realOrNull(COMPANY.iban) : null,
    email: realOrNull(COMPANY.email),
    phone: realOrNull(COMPANY.phone),
    ready,
    identityLine: companyIdentityLine(),
  };
}
