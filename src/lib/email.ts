import { Resend } from "resend";
import { env } from "./env";
import { companyIdentityLine } from "./plans";

let _resend: Resend | null = null;

function getResend(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(env.RESEND_API_KEY);
  return _resend;
}

const FROM = env.RESEND_FROM_EMAIL;

export async function sendWelcomeEmail(email: string, name: string) {
  const resend = getResend();
  if (!resend) return;

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: "Welkom bij WasFix Pro!",
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #1a6b6b; font-size: 28px;">Welkom bij WasFix Pro, ${name}!</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">
          Bedankt voor je registratie. Met WasFix Pro diagnostiseer je je wasmachine in minuten en krijg je het juiste onderdeel direct in huis.
        </p>
        <p style="font-size: 16px; line-height: 1.6;">
          Tijdens je gratis abonnement krijg je:
        </p>
        <ul style="font-size: 15px; line-height: 1.8;">
          <li>3 AI diagnoses per maand</li>
          <li>Toegang tot alle basis reparatiegidsen</li>
          <li>Volledige foutcode database</li>
        </ul>
        <a href="${env.APP_URL}/diagnose" style="display: inline-block; background: #1a6b6b; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin-top: 16px;">
          Start je eerste diagnose
        </a>
        <p style="margin-top: 32px; font-size: 13px; color: #666;">
          Vragen? Antwoord op deze e-mail.
        </p>
      </div>
    `,
  });
}

export async function sendOrderConfirmation(
  email: string,
  data: { orderId: string; items: Array<{ name: string; quantity: number; total: number }>; total: number; name: string }
) {
  const resend = getResend();
  if (!resend) return;

  const itemsHtml = data.items
    .map((i) => `<tr><td style="padding:8px 0;">${i.name} (${i.quantity}x)</td><td style="text-align:right;">€${i.total.toFixed(2)}</td></tr>`)
    .join("");

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Bestelling bevestigd #${data.orderId.slice(0, 8)}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #1a6b6b;">Bedankt voor je bestelling, ${data.name}!</h1>
        <p style="font-size: 16px; line-height: 1.6;">
          We hebben je bestelling ontvangen en sturen deze zo snel mogelijk uit.
        </p>
        <p style="font-size: 14px;"><strong>Bestelnummer:</strong> ${data.orderId}</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 16px;">
          <thead>
            <tr style="border-bottom: 1px solid #ddd;">
              <th style="text-align:left; padding: 8px 0;">Onderdeel</th>
              <th style="text-align:right; padding: 8px 0;">Prijs</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
          <tfoot>
            <tr style="border-top: 2px solid #1a6b6b; font-weight: bold;">
              <td style="padding: 12px 0;">Totaal</td>
              <td style="text-align:right; padding: 12px 0;">€${data.total.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
        <a href="${env.APP_URL}/bestelling/${data.orderId}" style="display: inline-block; background: #1a6b6b; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin-top: 24px;">
          Bekijk bestelling
        </a>
      </div>
    `,
  });
}

