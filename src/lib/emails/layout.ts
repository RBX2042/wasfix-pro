/**
 * Shared building blocks for the transactional mails in src/lib/email.ts.
 * Inline styles only: mail clients ignore <style> blocks and external CSS.
 */
import { companyIdentityLine } from "../plans";
import { centsSafe } from "./money";

/**
 * Escape user text before it goes into an HTML e-mail body. Names, RMA notes
 * and monteur applications arrive from public forms, so unescaped markup would
 * ride out on our own SPF/DKIM-signed mail.
 */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const EUR = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
/** "€ 30,45". Negative zero and sub-cent noise print as 0, never "€ -0,00". */
export function eur(value: number): string {
  return EUR.format(centsSafe(value));
}

export function button(href: string, label: string): string {
  return `<a href="${esc(href)}" style="display: inline-block; background: #1a6b6b; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin-top: 24px;">${esc(label)}</a>`;
}

/** Wrap a mail body in the standard container and the seller identity footer. */
export function shell(inner: string): string {
  return `
      <div style="font-family: system-ui, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px;">
        ${inner}
        <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0 16px 0;">
        <p style="font-size: 12px; color: #888; line-height: 1.5;">${esc(companyIdentityLine())}</p>
      </div>
    `;
}

export type MailLine = { name: string; quantity: number; total: number };

export function lineTable(lines: MailLine[], total: number): string {
  const rows = lines
    .map((i) => `<tr><td style="padding:8px 0;">${esc(i.name)} (${i.quantity}x)</td><td style="text-align:right;">${eur(i.total)}</td></tr>`)
    .join("");
  return `
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 16px;">
          <thead>
            <tr style="border-bottom: 1px solid #ddd;">
              <th style="text-align:left; padding: 8px 0;">Onderdeel</th>
              <th style="text-align:right; padding: 8px 0;">Prijs</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr style="border-top: 2px solid #1a6b6b; font-weight: bold;">
              <td style="padding: 12px 0;">Totaal (incl. btw)</td>
              <td style="text-align:right; padding: 12px 0;">${eur(total)}</td>
            </tr>
          </tfoot>
        </table>`;
}
