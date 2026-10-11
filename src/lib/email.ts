/**
 * Transactional e-mail.
 *
 * CONTRACT
 *   Every sender returns Promise<MailResult> = {ok: boolean, error?: string, id?: string}
 *   and NEVER throws. ok === true means Resend accepted the message. Anything
 *   that tells a customer or the owner "an e-mail was sent" must check it.
 *
 *   sendMail(opts)                       the single wrapper behind every sender
 *   getResend(), FROM                    re-exported for code that talks to Resend directly
 *
 *   Customer mails (every link carries the guest token when one is passed, see
 *   customerOrderUrl in ./order-status):
 *     sendWelcomeEmail(email, name)
 *     sendOrderConfirmation(email, data)             demo / no-database checkout
 *     sendBankTransferInstructions(email, data)      refuses without a ready company identity in production
 *     sendStripeOrderConfirmation(email, data)       Stripe order paid: lines, total, invoice number, order link
 *     sendPaymentReceivedEmail(email, data)          bank transfer confirmed ("betaling ontvangen")
 *     sendOrderShippedEmail(email, data)             carrier + code + tracking link (PostNL, DHL, DPD, UPS, GLS)
 *     sendOrderCancelledEmail(email, data)           mentions the credit note when there is one, with a link to the document
 *     sendRefundEmail(email, data)                   refund confirmation with the credit note number and link; "teruggestort" only
 *                                                    when data.via is "stripe", otherwise the wording says the owner still wires it
 *     sendOrderMailForOrder(orderId, kind)           (re)send one order mail from what is stored: "bank-instructions",
 *                                                    "order-paid" (Stripe) or "payment-received" (bank). Sends only; changes nothing.
 *     sendBankTransferInstructionsForOrder(orderId)  the instructions mail of a bank-transfer order, loaded by id, so a caller can
 *                                                    run it again later (order desk); the checkout awaits its own send so the page can say honestly whether it went out
 *     sendDiagnosisSummary(email, data)
 *     sendSubscriptionConfirmation(email, plan)
 *     sendRmaNotification(data)                      owner alert + customer acknowledgement
 *     sendMonteurApplicationNotification(data)       owner alert
 *   ownerEmailAddress()                  ORDER_NOTIFY_EMAIL ?? COMPANY_EMAIL (as configured), else null
 *
 * BEHAVIOUR
 *   - Resend RETURNS {error} for an invalid key or an unverified sending
 *     domain instead of throwing; sendRaw (./emails/transport) reads it.
 *   - A failed send is logged at error level (template name only, never the
 *     address) and escalated through notifyOwner, so a dropped payment
 *     instruction reaches the owner. When the mail belongs to an order the alert
 *     names the order reference (never the customer), so the owner knows whose
 *     mail to resend from the order desk.
 *   - Without RESEND_API_KEY a send is logged ("e-mail skipped") and returns
 *     {ok: false, error: "no_resend_key"}; the owner is warned once per process.
 *   - Customer mails set replyTo to COMPANY_EMAIL when it is configured,
 *     because the texts say "antwoord op deze e-mail" and the From address is a
 *     no-reply. Without COMPANY_EMAIL no replyTo is set: the built-in default
 *     address is an invention and must not receive customers' replies.
 *   - The owner alerts (RMA, monteur application) go to ownerEmailAddress().
 *     When none is configured they cannot be mailed; the owner is then told
 *     through notify.ts (RMA/application number and an admin link only) and the
 *     function reports {ok:false, error:"no_owner_address"} for that alert.
 *   - Customer-facing bodies end with companyIdentityLine(), which prints only
 *     what is really registered. The two owner alerts (RMA, monteur) do not.
 */
import { env } from "./env";
import { logger } from "./logger";
import { prisma } from "./prisma";
import { companyReadiness, SUPPORT_RESPONSE_WORKDAYS } from "./plans";
import { creditNoteUrl, customerOrderUrl, orderRef, returnUrl } from "./order-status";
import { notifyOwner } from "./notify";
import { getResend, FROM, sendRaw, type MailResult } from "./emails/transport";
import { esc, eur, button, shell, lineTable, type MailLine } from "./emails/layout";
import { trackingUrl, carrierLabel } from "./emails/tracking";

