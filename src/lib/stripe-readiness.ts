/**
 * Is Stripe set up well enough to take real money?
 *
 * checkStripeReadiness() asks Stripe (read-only calls, nothing is created) and
 * reports each prerequisite as {ok, detail, fix}. Meant for the go-live
 * preflight script and for a scheduled check; the same price rules and event
 * list as the code that sells and handles them are used (src/lib/subscription.ts,
 * src/lib/stripe-events.ts), so the check cannot approve something the checkout
 * would refuse.
 *
 * Never throws and never prints a key: errors from Stripe are scrubbed of
 * anything that looks like one.
 *
 * Without a secret key it returns {configured: false} and one failed check; it
 * does not call anything.
 */
import Stripe from "stripe";
import { env } from "./env";
import { BILLABLE_PLANS, PLANS, stripePriceIdFor, type PlanId } from "./plans";
import { HANDLED_STRIPE_EVENTS, missingWebhookEvents } from "./stripe-events";
import { expectedTaxBehavior, priceMismatches } from "./subscription";
import { hasNotifyChannel } from "./notify";
import { STRIPE_API_VERSION, getStripe } from "./stripe";

export type ReadinessLevel = "block" | "warn";

export type ReadinessCheck = {
  id: string;
  label: string;
  ok: boolean;
  /** What was found, in one line. */
  detail: string;
  /** What to do about it when not ok (empty when ok). */
  fix: string;
  /** "block": do not go live. "warn": works, but look at it. */
  level: ReadinessLevel;
};

export type StripeReadiness = {
  /** A secret key was available. */
  configured: boolean;
  /** Every blocking check passed. */
  ok: boolean;
  mode: "live" | "test" | null;
  checks: ReadinessCheck[];
  summary: string;
};

export type ReadinessOptions = {
  /** Defaults to STRIPE_SECRET_KEY. */
  secretKey?: string | null;
  /** Defaults to NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY. */
  publishableKey?: string | null;
  /** Defaults to STRIPE_WEBHOOK_SECRET. */
  webhookSecret?: string | null;
  /** Defaults to NEXT_PUBLIC_APP_URL; the webhook endpoint must be <appUrl>/api/stripe/webhook. */
  appUrl?: string;
  /** Price ids per plan; defaults to STRIPE_PRICE_*. */
  priceIds?: Partial<Record<PlanId, string | null | undefined>>;
  /** Can the owner be told anything at all? Defaults to hasNotifyChannel() (src/lib/notify.ts). */
  ownerChannel?: boolean;
  /** Is this a production deployment? Defaults to env.IS_PRODUCTION. A test key there is reported. */
  production?: boolean;
  /** A ready client (tests point it at the local fake). Otherwise one is built from the key. */
  stripe?: Stripe;
};

const KEY_LIKE = /\b(sk|rk|pk|whsec)_(live|test)?_?[A-Za-z0-9]{6,}/g;
function safe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(KEY_LIKE, "[sleutel verborgen]").slice(0, 200);
}

const PRICE_ENV: Record<string, string> = {
  PARTICULIER: "STRIPE_PRICE_PARTICULIER",
  MONTEUR_PRO: "STRIPE_PRICE_MONTEUR",
  BEDRIJF: "STRIPE_PRICE_BEDRIJF",
};

export function stripeKeyMode(key: string | null | undefined): "live" | "test" | null {
  if (!key) return null;
  if (/^(sk|rk|pk)_live_/.test(key)) return "live";
  if (/^(sk|rk|pk)_test_/.test(key)) return "test";
  return null;
}

