/**
 * Customer mails that belong to the owner's back-office flows: the payment
 * reminder and the return (RMA) mails. They use the one sender and the one layout
 * of src/lib/email.ts (sendMail, shell), so a missing key, a refused send and the
 * owner escalation behave exactly like every other mail.
 *
 * Nothing here invents a fact: the return address and the deadline are passed in
 * by the caller from COMPANY / the RMA, and the money amounts from the order.
 */
import { sendMail, type MailResult } from "@/lib/email";
import { button, esc, eur, shell } from "@/lib/emails/layout";
import { customerOrderUrl, orderRef } from "@/lib/order-status";

const dateNl = (d: Date) => new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }).format(d);
const dayKey = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam" }).format(d); // YYYY-MM-DD

/**
 * Where "now" stands against the due date, on the Amsterdam calendar. The daily cron
 * sends the first reminder at its first run AFTER the due date, i.e. normally the day
 * after, so a text that says "loopt vandaag af" is wrong more often than right: the
 * words come from this, not from the stage.
 */
export function dueStanding(dueAt: Date, now: Date): "today" | "past" | "future" {
  const due = dayKey(dueAt);
  const today = dayKey(now);
  return due === today ? "today" : due < today ? "past" : "future";
}

export async function sendPaymentReminderEmail(
  to: string,
  d: {
    orderId: string;
    name: string;
    accessToken?: string | null;
    invoiceNumber: string;
    totalEur: number;
    dueAt: Date;
    /** Seller IBAN from the invoice snapshot; null when it is not a real one. */
    iban: string | null;
    ibanName: string | null;
    stage: "due" | "last";
    /** When the reservation ends and the order is cancelled. */
    cancelOn: Date;
    /** Defaults to the current time. Only tests set it. */
    now?: Date;
  },
): Promise<MailResult> {
  const last = d.stage === "last";
  const standing = dueStanding(d.dueAt, d.now ?? new Date());
  const subject = last
    ? `Laatste herinnering: factuur ${d.invoiceNumber} is nog niet betaald`
    : standing === "today"
      ? `Herinnering: factuur ${d.invoiceNumber} vervalt vandaag`
      : standing === "future"
        ? `Herinnering: factuur ${d.invoiceNumber} vervalt op ${dateNl(d.dueAt)}`
        : `Herinnering: factuur ${d.invoiceNumber} is nog niet betaald`;
  const dueSentence =
    standing === "today"
      ? `De betaaltermijn van factuur <strong>${esc(d.invoiceNumber)}</strong> loopt vandaag af (${esc(dateNl(d.dueAt))}). We hebben je betaling nog niet ontvangen.`
      : standing === "future"
        ? `De betaaltermijn van factuur <strong>${esc(d.invoiceNumber)}</strong> loopt af op ${esc(dateNl(d.dueAt))}. We hebben je betaling nog niet ontvangen.`
        : `De betaaltermijn van factuur <strong>${esc(d.invoiceNumber)}</strong> is verlopen op ${esc(dateNl(d.dueAt))}. We hebben je betaling nog niet ontvangen.`;
  return sendMail({
    template: last ? "payment-reminder-last" : "payment-reminder",
    orderRef: orderRef(d.orderId),
    to,
    subject,
    html: shell(`
        <h1 style="color:#1a6b6b;">${last ? "Laatste herinnering" : "Betalingsherinnering"}</h1>
        <p style="font-size:16px;line-height:1.6;">Hi ${esc(d.name)},</p>
        <p style="font-size:16px;line-height:1.6;">
          ${last
            ? `We hebben je betaling voor factuur <strong>${esc(d.invoiceNumber)}</strong> nog niet ontvangen. De vervaldatum was ${esc(dateNl(d.dueAt))}. Maak het bedrag uiterlijk <strong>${esc(dateNl(d.cancelOn))}</strong> over; daarna annuleren we de bestelling en geven we de onderdelen weer vrij.`
            : `${dueSentence} Is het bedrag net overgemaakt? Dan kun je deze herinnering negeren.`}
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
          <tr><td style="padding:6px 0;color:#666;">Bedrag</td><td style="font-weight:600;">${esc(eur(d.totalEur))}</td></tr>
          ${d.iban ? `<tr><td style="padding:6px 0;color:#666;">IBAN</td><td style="font-family:monospace;">${esc(d.iban)}</td></tr>` : ""}
          ${d.ibanName ? `<tr><td style="padding:6px 0;color:#666;">Ten name van</td><td>${esc(d.ibanName)}</td></tr>` : ""}
          <tr><td style="padding:6px 0;color:#666;">Omschrijving</td><td style="font-family:monospace;font-weight:600;">${esc(d.invoiceNumber)}</td></tr>
        </table>
        <p style="font-size:14px;line-height:1.6;">Vermeld het factuurnummer bij je overschrijving, dan kunnen we de betaling direct herkennen.</p>
        ${button(customerOrderUrl(d.orderId, d.accessToken), "Bekijk bestelling en factuur")}
        <p style="font-size:13px;color:#666;margin-top:24px;">Bestelnummer ${esc(orderRef(d.orderId))}. Vragen? Antwoord gewoon op deze e-mail.</p>`),
  });
}