export { getResend, FROM };
export type { MailResult };

/**
 * Where owner-facing mail goes: only an address somebody configured. The
 * default COMPANY.email (support@wasfix.nl) is a placeholder that nothing proves
 * is a mailbox, so it is never used as a destination.
 */
export function ownerEmailAddress(): string | null {
  return env.ORDER_NOTIFY_EMAIL ?? env.COMPANY_EMAIL ?? null;
}

/** An owner alert that cannot be mailed: tell the owner through the other channels, without personal data. */
async function ownerAlertUnmailable(template: string, title: string, ref: string): Promise<MailResult> {
  logger.warn("[email] owner alert not mailed: neither ORDER_NOTIFY_EMAIL nor COMPANY_EMAIL is set", { template });
  await notifyOwner({
    event: `${template}.unmailed`,
    level: "warn",
    title,
    lines: [ref, "Stel ORDER_NOTIFY_EMAIL of COMPANY_EMAIL in om deze meldingen ook per e-mail te ontvangen."],
    url: "/admin/aanvragen",
  });
  return { ok: false, error: "no_owner_address" };
}

let warnedNoKey = false;

export type SendMailOptions = {
  /** Short template name for logs and the owner alert. No address, no order id. */
  template: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Defaults to the configured COMPANY_EMAIL (none when unset) so a customer's reply reaches a person. */
  replyTo?: string;
  /** The short order number ("#" + this) when the mail belongs to an order. Goes into the failure alert, instead of the customer. */
  orderRef?: string;
  /** Extra message headers, passed to Resend as given: the RFC 8058 List-Unsubscribe pair on the newsletter mails (src/lib/newsletter.ts). */
  headers?: Record<string, string>;
};

