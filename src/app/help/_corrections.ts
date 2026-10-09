/**
 * Corrections applied to help-article, /vs and /blog text at render time.
 *
 * src/data/help-articles.json states things the shop no longer does or never
 * verified: delivery to Belgium (decision D6: Netherlands only), a track & trace
 * link "as soon as the parcel is registered with the carrier" (it is sent when the
 * order is marked as shipped), and a fixed "60 seconds" for the AI. Editing that
 * file is outside this bundle, so the pages correct the exact phrases here. Once the
 * JSON itself is corrected these replacements simply stop matching;
 * scripts/qa-storefront.ts fails if any of the old phrases would still reach a page.
 *
 * It also fills the {{tokens}} of the help articles: the contact address and the response times
 * come from COMPANY_EMAIL and src/lib/plans.ts, so the JSON cannot print an address or a promise
 * the configuration does not back (decision D15, one response time everywhere).
 */
import { COMPLAINT_RESOLUTION_DAYS, SUPPORT_RESPONSE_WORKDAYS } from "@/lib/plans";
import { contactEmailText } from "@/lib/contact-email";

export const HELP_TEXT_CORRECTIONS: Array<[string, string]> = [
  ["Verzendkosten €5,95 in NL en BE, gratis vanaf €50.", "Verzendkosten €5,95 binnen Nederland, gratis vanaf €50."],
  ["met track & trace zodra je pakket is aangemeld", "met een track & trace-code zodra je bestelling is verzonden"],
  ["Nederland en België: €5,95, gratis vanaf €50", "Nederland: €5,95, gratis vanaf €50 (we leveren alleen in Nederland)"],
  [
    "Zodra je pakket bij de vervoerder is aangemeld, ontvang je per e-mail een track & trace-link.",
    "Zodra wij je bestelling als verzonden markeren, ontvang je per e-mail een track & trace-code.",
  ],
  ["binnen 60 seconden", "snel"],
  // /vs and /blog (same cause: the JSON states a fixed duration and a statistic nobody measured)
  ["Onze AI-diagnose vertelt je in 60 seconden of je dit zelf kunt.", "Onze AI-diagnose geeft een eerste indicatie of je dit zelf kunt."],
  ["Onze AI-diagnose helpt je in 60 seconden vaststellen", "Onze AI-diagnose helpt je een eerste indicatie te krijgen"],
  ["Ja, 60s, gratis", "Ja, gratis"],
  [" (60% van alle defecten)", ""],
  // /vs/monteur: a bank-transfer order ships only after the wire arrives, and the terms call delivery times an indication.
  ["Vandaag besteld = morgen, repareren 30-90 min", "Verzonden op werkdagen zodra je betaling binnen is, repareren 30-90 min"],
];

/** The {{tokens}} used in help-articles.json, resolved at render time (server side). */
function fillTokens(text: string): string {
  if (!text.includes("{{")) return text;
  return text
    .split("{{contact-email}}").join(contactEmailText())
    .split("{{respons-werkdagen}}").join(String(SUPPORT_RESPONSE_WORKDAYS))
    .split("{{klacht-dagen}}").join(String(COMPLAINT_RESOLUTION_DAYS));
}

export function correctHelpText(text: string): string {
  return fillTokens(HELP_TEXT_CORRECTIONS.reduce((t, [from, to]) => t.split(from).join(to), text));
}

/** Same function under the name the /vs and /blog pages use. */
export const correctCopy = correctHelpText;
