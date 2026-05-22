import { Resend } from "resend";
import { env } from "./env";

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
