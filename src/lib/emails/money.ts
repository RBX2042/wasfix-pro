/**
 * The one Dutch money formatter for every text a person reads that is built in
 * code: owner notices (Slack, Discord, mail), domain error messages, the CSV
 * import preview and the prefill of the part form.
 *
 * Why it exists: those places each did their own `toFixed(2)`, so the same
 * amount read "€ 14.45" in a Slack notice and "14,45" in the admin screen, and
 * an empty VAT quarter read "€ -0,00" because Intl prints negative zero.
 *
 * Pure (no environment, no database), so client components may import it.
 *
 *   decimalNl(14.5)      "14,50"       two decimals, comma, no thousands separator
 *   decimalNl(-0)        "0,00"        never a minus sign in front of zero
 *   eurNl(1234.5)        "€ 1.234,50"  with thousands separator, plain space
 *   centsSafe(-0.001)    0             rounds to whole cents and removes -0
 */

/** Round to whole cents and turn -0 (and anything that rounds to zero) into plain 0. */
export function centsSafe(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** "14,45": two decimals with a comma, no thousands separator. For form fields, where the owner types the number back. */
export function decimalNl(value: number, decimals = 2): string {
  if (decimals === 2) return centsSafe(value).toFixed(2).replace(".", ",");
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return (rounded === 0 ? 0 : rounded).toFixed(decimals).replace(".", ",");
}

const GROUPED = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "€ 1.234,50": for sentences. A plain space, not a no-break one, so plain-text channels stay readable. */
export function eurNl(value: number): string {
  return `€ ${GROUPED.format(centsSafe(value))}`;
}
