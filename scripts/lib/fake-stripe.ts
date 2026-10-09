/**
 * A fake Stripe for tests: a local HTTP server that speaks enough of the API
 * for scripts/qa-stripe.ts to drive the real route handlers, plus a helper that
 * signs webhook payloads the way Stripe does.
 *
 * NO network and no key: the real `stripe` client is pointed at
 * 127.0.0.1:<port> (host/port/protocol options), so request encoding, headers,
 * idempotency keys and error handling are the production ones. What is NOT
 * reproduced is Stripe's own behaviour: it accepts what it understands and
 * answers with the state the test put in `state`. It cannot tell whether a real
 * account has iDEAL activated or Stripe Tax set up; that stays a check against
 * the real API (checkStripeReadiness with a real key).
 *
 *   const fake = await startFakeStripe();
 *   const stripe = fake.client();                    // a Stripe client talking to it
 *   fake.state.subscriptions["sub_1"] = fake.subscription({...});
 *   const { body, header } = fake.signedEvent(secret, event);
 *   fake.requests                                    // every request received
 *   fake.fail("POST", "/v1/checkout/sessions", 500)  // next matching request fails
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";

export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type RecordedRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  /** Form body decoded from Stripe's bracket notation (a[b][0]=c). */
  body: Json;
  idempotencyKey: string | undefined;
};

function setDeep(obj: Json, keys: string[], value: string) {
  let cur: Json = obj;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) {
      cur[k] = value;
      return;
    }
    if (cur[k] === undefined) cur[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    cur = cur[k];
  });
}

export function parseForm(body: string): Json {
  const out: Json = {};
  for (const [k, v] of new URLSearchParams(body)) setDeep(out, k.replace(/\]/g, "").split("["), v);
  return out;
}

export type FakeState = {
  customers: Record<string, Json>;
  subscriptions: Record<string, Json>;
  prices: Record<string, Json>;
  sessions: Record<string, Json>;
  refunds: Json[];
  webhookEndpoints: Json[];
  invoices: Record<string, Json>;
  paymentMethods: Json[];
  account: Json;
  taxSettings: Json;
  portalConfigurations: Json[];
};

export type FakeStripe = {
  port: number;
  url: string;
  state: FakeState;
  requests: RecordedRequest[];
  /** Requests whose path starts with `prefix`. */
  requestsTo(method: string, prefix: string): RecordedRequest[];
  /** A real Stripe client that talks to this server. */
  client(): Stripe;
  /** Make the next request matching method+path (prefix) answer with `status`. `times` defaults to 1. */
  fail(method: string, pathPrefix: string, status?: number, times?: number): void;
  /**
   * Run `fn` when a request matching method+path prefix arrives, BEFORE it is answered. Lets a test look at
   * the database at the moment Stripe is called (for example: is the account still intact when the cancel arrives?).
   */
  hook(method: string, pathPrefix: string, fn: (req: RecordedRequest) => Promise<void> | void): void;
  reset(): void;
  close(): Promise<void>;
  /** Fresh well-formed objects. Override any field. */
  subscription(o: { id: string; customer: string; priceId: string; status?: string; userId?: string; plan?: string; periodStart?: number; periodEnd?: number; trialEnd?: number | null }): Json;
  signedEvent(secret: string, event: Json, timestampSeconds?: number): { body: string; header: string };
};

const nowSec = () => Math.floor(Date.now() / 1000);

function freshState(): FakeState {
  return {
    customers: {},
    subscriptions: {},
    prices: {},
    sessions: {},
    refunds: [],
    webhookEndpoints: [],
    invoices: {},
    paymentMethods: [],
    account: {
      id: "acct_fake",
      object: "account",
      charges_enabled: true,
      details_submitted: true,
      country: "NL",
      default_currency: "eur",
      capabilities: { card_payments: "active", ideal_payments: "active", sepa_debit_payments: "active" },
    },
    taxSettings: { object: "tax.settings", status: "active", head_office: { address: { country: "NL" } } },
    portalConfigurations: [{ id: "bpc_fake", object: "billing_portal.configuration", active: true, is_default: true, features: { subscription_cancel: { enabled: true, mode: "at_period_end" } } }],
  };
}