export async function checkStripeReadiness(opts: ReadinessOptions = {}): Promise<StripeReadiness> {
  const secretKey = opts.secretKey === undefined ? env.STRIPE_SECRET_KEY : opts.secretKey ?? undefined;
  if (!secretKey && !opts.stripe) {
    return {
      configured: false,
      ok: false,
      mode: null,
      summary: "Stripe is niet geconfigureerd: er is geen STRIPE_SECRET_KEY.",
      checks: [
        {
          id: "key",
          label: "Stripe-sleutel",
          ok: false,
          detail: "STRIPE_SECRET_KEY is niet ingesteld; betalen met kaart/iDEAL en abonnementen zijn uit, alleen betalen op rekening werkt.",
          fix: "Stripe Dashboard, Ontwikkelaars, API-sleutels: kopieer de geheime sleutel naar STRIPE_SECRET_KEY.",
          level: "block",
        },
      ],
    };
  }

  const mode = stripeKeyMode(secretKey);
  const checks: ReadinessCheck[] = [];
  const add = (c: ReadinessCheck) => checks.push(c);

  // ── keys ────────────────────────────────────────────────────────────
  const publishable = opts.publishableKey === undefined ? env.STRIPE_PUBLISHABLE_KEY : opts.publishableKey ?? undefined;
  const publishableMode = stripeKeyMode(publishable);
  if (!mode) {
    add({ id: "key.mode", label: "Soort sleutel", ok: false, detail: "STRIPE_SECRET_KEY begint niet met sk_live_, sk_test_, rk_live_ of rk_test_.", fix: "Kopieer de sleutel opnieuw uit het Stripe Dashboard.", level: "block" });
  } else if (publishable && publishableMode !== mode) {
    add({
      id: "key.mode",
      label: "Soort sleutel",
      ok: false,
      detail: `De geheime sleutel is ${mode === "live" ? "live" : "test"}, de publiceerbare sleutel is ${publishableMode ?? "onbekend"}.`,
      fix: "Zet geheime en publiceerbare sleutel uit dezelfde modus (beide live of beide test).",
      level: "block",
    });
  } else {
    add({ id: "key.mode", label: "Soort sleutel", ok: true, detail: `${mode === "live" ? "Live" : "Test"}sleutel${publishable ? ", publiceerbare sleutel in dezelfde modus" : ", geen publiceerbare sleutel ingesteld (niet nodig voor Checkout)"}.`, fix: "", level: "block" });
  }

  const production = opts.production === undefined ? env.IS_PRODUCTION : opts.production;
  add({
    id: "key.production",
    label: "Sleutel past bij de omgeving",
    ok: !(production && mode === "test"),
    detail: production && mode === "test" ? "Dit is een productie-omgeving, maar de sleutel is een testsleutel: er komt geen echt geld binnen." : production ? "Productie met een livesleutel." : "Geen productie-omgeving, elke sleutel is toegestaan.",
    fix: production && mode === "test" ? "Zet de live-sleutels (sk_live_, whsec_ van het live-endpoint, live prijs-id's) in de productie-omgeving, of laat dit zo als dit bewust een staging-omgeving is." : "",
    level: "warn",
  });

  // Everything this integration cannot fix by itself (a payment that does not
  // match its order, a double charge, a dispute with a deadline, an oversold
  // unit, a refund that could not be booked) is reported with notifyOwner. With
  // no channel those alarms go to the log only, where nobody reads them.
  const ownerChannel = opts.ownerChannel === undefined ? hasNotifyChannel() : opts.ownerChannel;
  add({
    id: "owner.channel",
    label: "Meldingen aan de eigenaar",
    ok: ownerChannel,
    detail: ownerChannel ? "Er is minstens een kanaal (Slack, Discord of e-mail) waarlangs de eigenaar bericht krijgt." : "Er is geen meldingskanaal: geschillen, dubbele betalingen en niet te verwerken betalingen komen alleen in het logboek terecht.",
    fix: ownerChannel ? "" : "Zet SLACK_WEBHOOK_URL of DISCORD_WEBHOOK_URL, of RESEND_API_KEY samen met ORDER_NOTIFY_EMAIL (of de bedrijfs-e-mail).",
    level: "block",
  });

  // ── webhook secret ──────────────────────────────────────────────────
  const webhookSecret = opts.webhookSecret === undefined ? env.STRIPE_WEBHOOK_SECRET : opts.webhookSecret ?? undefined;
  add(
    webhookSecret?.startsWith("whsec_")
      ? { id: "webhook.secret", label: "Webhook-geheim", ok: true, detail: "STRIPE_WEBHOOK_SECRET is ingesteld.", fix: "", level: "block" }
      : {
          id: "webhook.secret",
          label: "Webhook-geheim",
          ok: false,
          detail: webhookSecret ? "STRIPE_WEBHOOK_SECRET begint niet met whsec_." : "STRIPE_WEBHOOK_SECRET ontbreekt: elke webhook wordt geweigerd en betaalde bestellingen blijven op PENDING staan.",
          fix: "Stripe Dashboard, Ontwikkelaars, Webhooks, het endpoint, Signing secret. Test en live hebben elk een eigen geheim.",
          level: "block",
        },
  );

  const stripe =
    opts.stripe ??
    (secretKey && secretKey !== env.STRIPE_SECRET_KEY
      ? new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion, timeout: 8_000, maxNetworkRetries: 1 })
      : getStripe());
  if (!stripe) {
    add({ id: "client", label: "Verbinding met Stripe", ok: false, detail: "Geen Stripe-client beschikbaar.", fix: "Controleer STRIPE_SECRET_KEY.", level: "block" });
    return finish(checks, mode);
  }

  // ── account, card and iDEAL ─────────────────────────────────────────
  let account: Stripe.Account | null = null;
  try {
    account = await stripe.accounts.retrieve();
  } catch (err) {
    const why = safe(err);
    add({ id: "account", label: "Stripe-account", ok: false, detail: `Account niet op te halen: ${why}`, fix: "Controleer of de sleutel klopt en het recht 'Accounts: lezen' heeft.", level: "block" });
  }
  if (account) {
    const ready = account.charges_enabled === true;
    add({
      id: "account",
      label: "Stripe-account",
      ok: ready,
      detail: ready ? "Het account mag betalingen ontvangen." : `charges_enabled is ${String(account.charges_enabled)}, details_submitted is ${String(account.details_submitted)}.`,
      fix: ready ? "" : "Rond de accountverificatie af in het Stripe Dashboard (bedrijfsgegevens, bankrekening).",
      level: "block",
    });
  }
  for (const [method, label, key] of [
    ["card", "Kaartbetalingen", "card_payments"],
    ["ideal", "iDEAL", "ideal_payments"],
  ] as const) {
    const status = account?.capabilities?.[key];
    add({
      id: `payment.${method}`,
      label,
      ok: status === "active",
      detail: account ? `${label}: ${status ?? "niet aangevraagd"}.` : `${label}: niet te controleren zonder account.`,
      fix: status === "active" ? "" : `Activeer ${label} onder Instellingen, Betaalmethoden in het Stripe Dashboard.`,
      level: "block",
    });
  }

  // iDEAL subscriptions are collected through a SEPA direct-debit mandate, so
  // Stripe wants sepa_debit_payments as well. That is taken from Stripe's
  // documentation and has NOT been verified against a real account from here;
  // hence "warn": it tells the owner what to test, it does not block.
  {
    const status = account?.capabilities?.sepa_debit_payments;
    add({
      id: "payment.sepa",
      label: "SEPA-incasso (voor iDEAL-abonnementen)",
      ok: status === "active",
      detail: account ? `sepa_debit_payments: ${status ?? "niet aangevraagd"}.` : "Niet te controleren zonder account.",
      fix: status === "active" ? "" : "Activeer SEPA-incasso onder Instellingen, Betaalmethoden, en doe in testmodus een abonnement met iDEAL voordat je live gaat. Zonder dit kan een iDEAL-abonnement mislukken (volgens Stripe's documentatie; niet in deze omgeving getest).",
      level: "warn",
    });
  }

  // ── prices ──────────────────────────────────────────────────────────
  for (const plan of BILLABLE_PLANS) {
    const id = opts.priceIds ? opts.priceIds[plan] : stripePriceIdFor(plan);
    const cfg = PLANS[plan];
    const label = `Prijs ${cfg.name}`;
    const envName = PRICE_ENV[plan];
    const wanted = `maandelijks € ${(cfg.priceCents / 100).toFixed(2)} EUR, belastinggedrag ${expectedTaxBehavior(cfg)}`;
    if (!id) {
      add({ id: `price.${plan}`, label, ok: false, detail: `${envName} is niet ingesteld.`, fix: `Maak in Stripe een terugkerende prijs (${wanted}) en zet het id in ${envName}.`, level: "block" });
      continue;
    }
    try {
      const price = await stripe.prices.retrieve(id);
      const mismatch = priceMismatches(price, cfg);
      add({
        id: `price.${plan}`,
        label,
        ok: mismatch.length === 0,
        detail: mismatch.length === 0 ? `${id}: ${wanted}.` : `${id} wijkt af op: ${mismatch.join(", ")}.`,
        fix: mismatch.length === 0 ? "" : `Een Stripe-prijs is niet te wijzigen: maak een nieuwe aan (${wanted}), zet het id in ${envName} en archiveer de oude.`,
        level: "block",
      });
    } catch (err) {
      add({ id: `price.${plan}`, label, ok: false, detail: `${id} is niet op te halen: ${safe(err)}`, fix: `Controleer ${envName}; de prijs moet in dezelfde modus (live/test) bestaan als de sleutel.`, level: "block" });
    }
  }

  // ── webhook endpoint ────────────────────────────────────────────────
  const appUrl = (opts.appUrl ?? env.APP_URL).replace(/\/+$/, "");
  const endpointUrl = `${appUrl}/api/stripe/webhook`;
  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const endpoint = endpoints.data.find((e) => e.url === endpointUrl);
    if (!endpoint) {
      add({
        id: "webhook.endpoint",
        label: "Webhook-endpoint",
        ok: false,
        detail: `Geen endpoint voor ${endpointUrl}${endpoints.data.length ? ` (wel: ${endpoints.data.map((e) => e.url).join(", ")})` : ""}.`,
        fix: `Maak in het Stripe Dashboard, Ontwikkelaars, Webhooks een endpoint aan op ${endpointUrl} met deze events:\n${HANDLED_STRIPE_EVENTS.join("\n")}`,
        level: "block",
      });
    } else {
      const missing = missingWebhookEvents(endpoint.enabled_events);
      const enabled = endpoint.status === "enabled";
      // Events are sent in the format of the ENDPOINT's API version, not of the
      // version our client is pinned to. The handlers read both shapes of the
      // invoice-to-subscription link, but everything else has only been run
      // against the pinned version, so a different or unstated one is worth a look.
      const sameVersion = endpoint.api_version === STRIPE_API_VERSION;
      add({
        id: "webhook.api_version",
        label: "Webhook API-versie",
        ok: sameVersion,
        detail: endpoint.api_version == null ? `Het endpoint meldt geen API-versie, dus het is niet bekend in welk formaat de events binnenkomen (de code is geschreven voor ${STRIPE_API_VERSION}).` : sameVersion ? `Het endpoint gebruikt ${STRIPE_API_VERSION}, net als de code.` : `Het endpoint gebruikt ${endpoint.api_version}, de code is geschreven voor ${STRIPE_API_VERSION}.`,
        fix: sameVersion ? "" : `Maak het endpoint opnieuw aan met API-versie ${STRIPE_API_VERSION} (Stripe Dashboard, Ontwikkelaars, Webhooks), of test de betaal- en abonnementsflow in testmodus met deze versie.`,
        level: "warn",
      });
      add({
        id: "webhook.endpoint",
        label: "Webhook-endpoint",
        ok: enabled && missing.length === 0,
        detail: !enabled ? `Het endpoint staat op ${endpoint.status}.` : missing.length ? `Het endpoint mist events: ${missing.join(", ")}.` : `Endpoint ${endpointUrl} ontvangt alle ${HANDLED_STRIPE_EVENTS.length} events.`,
        fix: !enabled ? "Zet het endpoint aan in het Stripe Dashboard." : missing.length ? `Voeg deze events toe aan het endpoint:\n${missing.join("\n")}` : "",
        level: "block",
      });
    }
  } catch (err) {
    add({ id: "webhook.endpoint", label: "Webhook-endpoint", ok: false, detail: `Endpoints niet op te halen: ${safe(err)}`, fix: "Controleer het recht 'Webhook-endpoints: lezen' van de sleutel.", level: "block" });
  }

  // ── Stripe Tax (subscriptions use automatic_tax) ────────────────────
  try {
    const tax = await stripe.tax.settings.retrieve();
    add({
      id: "tax",
      label: "Stripe Tax",
      ok: tax.status === "active",
      detail: `Status ${tax.status}${tax.head_office?.address?.country ? `, vestigingsland ${tax.head_office.address.country}` : ", geen hoofdkantoor ingesteld"}.`,
      fix: tax.status === "active" ? "" : "Activeer Stripe Tax en vul het hoofdkantoor in (Dashboard, Instellingen, Belastingen). Zonder dit mislukt elke abonnementsbetaling.",
      level: "block",
    });
  } catch (err) {
    add({ id: "tax", label: "Stripe Tax", ok: false, detail: `Niet op te halen: ${safe(err)}`, fix: "Activeer Stripe Tax en controleer het recht 'Tax-instellingen: lezen'.", level: "block" });
  }

  // ── customer portal ─────────────────────────────────────────────────
  try {
    const configs = await stripe.billingPortal.configurations.list({ limit: 10 });
    const config = configs.data.find((c) => c.is_default && c.active !== false) ?? configs.data.find((c) => c.active !== false);
    add({
      id: "portal",
      label: "Klantportaal",
      ok: !!config,
      detail: config
        ? `Configuratie ${config.id} aanwezig${config.features?.subscription_cancel?.enabled ? ", opzeggen staat aan" : ", opzeggen staat uit"}.`
        : "Er is geen klantportaal-configuratie opgeslagen.",
      fix: config ? "" : "Sla het klantportaal een keer op in het Stripe Dashboard (Instellingen, Billing, Klantportaal), in test en live apart. Zonder dit werken 'Beheer abonnement' en de betaalherinneringen niet.",
      level: "block",
    });
    // The terms promise access to the end of the paid period after cancelling.
    // That only holds when the portal cancels at period end; "immediately" ends
    // the subscription (status canceled) and with it the plan.
    const cancel = config?.features?.subscription_cancel;
    if (config && cancel?.enabled) {
      const atEnd = cancel.mode === "at_period_end";
      add({
        id: "portal.cancel_mode",
        label: "Opzeggen in het klantportaal",
        ok: atEnd,
        detail: atEnd ? "Opzeggen gaat in aan het einde van de betaalde periode." : `Opzeggen gaat in: ${cancel.mode ?? "onbekend"}.`,
        fix: atEnd ? "" : "Zet in het klantportaal Opzeggen op 'aan het einde van de factureringsperiode'. De voorwaarden beloven toegang tot het einde van de betaalde periode; bij direct opzeggen eindigt het plan meteen.",
        level: "block",
      });
    }
  } catch (err) {
    add({ id: "portal", label: "Klantportaal", ok: false, detail: `Niet op te halen: ${safe(err)}`, fix: "Sla het klantportaal op in het Stripe Dashboard.", level: "block" });
  }

  return finish(checks, mode);
}

function finish(checks: ReadinessCheck[], mode: "live" | "test" | null): StripeReadiness {
  const failed = checks.filter((c) => !c.ok && c.level === "block");
  return {
    configured: true,
    ok: failed.length === 0,
    mode,
    checks,
    summary: failed.length === 0 ? `Stripe (${mode ?? "?"}) is klaar: ${checks.length} controles geslaagd.` : `Stripe (${mode ?? "?"}) is NIET klaar: ${failed.length} van ${checks.length} controles mislukt (${failed.map((c) => c.id).join(", ")}).`,
  };
}