export async function sendRmaReceivedEmail(to: string, d: { rmaNumber: string; name: string }): Promise<MailResult> {
  return sendMail({
    template: "rma-acknowledgement",
    to,
    subject: `Retour-aanvraag ontvangen · ${d.rmaNumber}`,
    html: shell(`
        <h1 style="color:#1a6b6b;">Retour-aanvraag ontvangen</h1>
        <p style="font-size:16px;line-height:1.6;">Hi ${esc(d.name)},</p>
        <p style="font-size:16px;line-height:1.6;">We hebben je retour-aanvraag ontvangen. Je RMA-nummer is:</p>
        <div style="background:#f0f9f9;border:1px solid #1a6b6b;padding:14px 18px;border-radius:8px;margin:16px 0;">
          <div style="font-family:monospace;font-size:18px;font-weight:600;color:#1a6b6b;">${esc(d.rmaNumber)}</div>
        </div>
        <p style="font-size:14px;line-height:1.6;"><strong>Stuur nog niets op.</strong> We beoordelen je aanvraag en mailen je daarna. Bij goedkeuring krijg je het retouradres en de instructies in een aparte e-mail.</p>
        <p style="font-size:13px;color:#666;margin-top:24px;">Vragen? Antwoord gewoon op deze e-mail en vermeld je RMA-nummer.</p>`),
  });
}

export async function sendRmaApprovedEmail(
  to: string,
  d: {
    rmaNumber: string;
    name: string;
    /** Lines of the return address; the caller refuses to approve without a real one. */
    returnAddress: string[];
    deadline: Date;
    /** Who pays the return shipping, in a sentence. */
    shippingNote: string;
    labelUrl?: string | null;
  },
): Promise<MailResult> {
  return sendMail({
    template: "rma-approved",
    to,
    subject: `Retour goedgekeurd · ${d.rmaNumber}`,
    html: shell(`
        <h1 style="color:#1a6b6b;">Je retour is goedgekeurd</h1>
        <p style="font-size:16px;line-height:1.6;">Hi ${esc(d.name)},</p>
        <p style="font-size:16px;line-height:1.6;">Je kunt het onderdeel terugsturen. Zo doe je dat:</p>
        <ol style="font-size:14px;line-height:1.7;">
          <li>Pak het onderdeel zo compleet mogelijk in, bij voorkeur in de originele verpakking.</li>
          <li>Schrijf het RMA-nummer <strong style="font-family:monospace;">${esc(d.rmaNumber)}</strong> goed zichtbaar op de buitenkant.</li>
          <li>Verstuur het pakket uiterlijk <strong>${esc(dateNl(d.deadline))}</strong> naar het adres hieronder en bewaar het verzendbewijs.</li>
        </ol>
        <div style="background:#f7f7f7;border-left:3px solid #1a6b6b;padding:12px 14px;border-radius:4px;font-size:14px;line-height:1.6;">
          ${d.returnAddress.map((l) => esc(l)).join("<br>")}
        </div>
        <p style="font-size:14px;line-height:1.6;margin-top:16px;">${esc(d.shippingNote)}</p>
        ${d.labelUrl ? button(d.labelUrl, "Retourlabel") : ""}
        <p style="font-size:14px;line-height:1.6;">Zodra we het pakket hebben ontvangen en bekeken, betalen we het bedrag terug en sturen we je een bevestiging met de creditnota.</p>`),
  });
}

export async function sendRmaRejectedEmail(to: string, d: { rmaNumber: string; name: string; reason: string }): Promise<MailResult> {
  return sendMail({
    template: "rma-rejected",
    to,
    subject: `Retour-aanvraag niet goedgekeurd · ${d.rmaNumber}`,
    html: shell(`
        <h1 style="color:#1a6b6b;">Je retour-aanvraag is niet goedgekeurd</h1>
        <p style="font-size:16px;line-height:1.6;">Hi ${esc(d.name)},</p>
        <p style="font-size:16px;line-height:1.6;">We kunnen retour <strong style="font-family:monospace;">${esc(d.rmaNumber)}</strong> helaas niet goedkeuren.</p>
        <div style="background:#f7f7f7;border-left:3px solid #1a6b6b;padding:12px 14px;border-radius:4px;font-size:14px;line-height:1.6;">${esc(d.reason).replace(/\n/g, "<br>")}</div>
        <p style="font-size:14px;line-height:1.6;margin-top:16px;">Ben je het er niet mee eens, of mis je informatie? Antwoord op deze e-mail, dan kijken we er opnieuw naar. Je wettelijke rechten blijven bestaan.</p>`),
  });
}

export async function sendRmaReturnReceivedEmail(to: string, d: { rmaNumber: string; name: string }): Promise<MailResult> {
  return sendMail({
    template: "rma-return-received",
    to,
    subject: `Retour ontvangen · ${d.rmaNumber}`,
    html: shell(`
        <h1 style="color:#1a6b6b;">We hebben je retour ontvangen</h1>
        <p style="font-size:16px;line-height:1.6;">Hi ${esc(d.name)},</p>
        <p style="font-size:16px;line-height:1.6;">Je pakket met RMA-nummer <strong style="font-family:monospace;">${esc(d.rmaNumber)}</strong> is bij ons binnen. We controleren het onderdeel en regelen daarna de terugbetaling; je krijgt een aparte e-mail zodra die is gedaan.</p>`),
  });
}