export async function startFakeStripe(): Promise<FakeStripe> {
  let state = freshState();
  const requests: RecordedRequest[] = [];
  const failures: Array<{ method: string; prefix: string; status: number; left: number }> = [];
  const hooks: Array<{ method: string; prefix: string; fn: (req: RecordedRequest) => Promise<void> | void }> = [];
  // Stripe answers a repeated POST that carries the same Idempotency-Key with the
  // first response and does not run it again. Reproduced here so a test can show
  // that a double click creates ONE object. (Real Stripe also rejects the same key
  // with different parameters; this does not.)
  const idempotent = new Map<string, { status: number; obj: Json }>();
  let counter = 0;
  const id = (prefix: string) => `${prefix}_fake${String(++counter).padStart(4, "0")}`;

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const u = new URL(req.url ?? "/", "http://x");
      const method = req.method ?? "GET";
      const query: Record<string, string> = {};
      u.searchParams.forEach((v, k) => (query[k] = v));
      // GET parameters arrive in the query string, POST/DELETE in the body.
      const body = raw ? parseForm(raw) : {};
      const recorded: RecordedRequest = { method, path: u.pathname, query, body, idempotencyKey: req.headers["idempotency-key"] as string | undefined };
      requests.push(recorded);
      for (const h of hooks) if (h.method === method && u.pathname.startsWith(h.prefix)) await h.fn(recorded);

      const replayKey = method === "POST" && recorded.idempotencyKey ? `${u.pathname}|${recorded.idempotencyKey}` : null;
      const cached = replayKey ? idempotent.get(replayKey) : undefined;

      const send = (status: number, obj: Json) => {
        if (replayKey && status < 500 && !idempotent.has(replayKey)) idempotent.set(replayKey, { status, obj });
        res.writeHead(status, { "content-type": "application/json", "request-id": `req_fake${++counter}` });
        res.end(JSON.stringify(obj));
      };
      const missing = (what: string) => send(404, { error: { type: "invalid_request_error", code: "resource_missing", message: `No such ${what}` } });
      const list = (data: Json[]) => send(200, { object: "list", data, has_more: false, url: u.pathname });

      if (cached) {
        res.writeHead(cached.status, { "content-type": "application/json", "request-id": `req_fake${++counter}`, "idempotent-replayed": "true" });
        return res.end(JSON.stringify(cached.obj));
      }
      const failure = failures.find((f) => f.left > 0 && f.method === method && u.pathname.startsWith(f.prefix));
      if (failure) {
        failure.left -= 1;
        return send(failure.status, { error: { type: "api_error", message: "fake outage" } });
      }

      let m: RegExpMatchArray | null;
      const p = u.pathname;

      if (method === "GET" && p === "/v1/account") return send(200, state.account);
      if (method === "GET" && p === "/v1/tax/settings") return send(200, state.taxSettings);
      if (method === "GET" && p === "/v1/webhook_endpoints") return list(state.webhookEndpoints);
      if (method === "GET" && (m = p.match(/^\/v1\/invoices\/([^/]+)$/))) {
        const inv = state.invoices[m[1]];
        return inv ? send(200, inv) : missing(`invoice: '${m[1]}'`);
      }
      if (method === "GET" && p === "/v1/payment_methods") return list(state.paymentMethods.filter((pm) => !query.customer || pm.customer === query.customer));
      if (method === "POST" && (m = p.match(/^\/v1\/payment_methods\/([^/]+)\/detach$/))) {
        const pm = state.paymentMethods.find((x) => x.id === m![1]);
        if (!pm) return missing(`payment method: '${m[1]}'`);
        pm.customer = null;
        return send(200, pm);
      }
      if (method === "GET" && p === "/v1/billing_portal/configurations") return list(state.portalConfigurations);
      if (method === "POST" && p === "/v1/billing_portal/sessions") {
        return send(200, { id: id("bps"), object: "billing_portal.session", url: `https://billing.stripe.test/p/${counter}`, customer: body.customer, return_url: body.return_url });
      }

      if (method === "GET" && (m = p.match(/^\/v1\/prices\/(.+)$/))) {
        const price = state.prices[m[1]];
        return price ? send(200, price) : missing(`price: '${m[1]}'`);
      }

      if (method === "POST" && p === "/v1/customers") {
        const c = { id: id("cus"), object: "customer", email: body.email, name: body.name, metadata: body.metadata ?? {} };
        state.customers[c.id] = c;
        return send(200, c);
      }
      if (method === "POST" && (m = p.match(/^\/v1\/customers\/([^/]+)$/))) {
        const c = state.customers[m[1]];
        if (!c) return missing(`customer: '${m[1]}'`);
        Object.assign(c, body);
        return send(200, c);
      }

      if (method === "POST" && p === "/v1/checkout/sessions") {
        const sid = `cs_test_${id("s")}`;
        const session = { id: sid, object: "checkout.session", url: `https://checkout.stripe.test/c/pay/${sid}`, mode: body.mode, status: "open", payment_status: "unpaid", metadata: body.metadata ?? {}, customer: body.customer ?? null, payment_intent: null, amount_total: null, currency: "eur" };
        state.sessions[sid] = session;
        return send(200, session);
      }
      if (method === "GET" && p === "/v1/checkout/sessions") {
        const wanted = query.payment_intent;
        return list(Object.values(state.sessions).filter((s) => !wanted || s.payment_intent === wanted));
      }
      if (method === "POST" && (m = p.match(/^\/v1\/checkout\/sessions\/([^/]+)\/expire$/))) {
        // Modelled on the documented behaviour (not checked against live Stripe): only an open session can be expired.
        const s = state.sessions[m[1]];
        if (!s) return missing(`checkout session: '${m[1]}'`);
        if (s.status !== "open") return send(400, { error: { type: "invalid_request_error", message: "Only Checkout Sessions with a status of `open` can be expired." } });
        s.status = "expired";
        return send(200, s);
      }
      if (method === "GET" && (m = p.match(/^\/v1\/checkout\/sessions\/(.+)$/))) {
        const s = state.sessions[m[1]];
        return s ? send(200, s) : missing(`checkout session: '${m[1]}'`);
      }

      if (method === "GET" && p === "/v1/subscriptions") {
        return list(Object.values(state.subscriptions).filter((s) => (!query.customer || s.customer === query.customer) && (query.status === "all" || !query.status || s.status === query.status)));
      }
      if (method === "GET" && (m = p.match(/^\/v1\/subscriptions\/([^/]+)$/))) {
        const s = state.subscriptions[m[1]];
        return s ? send(200, s) : missing(`subscription: '${m[1]}'`);
      }
      if (method === "DELETE" && (m = p.match(/^\/v1\/subscriptions\/([^/]+)$/))) {
        const s = state.subscriptions[m[1]];
        if (!s) return missing(`subscription: '${m[1]}'`);
        s.status = "canceled";
        s.canceled_at = nowSec();
        return send(200, s);
      }

      if (method === "GET" && p === "/v1/refunds") return list(state.refunds.filter((r) => !query.charge || r.charge === query.charge));
      if (method === "POST" && p === "/v1/refunds") {
        const refund = { id: id("re"), object: "refund", amount: Number(body.amount ?? 0), currency: "eur", status: "succeeded", charge: body.charge ?? (body.payment_intent ? `ch_${body.payment_intent}` : null), payment_intent: body.payment_intent ?? null, created: nowSec(), metadata: body.metadata ?? {} };
        state.refunds.push(refund);
        return send(200, refund);
      }

      return send(404, { error: { type: "invalid_request_error", message: `fake-stripe: unhandled ${method} ${p}` } });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  const api: FakeStripe = {
    port,
    url: `http://127.0.0.1:${port}`,
    get state() {
      return state;
    },
    requests,
    requestsTo: (method, prefix) => requests.filter((r) => r.method === method && r.path.startsWith(prefix)),
    client: () =>
      new Stripe("sk_test_fakefakefakefake", {
        apiVersion: "2024-12-18.acacia" as Stripe.LatestApiVersion,
        host: "127.0.0.1",
        port,
        protocol: "http",
        timeout: 5_000,
        maxNetworkRetries: 0,
      }),
    fail: (method, pathPrefix, status = 500, times = 1) => {
      failures.push({ method, prefix: pathPrefix, status, left: times });
    },
    hook: (method, pathPrefix, fn) => {
      hooks.push({ method, prefix: pathPrefix, fn });
    },
    reset: () => {
      state = freshState();
      idempotent.clear();
      hooks.length = 0;
      requests.length = 0;
      failures.length = 0;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    subscription: (o) => {
      const start = o.periodStart ?? nowSec() - 5 * 86400;
      const end = o.periodEnd ?? start + 30 * 86400;
      return {
        id: o.id,
        object: "subscription",
        customer: o.customer,
        status: o.status ?? "active",
        current_period_start: start,
        current_period_end: end,
        trial_start: o.trialEnd ? start : null,
        trial_end: o.trialEnd ?? null,
        metadata: { ...(o.userId ? { userId: o.userId } : {}), ...(o.plan ? { plan: o.plan } : {}) },
        items: { object: "list", data: [{ id: `si_${o.id}`, object: "subscription_item", price: { id: o.priceId, object: "price" } }] },
      };
    },
    signedEvent: (secret, event, timestampSeconds) => {
      const body = JSON.stringify(event);
      const header = new Stripe("sk_test_signonly").webhooks.generateTestHeaderString({ payload: body, secret, timestamp: timestampSeconds });
      return { body, header };
    },
  };
  return api;
}

let eventCounter = 0;
/** A Stripe event envelope. `id` defaults to a unique one; pass the same id to replay. */
export function makeEvent(type: string, object: Json, o: { id?: string; created?: number } = {}): Json {
  return {
    id: o.id ?? `evt_fake_${Date.now().toString(36)}_${++eventCounter}`,
    object: "event",
    api_version: "2024-12-18.acacia",
    created: o.created ?? nowSec(),
    livemode: false,
    pending_webhooks: 1,
    type,
    data: { object },
  };
}
