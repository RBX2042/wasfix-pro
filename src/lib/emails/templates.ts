// Email template strings — single source of truth.
// Use these via src/lib/email.ts sendX() functions.
//
// To migrate to react-email: install @react-email/components + react-email,
// then re-implement these as JSX. Current templates are inline HTML for zero
// dependencies and fast Resend send-time.

import { catalogStats } from "../catalog-stats";

// Claims in outbound email must match the catalog too.
const CATALOG = catalogStats();

const FOOTER_HTML = `
  <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0 18px 0;" />
  <table style="width: 100%; font-size: 11.5px; color: #888; line-height: 1.5;">
    <tr><td>
      WasFix Pro B.V. · Hoofdstraat 1, 1234 AB Amsterdam · KvK 12345678<br />
      <a href="https://wasfix.nl/privacy" style="color: #888;">Privacy</a> ·
      <a href="https://wasfix.nl/voorwaarden" style="color: #888;">Voorwaarden</a> ·
      <a href="{{UNSUBSCRIBE}}" style="color: #888;">Unsubscribe</a>
    </td></tr>
  </table>
`;

function wrap(content: string, preheader: string = "") {
  return `
    <!DOCTYPE html>
    <html lang="nl">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>WasFix Pro</title>
    </head>
    <body style="margin: 0; padding: 0; background: #f7f7f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
      <span style="display: none; max-height: 0; overflow: hidden;">${preheader}</span>
      <table width="100%" cellpadding="0" cellspacing="0" style="background: #f7f7f9; padding: 32px 16px;">
        <tr><td align="center">
          <table width="100%" style="max-width: 580px; background: #fff; border-radius: 14px; padding: 36px 32px; box-shadow: 0 4px 20px -8px rgba(0,0,0,0.08);">
            <tr><td>
              <div style="display: inline-flex; align-items: center; gap: 10px; margin-bottom: 24px;">
                <div style="width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, #4f8cff, #00d4ff); display: inline-block;"></div>
                <span style="font-size: 17px; font-weight: 500; color: #0b1224;">WasFix <span style="color: #7b88a6;">Pro</span></span>
              </div>
              ${content}
              ${FOOTER_HTML}
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
  `;
}

// ─── 1. Welcome (na signup) ──────────────────────────────────────────
export function welcomeEmail(name: string) {
  return {
    subject: "Welkom bij WasFix Pro 🔧",
    html: wrap(`
      <h1 style="font-size: 24px; font-weight: 500; margin: 0 0 16px; color: #0b1224;">Welkom, ${name}!</h1>
      <p style="font-size: 15px; line-height: 1.7; color: #4a5568;">
        Bedankt voor je aanmelding. Je hebt nu toegang tot:
      </p>
      <ul style="font-size: 14.5px; line-height: 1.8; color: #4a5568; padding-left: 20px;">
        <li>3 gratis AI-diagnoses per maand — onbeperkt met Particulier (€4,99/mnd)</li>
        <li>${CATALOG.guides} stap-voor-stap reparatiegidsen</li>
        <li>${CATALOG.errorCodes} foutcodes van ${CATALOG.brands} merken</li>
        <li>${CATALOG.partsInStock} onderdelen op voorraad — voor 22:00 besteld, morgen in huis</li>
      </ul>
      <div style="margin: 28px 0;">
        <a href="https://wasfix.nl/diagnose" style="display: inline-block; background: linear-gradient(180deg, #5d97ff, #3b7aff); color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 500; font-size: 14px;">
          Start je eerste diagnose →
        </a>
      </div>
      <p style="font-size: 13.5px; line-height: 1.65; color: #6a7488;">
        Vragen? Antwoord op deze mail of bekijk ons <a href="https://wasfix.nl/help" style="color: #3b7aff;">helpcentrum</a>.
      </p>
    `, `Je WasFix Pro account is actief — start je eerste gratis diagnose`),
  };
}

// ─── 2. Cart abandonment (1u na verlaten) ────────────────────────────
export function cartAbandon1hEmail(name: string, items: Array<{ name: string; priceEur: number }>, recoverUrl: string) {
  const itemList = items.map((i) => `
    <tr><td style="padding: 6px 0; font-size: 14px; color: #4a5568;">
      ${i.name}
    </td><td style="padding: 6px 0; font-size: 14px; color: #0b1224; text-align: right; font-weight: 500;">
      € ${i.priceEur.toFixed(2).replace(".", ",")}
    </td></tr>
  `).join("");

  return {
    subject: `${name}, je winkelmand wacht op je 🛒`,
    html: wrap(`
      <h1 style="font-size: 22px; font-weight: 500; margin: 0 0 16px; color: #0b1224;">Hi ${name},</h1>
      <p style="font-size: 15px; line-height: 1.7; color: #4a5568;">
        Je hebt een paar onderdelen achtergelaten in je winkelmand. Wil je ze nog hebben? We houden ze 24u voor je vast.
      </p>
      <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">
        ${itemList}
      </table>
      <div style="margin: 24px 0;">
        <a href="${recoverUrl}" style="display: inline-block; background: linear-gradient(180deg, #5d97ff, #3b7aff); color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 500; font-size: 14px;">
          Maak je bestelling af →
        </a>
      </div>
      <p style="font-size: 13.5px; line-height: 1.65; color: #6a7488;">
        Twijfel je of dit het juiste onderdeel is? <a href="https://wasfix.nl/diagnose" style="color: #3b7aff;">Onze AI helpt je verifiëren</a>.
      </p>
    `, "Je onderdelen wachten — 24u houden we ze voor je vast"),
  };
}

