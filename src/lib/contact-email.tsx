/**
 * The customer-facing contact address on public pages (decision D15).
 *
 * COMPANY_EMAIL is the ONLY source. There is no built-in address: the shop used
 * to print support@wasfix.nl, a mailbox nothing proves exists, on the legal pages
 * and the withdrawal form. When COMPANY_EMAIL is not set the pages say so
 * ("volgt na inschrijving") instead of inventing one, and checkout is closed in
 * production anyway (companyReadiness()).
 *
 * Server components only: COMPANY is built from server environment variables.
 */
import type { CSSProperties, ReactNode } from "react";
import { COMPANY, PENDING_REGISTRATION, realOrNull } from "./plans";

/** The configured address, or null. */
export function contactEmail(): string | null {
  return realOrNull(COMPANY.email);
}

/** Plain-text form, for sentences and preformatted blocks. */
export function contactEmailText(): string {
  return contactEmail() ?? `(e-mailadres ${PENDING_REGISTRATION})`;
}

/** `mailto:` link to the contact address, or a plain "(e-mailadres volgt na inschrijving)". */
export function ContactEmail({ subject, className, style, children }: { subject?: string; className?: string; style?: CSSProperties; children?: ReactNode }) {
  const email = contactEmail();
  if (!email) return <span className="text-muted-foreground">{contactEmailText()}</span>;
  const href = `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
  return (
    <a href={href} className={className} style={style}>
      {children ?? email}
    </a>
  );
}
