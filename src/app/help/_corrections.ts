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
 */
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
];

export function correctHelpText(text: string): string {
  return HELP_TEXT_CORRECTIONS.reduce((t, [from, to]) => t.split(from).join(to), text);
}

/** Same function under the name the /vs and /blog pages use. */
export const correctCopy = correctHelpText;