export async function sendMail(opts: SendMailOptions): Promise<MailResult> {
  try {
    if (!getResend()) {
      logger.warn("[email] skipped: no RESEND_API_KEY", { template: opts.template });
      if (!warnedNoKey) {
        warnedNoKey = true;
        await notifyOwner({
          event: "email.not_configured",
          level: "warn",
          title: "E-mails worden niet verstuurd",
          lines: ["RESEND_API_KEY ontbreekt: klanten ontvangen geen betaalgegevens, bevestigingen of verzendberichten."],
        });
      }
      return { ok: false, error: "no_resend_key" };
    }
    const result = await sendRaw({
      template: opts.template,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      replyTo: opts.replyTo ?? env.COMPANY_EMAIL,
      ...(opts.headers ? { headers: opts.headers } : {}),
    });
    if (!result.ok) {
      // sendRaw already logged the cause. The owner needs to hear about it too:
      // the IBAN mail is the guest's only durable copy of how to pay.
      await notifyOwner({
        event: "email.failed",
        level: "error",
        title: `E-mail niet verstuurd (${opts.template})${opts.orderRef ? ` voor bestelling #${opts.orderRef}` : ""}`,
        lines: [
          ...(opts.orderRef ? [`Bestelling #${opts.orderRef}: stuur de mail opnieuw vanaf de bestelkaart in het beheer.`] : []),
          `Reden: ${result.error ?? "onbekend"}`,
          "Controleer RESEND_API_KEY en of het verzenddomein in Resend is geverifieerd.",
        ],
        ...(opts.orderRef ? { url: "/admin/bestellingen" } : {}),
      });
    }
    return result;
  } catch (err) {
    logger.error("[email] unexpected failure", { template: opts.template, err });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Account ─────────────────────────────────────────────────────────

export async function sendWelcomeEmail(email: string, name: string): Promise<MailResult> {
  return sendMail({
    template: "welcome",
    to: email,
    subject: "Welkom bij WasFix Pro!",
    html: shell(`
        <h1 style="color: #1a6b6b; font-size: 28px;">Welkom bij WasFix Pro, ${esc(name)}!</h1>
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
        ${button(`${env.APP_URL}/diagnose`, "Start je eerste diagnose")}
        <p style="margin-top: 32px; font-size: 13px; color: #666;">
          Vragen? Antwoord op deze e-mail.
        </p>`),
  });
}

export async function sendSubscriptionConfirmation(email: string, plan: string): Promise<MailResult> {
  return sendMail({
    template: "subscription-confirmation",
    to: email,
    subject: `Je ${plan} abonnement is actief`,
    html: shell(`
        <h1 style="color: #1a6b6b;">Welkom bij ${esc(plan)}!</h1>
        <p style="font-size: 16px; line-height: 1.6;">
          Je abonnement is actief. Je hebt nu toegang tot alle premium functies.
        </p>
        ${button(`${env.APP_URL}/dashboard`, "Naar mijn dashboard")}`),
  });
}

export async function sendDiagnosisSummary(
  email: string,
  data: { brand: string; mainCause: string; confidence?: number | null; recommendedAction: string },
): Promise<MailResult> {
  // A confidence figure is printed only when the caller really has one: the
  // keyword fallback has none, and inventing it would be a false claim.
  const confidence =
    typeof data.confidence === "number" ? `<p><strong>Zekerheid (indicatie):</strong> ${data.confidence}%</p>` : "";
  return sendMail({
    template: "diagnosis-summary",
    to: email,
    subject: `Je wasmachine diagnose — ${data.brand}`,
    html: shell(`
        <h1 style="color: #1a6b6b;">Diagnose samenvatting</h1>
        <div style="background: #f5f0e8; padding: 20px; border-radius: 8px; margin: 16px 0;">
          <p><strong>Merk:</strong> ${esc(data.brand)}</p>
          <p><strong>Hoofdoorzaak:</strong> ${esc(data.mainCause)}</p>
          ${confidence}
        </div>
        <p style="font-size: 16px; line-height: 1.6;">
          <strong>Volgende stap:</strong> ${esc(data.recommendedAction)}
        </p>
        <p style="font-size: 12px; color: #888;">Dit is een indicatie, geen garantie. Controleer de oorzaak voordat je een onderdeel bestelt of vervangt.</p>`),
  });
}

// ─── Orders ──────────────────────────────────────────────────────────

type OrderMailBase = {
  orderId: string;
  name: string;
  /** Order.accessToken. Without it the link only works for a signed-in owner. */
  accessToken?: string | null;
};

/** Demo / no-database checkout only: a real order goes through the senders below. */
export async function sendOrderConfirmation(
  email: string,
  data: OrderMailBase & { items: MailLine[]; total: number },
): Promise<MailResult> {
  return sendMail({
    template: "order-confirmation",
    orderRef: orderRef(data.orderId),
    to: email,
    subject: `Bestelling bevestigd #${orderRef(data.orderId)}`,
    html: shell(`
        <h1 style="color: #1a6b6b;">Bedankt voor je bestelling, ${esc(data.name)}!</h1>
        <p style="font-size: 16px; line-height: 1.6;">
          We hebben je bestelling ontvangen.
        </p>
        <p style="font-size: 14px;"><strong>Bestelnummer:</strong> #${esc(orderRef(data.orderId))}</p>
        ${lineTable(data.items, data.total)}
        ${button(customerOrderUrl(data.orderId, data.accessToken), "Bekijk bestelling")}`),
  });
}

/** A Stripe order whose payment has been confirmed. */
export async function sendStripeOrderConfirmation(
  email: string,
  data: OrderMailBase & { items: MailLine[]; totalEur: number; invoiceNumber?: string | null },
): Promise<MailResult> {
  const url = customerOrderUrl(data.orderId, data.accessToken);
  return sendMail({
    template: "order-paid-stripe",
    orderRef: orderRef(data.orderId),
    to: email,
    subject: `Betaling ontvangen — bestelling #${orderRef(data.orderId)}`,
    html: shell(`
        <h1 style="color: #1a6b6b;">Bedankt voor je bestelling, ${esc(data.name)}!</h1>
        <p style="font-size: 16px; line-height: 1.6;">
          Je betaling is ontvangen. We maken je bestelling klaar voor verzending; zodra het pakket onderweg is krijg je een e-mail met de gegevens van de vervoerder.
        </p>
        <p style="font-size: 14px;"><strong>Bestelnummer:</strong> #${esc(orderRef(data.orderId))}${data.invoiceNumber ? `<br><strong>Factuurnummer:</strong> ${esc(data.invoiceNumber)}` : ""}</p>
        ${lineTable(data.items, data.totalEur)}
        ${button(url, data.invoiceNumber ? "Bekijk bestelling en factuur" : "Bekijk bestelling")}
        <p style="margin-top: 24px; font-size: 13px; color: #666;">
          Als consument heb je een wettelijk herroepingsrecht. De voorwaarden vind je in onze <a href="${env.APP_URL}/retourvoorwaarden" style="color:#1a6b6b;">retourvoorwaarden</a>.
        </p>`),
  });
}

export async function sendBankTransferInstructions(
  email: string,
  data: OrderMailBase & {
    invoiceNumber: string;
    totalEur: number;
    dueAt: Date;
    iban: string;
    ibanName: string;
  },
): Promise<MailResult> {
  // Wire instructions are a promise about where money goes. Never send them
  // while the seller identity is incomplete: that is how an IBAN that does not
  // exist reached customers.
  if (env.IS_PRODUCTION && !companyReadiness().ready) {
    logger.error("[email] bank-transfer instructions refused: company identity is not ready");
    return { ok: false, error: "company_not_ready" };
  }
  return sendMail({
    template: "bank-transfer-instructions",
    orderRef: orderRef(data.orderId),
    to: email,
    subject: `Betaalverzoek — factuur ${data.invoiceNumber}`,
    html: shell(`
        <h1 style="color: #1a6b6b;">Bedankt voor je bestelling, ${esc(data.name)}!</h1>
        <p style="font-size: 16px; line-height: 1.6;">
          We hebben je bestelling ontvangen. Maak het bedrag hieronder over — zodra de betaling
          binnen is versturen we je onderdelen.
        </p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 16px;">
          <tr><td style="padding:6px 0; color:#666;">Factuurnummer</td><td style="text-align:right; font-weight:bold;">${esc(data.invoiceNumber)}</td></tr>
          <tr><td style="padding:6px 0; color:#666;">Te betalen</td><td style="text-align:right; font-weight:bold;">${eur(data.totalEur)}</td></tr>
          <tr><td style="padding:6px 0; color:#666;">IBAN</td><td style="text-align:right; font-weight:bold;">${esc(data.iban)}</td></tr>
          <tr><td style="padding:6px 0; color:#666;">Ten name van</td><td style="text-align:right;">${esc(data.ibanName)}</td></tr>
          <tr><td style="padding:6px 0; color:#666;">Omschrijving</td><td style="text-align:right;">${esc(data.invoiceNumber)}</td></tr>
          <tr><td style="padding:6px 0; color:#666;">Betalen voor</td><td style="text-align:right;">${data.dueAt.toLocaleDateString("nl-NL")}</td></tr>
        </table>
        ${button(customerOrderUrl(data.orderId, data.accessToken), "Bekijk bestelling en factuur")}
        <p style="margin-top: 24px; font-size: 13px; color: #666;">
          Vermeld altijd het factuurnummer als omschrijving, zodat we je betaling kunnen koppelen.
        </p>`),
  });
}

/** The wire has arrived and an admin confirmed it. */
export async function sendPaymentReceivedEmail(
  email: string,
  data: OrderMailBase & { totalEur: number; invoiceNumber?: string | null },
): Promise<MailResult> {
  return sendMail({
    template: "payment-received",
    orderRef: orderRef(data.orderId),
    to: email,
    subject: `Betaling ontvangen — bestelling #${orderRef(data.orderId)}`,
    html: shell(`
        <h1 style="color: #1a6b6b;">We hebben je betaling ontvangen</h1>
        <p style="font-size: 16px; line-height: 1.6;">Hi ${esc(data.name)}, bedankt: we hebben ${eur(data.totalEur)} ontvangen voor bestelling #${esc(orderRef(data.orderId))}${data.invoiceNumber ? ` (factuur ${esc(data.invoiceNumber)})` : ""}.</p>
        <p style="font-size: 16px; line-height: 1.6;">
          We maken je bestelling klaar voor verzending. Zodra het pakket onderweg is krijg je een e-mail met de gegevens van de vervoerder.
        </p>
        ${button(customerOrderUrl(data.orderId, data.accessToken), "Bekijk bestelling en factuur")}`),
  });
}

export async function sendOrderShippedEmail(
  email: string,
  data: OrderMailBase & { carrier: string; trackingCode: string; postalCode?: string | null },
): Promise<MailResult> {
  const link = trackingUrl(data.carrier, data.trackingCode, data.postalCode);
  const who = carrierLabel(data.carrier);
  return sendMail({
    template: "order-shipped",
    orderRef: orderRef(data.orderId),
    to: email,
    subject: `Je bestelling #${orderRef(data.orderId)} is verzonden`,
    html: shell(`
        <h1 style="color: #1a6b6b;">Je bestelling is onderweg</h1>
        <p style="font-size: 16px; line-height: 1.6;">Hi ${esc(data.name)}, bestelling #${esc(orderRef(data.orderId))} is verzonden met ${esc(who)}.</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 16px;">
          <tr><td style="padding:6px 0; color:#666;">Vervoerder</td><td style="text-align:right;">${esc(who)}</td></tr>
          <tr><td style="padding:6px 0; color:#666;">Trackingcode</td><td style="text-align:right; font-family: monospace; font-weight:bold;">${esc(data.trackingCode)}</td></tr>
        </table>
        ${link ? button(link, "Volg je pakket") : `<p style="font-size:14px; color:#666;">Volg je pakket met de trackingcode op de website van ${esc(who)}.</p>`}
        <p style="margin-top: 16px;"><a href="${esc(customerOrderUrl(data.orderId, data.accessToken))}" style="color:#1a6b6b; font-size:14px;">Bekijk bestelling</a></p>
        <p style="margin-top: 8px; font-size:13px; color:#666;">Past het onderdeel niet of heb je het niet nodig? Je hebt 30 dagen bedenktijd: <a href="${esc(returnUrl(data.orderId, data.accessToken))}" style="color:#1a6b6b;">retour aanvragen</a>.</p>`),
  });
}

export async function sendOrderCancelledEmail(
  email: string,
  data: OrderMailBase & {
    /** What the customer is told. Leave empty rather than pass an internal note. */
    reason?: string | null;
    /** The order had been paid, so money goes back. */
    wasPaid: boolean;
    creditNoteNumber?: string | null;
    refundEur?: number | null;
  },
): Promise<MailResult> {
  const money =
    data.wasPaid && data.refundEur
      ? `<p style="font-size: 16px; line-height: 1.6;">Het betaalde bedrag van ${eur(data.refundEur)} krijg je terug.</p>`
      : `<p style="font-size: 16px; line-height: 1.6;">Je hoeft niets meer te betalen. Heb je het bedrag al overgemaakt? Antwoord dan op deze e-mail, dan regelen we de terugbetaling.</p>`;
  // The credit note is a document of its own (terms 7.1 promise "een creditfactuur"): link it.
  const credit = data.creditNoteNumber
    ? `<p style="font-size: 14px; color:#444;">De factuur is gecorrigeerd met creditfactuur ${esc(data.creditNoteNumber)}. <a href="${esc(creditNoteUrl(data.orderId, data.creditNoteNumber, data.accessToken))}" style="color:#1a6b6b;">Bekijk de creditfactuur</a>.</p>`
    : "";
  return sendMail({
    template: "order-cancelled",
    orderRef: orderRef(data.orderId),
    to: email,
    subject: `Bestelling #${orderRef(data.orderId)} is geannuleerd`,
    html: shell(`
        <h1 style="color: #1a6b6b;">Je bestelling is geannuleerd</h1>
        <p style="font-size: 16px; line-height: 1.6;">Hi ${esc(data.name)}, bestelling #${esc(orderRef(data.orderId))} is geannuleerd.${data.reason ? ` Reden: ${esc(data.reason)}` : ""}</p>
        ${money}
        ${credit}
        ${button(customerOrderUrl(data.orderId, data.accessToken), "Bekijk bestelling")}
        <p style="margin-top: 24px; font-size: 13px; color: #666;">Vragen? Antwoord op deze e-mail.</p>`),
  });
}

export async function sendRefundEmail(
  email: string,
  data: OrderMailBase & {
    amountEur: number;
    creditNoteNumber: string;
    partial: boolean;
    /**
     * How the money goes back. "stripe": a Stripe refund exists, so it IS sent
     * ("teruggestort"). "bank" (the default): the credit note is issued but the
     * owner still has to wire the money, so the mail must not say it was done.
     */
    via?: "stripe" | "bank";
  },
): Promise<MailResult> {
  const stripe = data.via === "stripe";
  const lead = stripe
    ? `we hebben ${eur(data.amountEur)} teruggestort voor bestelling #${esc(orderRef(data.orderId))}. Dit gebeurt op de rekening of kaart waarmee je hebt betaald.`
    : `voor bestelling #${esc(orderRef(data.orderId))} is een creditfactuur van ${eur(data.amountEur)} uitgegeven. Het bedrag maken we over op de rekening waarvan je hebt betaald. Je hoeft zelf niets te doen. Gaat het om een herroeping, dan staat het bedrag uiterlijk 14 dagen na je melding op je rekening, zoals in onze voorwaarden staat.`;
  return sendMail({
    template: "refund",
    orderRef: orderRef(data.orderId),
    to: email,
    subject: stripe ? `Terugbetaling voor bestelling #${orderRef(data.orderId)}` : `Creditfactuur voor bestelling #${orderRef(data.orderId)}`,
    html: shell(`
        <h1 style="color: #1a6b6b;">${stripe ? (data.partial ? "Deel van je bestelling is terugbetaald" : "Je bestelling is terugbetaald") : data.partial ? "Je krijgt een deel van je bestelling terug" : "Je krijgt je bestelling terug"}</h1>
        <p style="font-size: 16px; line-height: 1.6;">Hi ${esc(data.name)}, ${lead}</p>
        <p style="font-size: 14px; color:#444;">Creditfactuur: ${esc(data.creditNoteNumber)}. <a href="${esc(creditNoteUrl(data.orderId, data.creditNoteNumber, data.accessToken))}" style="color:#1a6b6b;">Bekijk de creditfactuur</a>.</p>
        ${button(customerOrderUrl(data.orderId, data.accessToken), "Bekijk bestelling")}
        <p style="margin-top: 24px; font-size: 13px; color: #666;">Vragen? Antwoord op deze e-mail.</p>`),
  });
}

// ─── Resend, from what is stored ─────────────────────────────────────

export type OrderMailKind = "bank-instructions" | "order-paid" | "payment-received";

export const ORDER_MAIL_LABEL: Record<OrderMailKind, string> = {
  "bank-instructions": "betaalinstructies",
  "order-paid": "bevestiging",
  "payment-received": "betaling-ontvangen-mail",
};

const PAID_STATES = ["PAID", "SHIPPED", "DELIVERED"];

/**
 * Send one of the three order mails again, built from what the database holds
 * now, and nothing else: no status changes, no stock, no invoice. Safe to call
 * any number of times; the caller rate-limits (the order desk does).
 *
 * Refuses (ok:false, error "not_applicable") when the order is not in the state
 * that mail belongs to, so a wrong button cannot mail "betaling ontvangen" for
 * an unpaid order or the IBAN of a cancelled one.
 */
export async function sendOrderMailForOrder(orderId: string, kind: OrderMailKind): Promise<MailResult> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { part: { select: { name: true } } } }, invoice: { select: { number: true, sellerJson: true } } },
    });
    if (!order) return { ok: false, error: "not_found" };
    const name = (() => {
      try {
        return (JSON.parse(order.shippingAddress)?.name as string | undefined)?.trim() || "klant";
      } catch {
        return "klant";
      }
    })();
    const common = { orderId: order.id, name, accessToken: order.accessToken };

    if (kind === "bank-instructions") {
      if (order.paymentMethod !== "BANK_TRANSFER" || order.status !== "OPENSTAAND" || !order.invoice || !order.dueAt) return { ok: false, error: "not_applicable" };
      let seller: { iban?: string; name?: string } = {};
      try {
        seller = JSON.parse(order.invoice.sellerJson) ?? {};
      } catch {
        /* the sender below refuses an empty IBAN in production through the readiness check */
      }
      return await sendBankTransferInstructions(order.email, {
        ...common,
        invoiceNumber: order.invoice.number,
        totalEur: order.totalEur,
        dueAt: order.dueAt,
        iban: seller.iban ?? "",
        ibanName: seller.name ?? "",
      });
    }
    if (kind === "order-paid") {
      if (order.paymentMethod !== "STRIPE" || !PAID_STATES.includes(order.status)) return { ok: false, error: "not_applicable" };
      return await sendStripeOrderConfirmation(order.email, {
        ...common,
        invoiceNumber: order.invoice?.number ?? null,
        totalEur: order.totalEur,
        items: order.items.map((i) => ({ name: i.part.name, quantity: i.quantity, total: Math.round(i.unitPrice * i.quantity * 100) / 100 })),
      });
    }
    if (order.paymentMethod !== "BANK_TRANSFER" || !PAID_STATES.includes(order.status)) return { ok: false, error: "not_applicable" };
    return await sendPaymentReceivedEmail(order.email, { ...common, invoiceNumber: order.invoice?.number ?? null, totalEur: order.totalEur });
  } catch (err) {
    logger.error("[email] could not resend an order mail", { kind, err });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The payment instructions of a bank-transfer order, loaded by id, for a caller that
 * has no request data at hand. The order desk runs it from "stuur betaalinstructies
 * opnieuw". The checkout deliberately does NOT run it after its response:
 * src/app/api/checkout/route.ts awaits sendBankTransferInstructions inline, because the
 * confirmation page only says "we hebben de instructies gemaild" when the provider really
 * accepted the mail. The price is that a hung provider holds the customer for at most
 * the 10 s Resend timeout plus the owner notice; the instructions are on the order page
 * either way. Returns the MailResult; never throws.
 */
export function sendBankTransferInstructionsForOrder(orderId: string): Promise<MailResult> {
  return sendOrderMailForOrder(orderId, "bank-instructions");
}

// ─── Forms that reach the owner ──────────────────────────────────────

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
}): Promise<MailResult> {
  // Goes to the owner's own address (ORDER_NOTIFY_EMAIL, else COMPANY_EMAIL),
  // not to a monteur@ mailbox that nothing in this repo creates. replyTo is the
  // applicant so "beantwoord" reaches them.
  const to = ownerEmailAddress();
  if (!to) return ownerAlertUnmailable("monteur-application", "Nieuwe Monteur Pro aanmelding", `Aanmelding ${data.applicationId}`);
  return sendMail({
    template: "monteur-application",
    to,
    replyTo: data.email,
    subject: `Monteur Pro aanmelding · ${data.applicationId}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1a6b6b;">Nieuwe Monteur Pro aanmelding</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 6px 0; color: #666; width: 40%;">Application ID:</td><td style="font-family: monospace; font-weight: 600;">${esc(data.applicationId)}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Bedrijfsnaam:</td><td>${esc(data.companyName)}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">KvK:</td><td>${esc(data.kvkNumber)}</td></tr>
          ${data.vatNumber ? `<tr><td style="padding: 6px 0; color: #666;">BTW:</td><td>${esc(data.vatNumber)}</td></tr>` : ""}
          <tr><td style="padding: 6px 0; color: #666;">Contact:</td><td>${esc(data.contactName)} &lt;${esc(data.email)}&gt;</td></tr>
          ${data.phone ? `<tr><td style="padding: 6px 0; color: #666;">Telefoon:</td><td>${esc(data.phone)}</td></tr>` : ""}
          ${data.yearsExperience != null ? `<tr><td style="padding: 6px 0; color: #666;">Ervaring:</td><td>${data.yearsExperience} jaar</td></tr>` : ""}
          ${data.coverageAreas?.length ? `<tr><td style="padding: 6px 0; color: #666;">Dekkingsgebied:</td><td>${esc(data.coverageAreas.join(", "))}</td></tr>` : ""}
          ${data.specializations?.length ? `<tr><td style="padding: 6px 0; color: #666;">Specialisaties:</td><td>${esc(data.specializations.join(", "))}</td></tr>` : ""}
        </table>
        <p style="margin-top: 20px; padding: 12px 14px; background: #f0f9f9; border-left: 3px solid #1a6b6b; border-radius: 4px; font-size: 13px;">
          Beoordeel de aanmelding in het beheer onder Aanvragen, of beantwoord deze e-mail om met de aanvrager te corresponderen.
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
}): Promise<MailResult> {
  const ownerTo = ownerEmailAddress();
  const owner = ownerTo
    ? await sendMail({
      template: "rma-owner-alert",
      to: ownerTo,
      replyTo: data.email,
      subject: `Nieuwe retour-aanvraag · ${data.rmaNumber}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1a6b6b; margin: 0 0 16px 0;">Nieuwe retour-aanvraag</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding: 6px 0; color: #666;">RMA-nummer:</td><td style="font-weight: 600; font-family: monospace;">${esc(data.rmaNumber)}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Bestelnummer:</td><td>${esc(data.orderId)}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Klant:</td><td>${esc(data.name)} &lt;${esc(data.email)}&gt;</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Reden:</td><td>${esc(data.reason)}</td></tr>
          </table>
          <h3 style="margin: 20px 0 8px 0; font-size: 14px;">Toelichting:</h3>
          <div style="background: #f7f7f7; border-left: 3px solid #1a6b6b; padding: 12px 14px; border-radius: 4px; font-size: 14px; line-height: 1.5;">${esc(data.notes).replace(/\n/g, "<br>")}</div>
          <p style="margin-top: 24px; font-size: 12px; color: #888;">Beantwoord deze e-mail om met de klant te corresponderen — reply-to is ingesteld op de klant.</p>
        </div>
      `,
      })
    : await ownerAlertUnmailable("rma-owner-alert", "Nieuwe retour-aanvraag", `RMA ${data.rmaNumber}`);

  const customer = await sendMail({
    template: "rma-acknowledgement",
    to: data.email,
    subject: `Retour-aanvraag ontvangen · ${data.rmaNumber}`,
    html: shell(`
        <h1 style="color: #1a6b6b;">Retour-aanvraag ontvangen</h1>
        <p style="font-size: 16px; line-height: 1.6;">Hi ${esc(data.name)},</p>
        <p style="font-size: 16px; line-height: 1.6;">
          We hebben je retour-aanvraag in goede orde ontvangen. Je RMA-nummer is:
        </p>
        <div style="background: #f0f9f9; border: 1px solid #1a6b6b; padding: 14px 18px; border-radius: 8px; margin: 16px 0;">
          <div style="font-family: monospace; font-size: 18px; font-weight: 600; color: #1a6b6b;">${esc(data.rmaNumber)}</div>
        </div>
        <p style="font-size: 14px; line-height: 1.6;">
          Wat nu? Binnen ${SUPPORT_RESPONSE_WORKDAYS} werkdagen ontvang je een e-mail met retour-instructies. Kosten van het terugsturen staan in onze retourvoorwaarden.
        </p>
        <p style="font-size: 14px; line-height: 1.6;">
          Pak je product in originele verpakking met het RMA-nummer duidelijk op de buitenkant geschreven. Zodra wij het ontvangen verwerken wij de restitutie binnen 14 dagen.
        </p>
        <p style="font-size: 13px; color: #666; margin-top: 24px;">
          Vragen? Antwoord gewoon op deze e-mail — we reageren binnen ${SUPPORT_RESPONSE_WORKDAYS} werkdagen.
        </p>`),
  });
  // The customer's acknowledgement is what the form promises; the owner alert
  // failing is reported through sendMail but does not make the customer's mail a failure.
  return customer.ok ? { ok: true, id: customer.id } : { ok: false, error: customer.error ?? owner.error };
}
