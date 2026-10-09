/**
 * What approving a Monteur Pro application does, and does NOT do.
 *
 * Approval is a vetting step, not a gift. It used to set role TECHNICIAN and
 * plan MONTEUR_PRO on the matching account: no subscription, no expiry, and
 * setting the application back to REJECTED left the privileges in place. Now it
 *   - marks the application APPROVED (the caller does that),
 *   - tells the applicant how to subscribe.
 * It changes neither User.role nor User.plan: paid features follow the plan the
 * Stripe webhook writes (src/lib/auth.ts hasProAccess), so there is nothing to
 * take back when an application is reverted.
 *
 * It also creates NO MonteurProfile. The application form is public and its
 * e-mail address is never verified, so whoever owns the typed address might not be
 * the applicant; a profile created at approval would put the applicant's company,
 * KvK and btw numbers on that stranger's account, and monteur-invoicing.ts prints
 * the profile as the SELLER on work-order invoices. Instead the settings page
 * offers the approved application's details as a PREFILL to the signed-in owner of
 * a VERIFIED address that matches (approvedApplicationFor); nothing is stored
 * until that person reviews and saves the form.
 */
import type { MonteurApplication, PrismaClient } from "@prisma/client";
import { env } from "./env";
import { PLANS } from "./plans";
import { esc, button, shell } from "./emails/layout";
import type { MailResult } from "./emails/transport";
import { sendMail } from "./email";

/** The account that owns the application's e-mail address, case-insensitively. Placeholder rows (unverified addresses) never match. Used only to choose the link in the mail. */
export async function accountForApplication(db: Pick<PrismaClient, "user">, application: Pick<MonteurApplication, "email">) {
  const email = application.email.trim().toLowerCase();
  if (!email) return null;
  return db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, email: true, plan: true } });
}

/** The fields of the settings form an approved application can prefill (no secrets, nothing the applicant did not type themselves). */
export type ApplicationPrefill = {
  companyName: string;
  contactName: string;
  kvkNumber: string;
  vatNumber: string | null;
  phone: string | null;
  email: string;
};

/**
 * The most recent APPROVED application for the signed-in person, or null.
 * `emailVerified` must be the verdict from getCurrentUser (Clerk-verified
 * address): an unverified address matches nothing, whatever it says.
 */
export async function approvedApplicationFor(
  db: Pick<PrismaClient, "monteurApplication">,
  who: { email: string; emailVerified?: boolean },
): Promise<ApplicationPrefill | null> {
  const email = who.email.trim().toLowerCase();
  if (!who.emailVerified || !email) return null;
  const app = await db.monteurApplication.findFirst({
    where: { status: "APPROVED", email: { equals: email, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
  });
  if (!app) return null;
  return { companyName: app.companyName, contactName: app.contactName, kvkNumber: app.kvkNumber, vatNumber: app.vatNumber, phone: app.phone, email };
}

/** The link the approval mail points at: straight to payment when the applicant has an account, else to registration that returns to payment. */
export function subscribeLinkFor(hasAccount: boolean): string {
  return hasAccount ? `${env.APP_URL}/upgrade?plan=MONTEUR_PRO` : `${env.APP_URL}/registreren?plan=monteur_pro`;
}

export async function sendMonteurApprovedEmail(
  application: Pick<MonteurApplication, "email" | "contactName" | "companyName">,
  hasAccount: boolean,
): Promise<MailResult> {
  const plan = PLANS.MONTEUR_PRO;
  const price = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(plan.priceCents / 100);
  return sendMail({
    template: "monteur-approved",
    to: application.email,
    subject: "Je Monteur Pro-aanmelding is goedgekeurd",
    html: shell(`
        <h1 style="color: #1a6b6b; font-size: 24px;">Goedgekeurd, ${esc(application.contactName)}</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">
          We hebben de aanmelding van ${esc(application.companyName)} beoordeeld en goedgekeurd.
        </p>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">
          Let op: goedkeuring geeft nog geen toegang tot Monteur Pro. Monteur Pro is een abonnement van ${esc(price)} per maand excl. btw
          (${plan.trialDays} dagen gratis voor wie nog geen proefperiode heeft gehad, maandelijks opzegbaar). Zodra je het afsluit krijg je klanten, werkorders met factuur,
          ${Math.round(plan.partsDiscount * 100)}% korting op onderdelen (zodra je eerste betaling is voldaan) en de B2B API.
        </p>
        <p style="font-size: 15px; line-height: 1.6; color: #333;">
          ${hasAccount ? "Je hebt al een account met dit e-mailadres. Sluit je abonnement hier af:" : "Maak eerst een gratis account met dit e-mailadres en sluit daarna je abonnement af:"}
        </p>
        ${button(subscribeLinkFor(hasAccount), "Start Monteur Pro")}`),
    text: `Je aanmelding is goedgekeurd. Goedkeuring geeft nog geen toegang: Monteur Pro is een abonnement (${price} per maand excl. btw). Start het hier: ${subscribeLinkFor(hasAccount)}`,
  });
}
