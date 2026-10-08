/**
 * Track-and-trace links per carrier.
 *
 * CONTRACT
 *   CARRIERS                    the carriers the admin form offers
 *   normaliseCarrier(input)     "postnl", "PostNL ", "post nl" -> "POSTNL"; anything unknown -> "OTHER"
 *   carrierLabel(carrier)       display name
 *   trackingUrl(carrier, code, postalCode?)
 *                               the public tracking page, or null when there is no
 *                               link we can build (unknown carrier, empty code, or
 *                               PostNL without the postcode its link requires)
 *
 * NOT VERIFIED, any of them. The PostNL, DHL and DPD patterns follow the links
 * recorded in the investigators' reports for this project; the UPS and GLS
 * patterns are written from general knowledge and appear in no report. None of
 * the five could be requested from the build environment (outbound access is
 * restricted), so a carrier changing its link format would not be noticed by any
 * test here. The mail always prints the plain tracking code next to the link for
 * that reason.
 */

export const CARRIERS = ["POSTNL", "DHL", "DPD", "UPS", "GLS"] as const;
export type Carrier = (typeof CARRIERS)[number] | "OTHER";

const LABEL: Record<Carrier, string> = { POSTNL: "PostNL", DHL: "DHL", DPD: "DPD", UPS: "UPS", GLS: "GLS", OTHER: "Vervoerder" };

export function normaliseCarrier(input: string | null | undefined): Carrier {
  const key = (input ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  return (CARRIERS as readonly string[]).includes(key) ? (key as Carrier) : "OTHER";
}

export function carrierLabel(carrier: string | null | undefined): string {
  const c = normaliseCarrier(carrier);
  // An unknown carrier keeps the name the admin typed.
  return c === "OTHER" && carrier?.trim() ? carrier.trim() : LABEL[c];
}

export function trackingUrl(carrier: string | null | undefined, code: string | null | undefined, postalCode?: string | null): string | null {
  const clean = (code ?? "").replace(/\s+/g, "");
  if (!clean) return null;
  const c = encodeURIComponent(clean);
  switch (normaliseCarrier(carrier)) {
    case "POSTNL": {
      const pc = (postalCode ?? "").replace(/\s+/g, "").toUpperCase();
      return pc ? `https://jouw.postnl.nl/track-and-trace/${c}-NL-${encodeURIComponent(pc)}` : null;
    }
    case "DHL":
      return `https://www.dhl.com/nl-nl/home/tracking.html?tracking-id=${c}`;
    case "DPD":
      return `https://tracking.dpd.de/status/nl_NL/parcel/${c}`;
    case "UPS":
      return `https://www.ups.com/track?loc=nl_NL&tracknum=${c}`;
    case "GLS":
      return `https://gls-group.com/NL/nl/volg-uw-pakket?match=${c}`;
    default:
      return null;
  }
}
