import { COMPANY, realOrNull } from "@/lib/plans";

/** retourvoorwaarden art. 3: "Verstuur binnen 14 dagen na het ontvangen van je RMA-nummer". */
export const RETURN_SHIP_DAYS = 14;
/** Withdrawal period the shop grants (retourvoorwaarden art. 1): 30 days after receipt. */
export const RETURN_WINDOW_DAYS = 30;

export const RMA_OPEN = ["RECEIVED", "APPROVED", "RETURN_RECEIVED"] as const;
export const RMA_LABEL: Record<string, string> = {
  RECEIVED: "Ontvangen",
  APPROVED: "Goedgekeurd, wacht op pakket",
  RETURN_RECEIVED: "Pakket ontvangen",
  REFUNDED: "Terugbetaald",
  REJECTED: "Afgewezen",
};

/** The return address, or null while the company's real address is not configured (the placeholder is never mailed). */
export function realReturnAddress(): string[] | null {
  const street = realOrNull(COMPANY.street);
  const postal = realOrNull(COMPANY.postalCode);
  const city = realOrNull(COMPANY.city);
  if (!street || !postal || !city) return null;
  return [COMPANY.name, "T.a.v. Retouren (RMA-nummer op de buitenkant)", street, `${postal} ${city}`, COMPANY.country];
}