export async function sendBankTransferInstructions(
  email: string,
  data: {
    orderId: string;
    name: string;
    invoiceNumber: string;
    totalEur: number;
    dueAt: Date;
    iban: string;
    ibanName: string;
  }
) {
  const resend = getResend();
  if (!resend) return;

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Betaalverzoek — factuur ${data.invoiceNumber}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #1a6b6b;">Bedankt voor je bestelling, ${data.name}!</h1>
        <p style="font-size: 16px; line-height: 1.6;">
          We hebben je bestelling ontvangen. Maak het bedrag hieronder over — zodra de betaling
          binnen is versturen we je onderdelen.
        </p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 16px;">
          <tr><td style="padding:6px 0; color:#666;">Factuurnummer</td><td style="text-align:right; font-weight:bold;">${data.invoiceNumber}</td></tr>
          <tr><td style="padding:6px 0; color:#666;">Te betalen</td><td style="text-align:right; font-weight:bold;">€${data.totalEur.toFixed(2)}</td></tr>
          <tr><td style="padding:6px 0; color:#666;">IBAN</td><td style="text-align:right; font-weight:bold;">${data.iban}</td></tr>
          <tr><td style="padding:6px 0; color:#666;">Ten name van</td><td style="text-align:right;">${data.ibanName}</td></tr>
          <tr><td style="padding:6px 0; color:#666;">Omschrijving</td><td style="text-align:right;">${data.invoiceNumber}</td></tr>
          <tr><td style="padding:6px 0; color:#666;">Betalen voor</td><td style="text-align:right;">${data.dueAt.toLocaleDateString("nl-NL")}</td></tr>
        </table>
        <a href="${env.APP_URL}/bestelling/${data.orderId}" style="display: inline-block; background: #1a6b6b; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin-top: 24px;">
          Bekijk bestelling en factuur
        </a>
        <p style="margin-top: 24px; font-size: 13px; color: #666;">
          Vermeld altijd het factuurnummer als omschrijving, zodat we je betaling kunnen koppelen.
        </p>
      </div>
    `,
  });
}

export async function sendDiagnosisSummary(
  email: string,
  data: { brand: string; mainCause: string; confidence: number; recommendedAction: string }
) {
  const resend = getResend();
  if (!resend) return;

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Je wasmachine diagnose — ${data.brand}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #1a6b6b;">Diagnose samenvatting</h1>
        <div style="background: #f5f0e8; padding: 20px; border-radius: 8px; margin: 16px 0;">
          <p><strong>Merk:</strong> ${data.brand}</p>
          <p><strong>Hoofdoorzaak:</strong> ${data.mainCause}</p>
          <p><strong>Zekerheid:</strong> ${data.confidence}%</p>
        </div>
        <p style="font-size: 16px; line-height: 1.6;">
          <strong>Volgende stap:</strong> ${data.recommendedAction}
        </p>
      </div>
    `,
  });
}

export async function sendMonteurApplicationNotification(data: {
  applicationId: string;
  companyName: string;
  kvkNumber: string;
  vatNumber?: string;
  email: string;
  phone?: string;
  contactName: string;
  yearsExperience?: number;
  coverageAreas?: string[];
  specializations?: string[];
}) {
  const resend = getResend();
  if (!resend) return;

  await resend.emails.send({
    from: FROM,
    to: "monteur@wasfix.nl",
    replyTo: data.email,
    subject: `🔧 Monteur Pro aanmelding · ${data.applicationId}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1a6b6b;">Nieuwe Monteur Pro aanmelding</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 6px 0; color: #666; width: 40%;">Application ID:</td><td style="font-family: monospace; font-weight: 600;">${data.applicationId}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Bedrijfsnaam:</td><td>${data.companyName}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">KvK:</td><td>${data.kvkNumber}</td></tr>
          ${data.vatNumber ? `<tr><td style="padding: 6px 0; color: #666;">BTW:</td><td>${data.vatNumber}</td></tr>` : ""}
          <tr><td style="padding: 6px 0; color: #666;">Contact:</td><td>${data.contactName} &lt;${data.email}&gt;</td></tr>
          ${data.phone ? `<tr><td style="padding: 6px 0; color: #666;">Telefoon:</td><td>${data.phone}</td></tr>` : ""}
          ${data.yearsExperience != null ? `<tr><td style="padding: 6px 0; color: #666;">Ervaring:</td><td>${data.yearsExperience} jaar</td></tr>` : ""}
          ${data.coverageAreas?.length ? `<tr><td style="padding: 6px 0; color: #666;">Dekkingsgebied:</td><td>${data.coverageAreas.join(", ")}</td></tr>` : ""}
          ${data.specializations?.length ? `<tr><td style="padding: 6px 0; color: #666;">Specialisaties:</td><td>${data.specializations.join(", ")}</td></tr>` : ""}
        </table>
        <p style="margin-top: 20px; padding: 12px 14px; background: #f0f9f9; border-left: 3px solid #1a6b6b; border-radius: 4px; font-size: 13px;">
          Review handmatig via admin/monteur-applications, of beantwoord deze e-mail om met de aanvrager te corresponderen.
        </p>
      </div>
    `,
  });
}