// ─── 3. Cart abandonment 24u (laatste reminder met 10% korting) ──────
export function cartAbandon24hEmail(name: string, recoverUrl: string, discountCode = "TERUG10") {
  return {
    subject: "Laatste kans: 10% korting op je bestelling",
    html: wrap(`
      <h1 style="font-size: 22px; font-weight: 500; margin: 0 0 16px; color: #0b1224;">Hi ${name},</h1>
      <p style="font-size: 15px; line-height: 1.7; color: #4a5568;">
        Je winkelmand wordt vandaag leeggegooid (geen zorgen — de onderdelen blijven beschikbaar, alleen je selectie verdwijnt).
      </p>
      <p style="font-size: 15px; line-height: 1.7; color: #4a5568;">
        Om je over de streep te trekken: <strong>10% korting</strong> bij afrekenen. Geen verplichting.
      </p>
      <div style="margin: 20px 0; padding: 16px 20px; background: #f0f9ff; border-radius: 10px; text-align: center;">
        <div style="font-size: 12px; color: #6a7488; margin-bottom: 4px;">Vul deze code in bij afrekenen:</div>
        <div style="font-family: monospace; font-size: 22px; font-weight: 600; color: #3b7aff; letter-spacing: 0.05em;">${discountCode}</div>
      </div>
      <div style="margin: 24px 0;">
        <a href="${recoverUrl}" style="display: inline-block; background: linear-gradient(180deg, #5d97ff, #3b7aff); color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 500; font-size: 14px;">
          Activeer korting + bestel →
        </a>
      </div>
      <p style="font-size: 11.5px; color: #888;">
        Code is 24u geldig vanaf nu, geldt op alle onderdelen, niet combineerbaar met andere kortingen.
      </p>
    `, `Laatste reminder — ${discountCode} geeft je 10% korting`),
  };
}

// ─── 4. Post-diagnose follow-up ──────────────────────────────────────
export function postDiagnoseEmail(name: string, diagnoseTitle: string, partUrls: string[]) {
  return {
    subject: `Hoe is het gegaan met je ${diagnoseTitle}? 🔧`,
    html: wrap(`
      <h1 style="font-size: 22px; font-weight: 500; margin: 0 0 16px; color: #0b1224;">Hi ${name},</h1>
      <p style="font-size: 15px; line-height: 1.7; color: #4a5568;">
        Een paar dagen geleden heb je een diagnose voor "${diagnoseTitle}" gedaan. Hoe is het gegaan?
      </p>
      <p style="font-size: 15px; line-height: 1.7; color: #4a5568;">
        Heb je het onderdeel besteld? Of gefixt op een andere manier? We zijn benieuwd — antwoord op deze mail, of:
      </p>
      ${partUrls.length > 0 ? `
        <div style="margin: 20px 0; padding: 16px; background: #f7f9fc; border-radius: 10px;">
          <div style="font-size: 13px; color: #4a5568; margin-bottom: 8px;">Nog niet besteld? Hier zijn de aanbevolen onderdelen:</div>
          ${partUrls.map((url) => `<div style="margin: 4px 0;"><a href="${url}" style="color: #3b7aff; font-size: 13px;">${url}</a></div>`).join("")}
        </div>
      ` : ""}
      <p style="font-size: 13.5px; line-height: 1.65; color: #6a7488;">
        Niet gelukt? Stuur een foto naar support@wasfix.nl — we helpen je verder.
      </p>
    `, "Hoe ging je reparatie? We zijn benieuwd."),
  };
}

// ─── 5. Lead magnet delivery (na exit-intent of blog signup) ────────
export function leadMagnetEmail(pdfUrl: string) {
  return {
    subject: "Jouw gratis wasmachine-foutcodes cheatsheet 📥",
    html: wrap(`
      <h1 style="font-size: 22px; font-weight: 500; margin: 0 0 16px; color: #0b1224;">Hier is je cheatsheet</h1>
      <p style="font-size: 15px; line-height: 1.7; color: #4a5568;">
        De 25 meest voorkomende wasmachine-foutcodes — voor alle grote merken — met directe oplossing per code. Print 'm uit en plak 'm naast de wasmachine.
      </p>
      <div style="margin: 28px 0; text-align: center;">
        <a href="${pdfUrl}" style="display: inline-block; background: linear-gradient(180deg, #5d97ff, #3b7aff); color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 500; font-size: 15px;">
          📥 Download PDF (2.4 MB)
        </a>
      </div>
      <p style="font-size: 13.5px; line-height: 1.65; color: #6a7488;">
        Ook in deze mail:
      </p>
      <ul style="font-size: 13.5px; line-height: 1.8; color: #4a5568; padding-left: 20px;">
        <li><a href="https://wasfix.nl/diagnose" style="color: #3b7aff;">Gratis AI-diagnose</a> — als je code niet in de PDF staat</li>
        <li><a href="https://wasfix.nl/foutcodes" style="color: #3b7aff;">Volledige foutcodes-database</a> — 331 codes, per merk doorzoekbaar</li>
        <li><a href="https://wasfix.nl/gidsen" style="color: #3b7aff;">26 reparatiegidsen</a> — stap-voor-stap met foto's</li>
      </ul>
      <p style="font-size: 12px; line-height: 1.6; color: #888; margin-top: 20px;">
        Je staat nu op onze (rustige) nieuwsbrief — 1× per week trending defects + tips. Altijd opzegbaar onderaan elke mail.
      </p>
    `, "Hier is je gratis foutcodes cheatsheet (PDF)"),
  };
}