export async function sendRmaNotification(data: {
  rmaNumber: string;
  orderId: string;
  name: string;
  email: string;
  reason: string;
  notes: string;
}) {
  const resend = getResend();
  if (!resend) return;

  // Send to internal team
  await resend.emails.send({
    from: FROM,
    to: "retour@wasfix.nl",
    replyTo: data.email,
    subject: `🔄 Nieuwe retour-aanvraag · ${data.rmaNumber}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1a6b6b; margin: 0 0 16px 0;">Nieuwe retour-aanvraag</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 6px 0; color: #666;">RMA-nummer:</td><td style="font-weight: 600; font-family: monospace;">${data.rmaNumber}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Bestelnummer:</td><td>${data.orderId}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Klant:</td><td>${data.name} &lt;${data.email}&gt;</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Reden:</td><td>${data.reason}</td></tr>
        </table>
        <h3 style="margin: 20px 0 8px 0; font-size: 14px;">Toelichting:</h3>
        <div style="background: #f7f7f7; border-left: 3px solid #1a6b6b; padding: 12px 14px; border-radius: 4px; font-size: 14px; line-height: 1.5;">${data.notes.replace(/\n/g, "<br>")}</div>
        <p style="margin-top: 24px; font-size: 12px; color: #888;">Beantwoord deze e-mail om met de klant te corresponderen — reply-to is ingesteld op de klant.</p>
      </div>
    `,
  });

  // Confirmation to customer
  await resend.emails.send({
    from: FROM,
    to: data.email,
    subject: `Retour-aanvraag ontvangen · ${data.rmaNumber}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #1a6b6b;">Retour-aanvraag ontvangen</h1>
        <p style="font-size: 16px; line-height: 1.6;">Hi ${data.name},</p>
        <p style="font-size: 16px; line-height: 1.6;">
          We hebben je retour-aanvraag in goede orde ontvangen. Je RMA-nummer is:
        </p>
        <div style="background: #f0f9f9; border: 1px solid #1a6b6b; padding: 14px 18px; border-radius: 8px; margin: 16px 0;">
          <div style="font-family: monospace; font-size: 18px; font-weight: 600; color: #1a6b6b;">${data.rmaNumber}</div>
        </div>
        <p style="font-size: 14px; line-height: 1.6;">
          Wat nu? Binnen 24 uur (op werkdagen) ontvang je een e-mail met retour-instructies, inclusief een verzendlabel als je in aanmerking komt voor gratis retour (defect of fout van onze kant).
        </p>
        <p style="font-size: 14px; line-height: 1.6;">
          Pak je product in originele verpakking met het RMA-nummer duidelijk op de buitenkant geschreven. Zodra wij het ontvangen verwerken wij de restitutie binnen 14 dagen.
        </p>
        <p style="font-size: 13px; color: #666; margin-top: 24px;">
          Vragen? Antwoord gewoon op deze e-mail — we reageren op werkdagen binnen 24 uur.
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
        <p style="font-size: 12px; color: #888;">${companyIdentityLine()}</p>
      </div>
    `,
  });
}

export async function sendSubscriptionConfirmation(email: string, plan: string) {
  const resend = getResend();
  if (!resend) return;

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Je ${plan} abonnement is actief`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #1a6b6b;">Welkom bij ${plan}!</h1>
        <p style="font-size: 16px; line-height: 1.6;">
          Je abonnement is actief. Je hebt nu toegang tot alle premium functies.
        </p>
        <a href="${env.APP_URL}/dashboard" style="display: inline-block; background: #1a6b6b; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none;">
          Naar mijn dashboard
        </a>
      </div>
    `,
  });
}
