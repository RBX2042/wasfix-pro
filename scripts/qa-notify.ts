/**
 * Owner notifications and e-mail failure handling.
 *
 * A local HTTP server stands in for Slack and Discord. Covered: delivery, the
 * 3 s timeout, non-2xx answers, unreachable hosts, "no channel configured"
 * (warned once), the e-mail channel, PII scrubbing, Slack/Discord control
 * characters, the notifyError throttle, and the e-mail layer (no key, a key
 * Resend rejects, escalation to the owner, replyTo, tracking links).
 *
 * Phase 2 re-runs itself with RESEND_API_KEY set, because env is read at import.
 *
 * Usage: npx tsx scripts/qa-notify.ts          (needs no database)
 */
import http from "node:http";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";

const log: string[] = [];
const check = (cond: boolean, ok: string, bad: string) => log.push(cond ? `✅ ${ok}` : `❌ ${bad}`);

type Hit = { path: string; body: string };

function server(behaviour: (req: http.IncomingMessage, res: http.ServerResponse, hit: Hit) => void) {
  const hits: Hit[] = [];
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const hit = { path: req.url ?? "", body };
      hits.push(hit);
      behaviour(req, res, hit);
    });
  });
  return new Promise<{ url: string; hits: Hit[]; close: () => void }>((resolve) =>
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}/hook`, hits, close: () => { srv.closeAllConnections?.(); srv.close(); } });
    }),
  );
}

const ok200 = (_q: http.IncomingMessage, res: http.ServerResponse) => { res.statusCode = 200; res.end("ok"); };

async function phase1() {
  // Capture warnings to count the once-per-process "no channel" line.
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(" ")); };

  const slack = await server(ok200);
  const discord = await server(ok200);
  const failing = await server((_q, res) => { res.statusCode = 500; res.end("boom"); });
  const hanging = await server(() => { /* never answers */ });

  delete process.env.RESEND_API_KEY;
  delete process.env.SLACK_WEBHOOK_URL;
  delete process.env.DISCORD_WEBHOOK_URL;
  const n = await import("../src/lib/notify");

  // ── Delivery ──────────────────────────────────────────────────────────
  {
    const r = await n.notifyOwner(
      { event: "order.paid", title: "Betaling ontvangen #ABC12345", lines: ["€ 30.45 · 3 artikel(en)"], url: "/admin/bestellingen", level: "info" },
      { slackUrl: slack.url, discordUrl: discord.url, emailTo: null },
    );
    const s = JSON.parse(slack.hits[0]?.body ?? "{}");
    const d = JSON.parse(discord.hits[0]?.body ?? "{}");
    check(r.configured && r.delivered.sort().join() === "discord,slack" && r.failed.length === 0, "Delivery: Slack and Discord both receive the message", `Delivery: ${JSON.stringify(r)}`);
    check(typeof s.text === "string" && s.text.includes("#ABC12345") && s.text.includes("€ 30.45") && s.text.includes("/admin/bestellingen") && s.text.includes("http"), "Delivery: Slack gets JSON {text} with number, total and an absolute admin link", `Slack payload: ${JSON.stringify(s)}`);
    check(typeof d.content === "string" && d.content.includes("#ABC12345") && d.content.length <= 1900, "Delivery: Discord gets JSON {content} (<= 1900 chars)", `Discord payload: ${JSON.stringify(d)}`);
  }

  // ── Level tags ────────────────────────────────────────────────────────
  {
    slack.hits.length = 0;
    await n.notifyOwner({ event: "x", title: "Kapot", level: "error" }, { slackUrl: slack.url, discordUrl: null, emailTo: null });
    await n.notifyOwner({ event: "x", title: "Let op", level: "warn" }, { slackUrl: slack.url, discordUrl: null, emailTo: null });
    const texts = slack.hits.map((h) => JSON.parse(h.body).text as string);
    check(texts[0].includes("[FOUT]") && texts[1].includes("[LET OP]"), "Levels: error and warn are visibly tagged", `Levels: ${texts}`);
  }

  // ── PII and control characters ────────────────────────────────────────
  {
    slack.hits.length = 0;
    discord.hits.length = 0;
    await n.notifyOwner(
      { event: "x", title: "Fout voor klant@example.com", lines: ["mail jan.jansen+x@sub.example.nl nu", "<!channel> <https://evil.example|klik>"] },
      { slackUrl: slack.url, discordUrl: discord.url, emailTo: null },
    );
    const s = JSON.parse(slack.hits[0].body).text as string;
    const d = JSON.parse(discord.hits[0].body).content as string;
    check(!/@example\.(com|nl)/.test(s) && !/@example\.(com|nl)/.test(d) && s.includes("[e-mailadres verborgen]"), "PII: e-mail addresses are replaced before they leave the process (both channels)", `PII leaked: ${s} | ${d}`);
    check(!s.includes("<!channel>") && !s.includes("<https://") && s.includes("&lt;!channel&gt;"), "Slack: <!channel> and <url|text> are neutralised", `Slack control chars survive: ${s}`);
    slack.hits.length = 0;
    discord.hits.length = 0;
    await n.notifyOwner({ event: "x", title: "ping", lines: ["@everyone kijk"] }, { slackUrl: null, discordUrl: discord.url, emailTo: null });
    const d2 = JSON.parse(discord.hits[0].body).content as string;
    check(!d2.includes("@everyone") && d2.includes("@​everyone"), "Discord: @everyone cannot ping the channel", `Discord ping survives: ${d2}`);
    discord.hits.length = 0;
    await n.notifyOwner({ event: "x", title: "lang", lines: Array.from({ length: 30 }, () => "x".repeat(400)) }, { slackUrl: null, discordUrl: discord.url, emailTo: null });
    check(JSON.parse(discord.hits[0].body).content.length <= 1900, "Discord: an oversized message is cut to the 2000-char limit", "Discord: oversized message not cut");
  }

  // ── Failure modes ─────────────────────────────────────────────────────
  {
    const r = await n.notifyOwner({ event: "x", title: "t" }, { slackUrl: failing.url, discordUrl: discord.url, emailTo: null });
    check(r.failed.length === 1 && r.failed[0].channel === "slack" && r.failed[0].reason === "http_500" && r.delivered.join() === "discord", "Non-2xx: a 500 from Slack is reported as failed and Discord is still delivered", `Non-2xx: ${JSON.stringify(r)}`);
  }
  {
    const t0 = Date.now();
    const r = await n.notifyOwner({ event: "x", title: "t" }, { slackUrl: hanging.url, discordUrl: discord.url, emailTo: null });
    const ms = Date.now() - t0;
    check(r.failed.length === 1 && /timeout_3000ms/.test(r.failed[0].reason) && r.delivered.join() === "discord", "Timeout: a Slack that never answers is abandoned at 3 s, Discord unaffected", `Timeout: ${JSON.stringify(r)}`);
    check(ms >= 2900 && ms < 4200, `Timeout: the whole call took ${ms} ms (about 3000, channels run in parallel)`, `Timeout: took ${ms} ms`);
  }
  {
    const t0 = Date.now();
    const r = await n.notifyOwner({ event: "x", title: "t" }, { slackUrl: hanging.url, discordUrl: null, emailTo: null, timeoutMs: 250 });
    const ms = Date.now() - t0;
    check(r.failed.length === 1 && ms < 1500, `Timeout: the timeout is configurable (250 ms took ${ms} ms)`, `Timeout override: ${ms} ms ${JSON.stringify(r)}`);
  }
  {
    const dead = await server(ok200);
    const url = dead.url;
    dead.close();
    const r1 = await n.notifyOwner({ event: "x", title: "t" }, { slackUrl: url, discordUrl: null, emailTo: null });
    const r2 = await n.notifyOwner({ event: "x", title: "t" }, { slackUrl: "not a url", discordUrl: null, emailTo: null });
    check(r1.failed.length === 1 && r2.failed.length === 1, "Network: a closed port and a malformed URL are reported as failed, not thrown", `Network: ${JSON.stringify([r1, r2])}`);
    const logged = warnings.filter((w) => w.includes("channel failed"));
    check(logged.length >= 4 && logged.every((w) => !w.includes("127.0.0.1")), "Network: failures are logged without the webhook URL", `Failure log lines expose the URL or are missing: ${logged.length}`);

    // The leak the first version had: a webhook URL pasted WITHOUT its scheme makes
    // fetch throw "Failed to parse URL from <the whole URL>", and the path of a
    // Slack/Discord webhook IS the secret. Every shape of bad URL must come back
    // as a fixed code and leave the token out of the result and out of the log.
    const SECRET = "SUPERSECRETTOKEN123";
    warnings.length = 0;
    const shapes: Array<[string, string]> = [
      ["no scheme", `hooks.slack.com/services/T0000/B0000/${SECRET}`],
      ["wrong scheme", `ftp://hooks.slack.com/services/T0000/B0000/${SECRET}`],
      ["unresolvable host", `https://no-such-host.invalid/services/T0000/B0000/${SECRET}`],
      ["closed port", `${url.replace(/\/hook$/, "")}/services/T0000/B0000/${SECRET}`],
    ];
    const expectedCode: Record<string, RegExp> = { "no scheme": /^invalid_url$/, "wrong scheme": /^invalid_url$/, "unresolvable host": /^network_error$/, "closed port": /^network_error$/ };
    for (const [label, bad] of shapes) {
      const res = await n.notifyOwner({ event: "x", title: "t" }, { slackUrl: bad, discordUrl: null, emailTo: null });
      const blob = JSON.stringify(res) + warnings.join("\n");
      check(res.failed.length === 1 && expectedCode[label].test(res.failed[0].reason) && !blob.includes(SECRET), `Webhook secret: a ${label} URL fails with a fixed code (${res.failed[0]?.reason}) and the token is in neither the result nor the log`, `Webhook secret leaked or wrong code for ${label}: ${blob.slice(0, 300)}`);
    }
  }
  {
    let threw = false;
    try {
      await n.notifyOwner({ event: undefined as unknown as string, title: undefined as unknown as string, lines: [null as unknown as string] }, { slackUrl: slack.url, discordUrl: null, emailTo: null });
      await n.notifyOwner(null as unknown as Parameters<typeof n.notifyOwner>[0]);
    } catch { threw = true; }
    check(!threw, "Robustness: garbage input never throws", "Robustness: notifyOwner threw on bad input");
  }

  // ── No channel configured ─────────────────────────────────────────────
  {
    n._resetNotifyStateForTests();
    warnings.length = 0;
    const r1 = await n.notifyOwner({ event: "x", title: "t" }, { slackUrl: null, discordUrl: null, emailTo: null });
    const r2 = await n.notifyOwner({ event: "x", title: "t" }, { slackUrl: null, discordUrl: null, emailTo: null });
    const r3 = await n.notifyOwner({ event: "x", title: "t" });
    const lines = warnings.filter((w) => w.includes("no owner notification channel"));
    check(!r1.configured && !r2.configured && !r3.configured && r1.delivered.length === 0, "No channel: reported as not configured, nothing delivered, no throw", `No channel: ${JSON.stringify([r1, r2, r3])}`);
    check(lines.length === 1, `No channel: exactly ONE warning for three calls (${lines.length})`, `No channel: ${lines.length} warnings`);
    check(n.hasNotifyChannel() === false, "No channel: hasNotifyChannel() is false", "No channel: hasNotifyChannel() is true");
  }

  // ── E-mail channel (injected transport) ───────────────────────────────
  {
    const mails: Array<{ to: unknown; subject: string; html: string }> = [];
    const r = await n.notifyOwner({ event: "x", title: "Nieuwe bestelling", lines: ["€ 5.00"], url: "/admin/bestellingen" }, {
      slackUrl: null, discordUrl: null, emailTo: "owner@example.com",
      sendMail: async (m) => { mails.push(m); return { ok: true }; },
    });
    check(r.delivered.join() === "email" && mails.length === 1 && mails[0].to === "owner@example.com" && mails[0].subject.includes("Nieuwe bestelling") && mails[0].html.includes("/admin/bestellingen"), "E-mail channel: the owner gets the alert with title and admin link", `E-mail channel: ${JSON.stringify(r)} ${JSON.stringify(mails)}`);
    const bad = await n.notifyOwner({ event: "x", title: "t" }, { slackUrl: slack.url, discordUrl: null, emailTo: "owner@example.com", sendMail: async () => ({ ok: false, error: "domain not verified" }) });
    check(bad.delivered.join() === "slack" && bad.failed[0]?.channel === "email" && bad.failed[0].reason === "domain not verified", "E-mail channel: a refused mail is reported as failed, Slack unaffected", `E-mail failure: ${JSON.stringify(bad)}`);
    const t0 = Date.now();
    const slow = await n.notifyOwner({ event: "x", title: "t" }, { slackUrl: null, discordUrl: null, emailTo: "owner@example.com", timeoutMs: 300, sendMail: () => new Promise(() => { /* never resolves */ }) });
    const slowMs = Date.now() - t0;
    check(slow.failed[0]?.channel === "email" && /timeout_300ms/.test(slow.failed[0].reason) && slowMs < 1500, `E-mail channel: a transport that hangs is cut off by the same timeout (${slowMs} ms)`, `E-mail channel hang: ${JSON.stringify(slow)} ${slowMs} ms`);
    const thrower = await n.notifyOwner({ event: "x", title: "t" }, { slackUrl: null, discordUrl: null, emailTo: "owner@example.com", sendMail: async () => { throw new Error("kaboom"); } });
    check(thrower.failed[0]?.channel === "email", "E-mail channel: a throwing transport is contained", `E-mail throw: ${JSON.stringify(thrower)}`);
  }

  // ── notifyError ───────────────────────────────────────────────────────
  {
    n._resetNotifyStateForTests();
    slack.hits.length = 0;
    const opts = { slackUrl: slack.url, discordUrl: null, emailTo: null };
    const a = await n.notifyError(new Error("db down for jan@example.com"), { where: "checkout", orderId: "abc" }, opts);
    const b = await n.notifyError(new Error("db down for jan@example.com"), { where: "checkout", orderId: "abc" }, opts);
    const c = await n.notifyError(new Error("something else"), { where: "checkout" }, opts);
    const text = JSON.parse(slack.hits[0].body).text as string;
    check(a.delivered.join() === "slack" && b.throttled === true && c.delivered.join() === "slack" && slack.hits.length === 2, "notifyError: an identical error within a minute is sent once; a different one still goes out", `notifyError throttle: ${JSON.stringify([a, b, c])} hits=${slack.hits.length}`);
    check(text.includes("Fout in checkout") && text.includes("orderId=abc") && !text.includes("jan@example.com"), "notifyError: names where it happened, carries context, scrubs addresses", `notifyError text: ${text}`);
    const weird = await n.notifyError("just a string", {}, opts);
    check(weird.delivered.length === 1, "notifyError: accepts a non-Error", `notifyError string: ${JSON.stringify(weird)}`);
  }

  // ── E-mail layer without a key ────────────────────────────────────────
  {
    n._resetNotifyStateForTests();
    const em = await import("../src/lib/email");
    warnings.length = 0;
    const res = await em.sendWelcomeEmail("someone@example.com", "Piet");
    const res2 = await em.sendOrderShippedEmail("someone@example.com", { orderId: "abc12345xyz", name: "Piet", carrier: "PostNL", trackingCode: "3S123", postalCode: "1011 AB" });
    check(res.ok === false && res.error === "no_resend_key" && res2.ok === false, "E-mail without RESEND_API_KEY: every sender returns {ok:false, error} instead of silently succeeding", `E-mail no key: ${JSON.stringify([res, res2])}`);
    const skipped = warnings.filter((w) => w.includes("skipped: no RESEND_API_KEY"));
    check(skipped.length === 2 && skipped.every((w) => !w.includes("someone@example.com")), "E-mail without a key: each skipped send is logged, with no address", `E-mail skip logs: ${skipped.length}`);
  }

  // ── Tracking links ────────────────────────────────────────────────────
  {
    const { trackingUrl, normaliseCarrier, carrierLabel, CARRIERS } = await import("../src/lib/emails/tracking");
    check(CARRIERS.join() === "POSTNL,DHL,DPD,UPS,GLS", "Tracking: PostNL, DHL, DPD, UPS and GLS are supported", `Tracking carriers: ${CARRIERS}`);
    const urls = CARRIERS.map((c) => trackingUrl(c, "ABC 123", "1011 ab"));
    check(urls.every((u) => typeof u === "string" && u!.startsWith("https://") && u!.includes("ABC123")), "Tracking: every carrier yields an https link containing the code (spaces removed)", `Tracking urls: ${urls}`);
    check((trackingUrl("postnl", "3S1", "1011 ab") ?? "").endsWith("3S1-NL-1011AB"), "Tracking: PostNL carries the postcode, upper-cased without a space", `PostNL url: ${trackingUrl("postnl", "3S1", "1011 ab")}`);
    check(trackingUrl("PostNL", "3S1") === null && trackingUrl("PostNL", "3S1", "") === null, "Tracking: PostNL without a postcode has no link (the plain code is shown)", "Tracking: PostNL link built without a postcode");
    check(trackingUrl("Transmission", "XYZ123") === null && trackingUrl("DHL", "  ") === null && trackingUrl(null, "XYZ") === null, "Tracking: an unknown carrier or an empty code has no link", "Tracking: link built for unknown carrier / empty code");
    check(normaliseCarrier(" Post NL ") === "POSTNL" && normaliseCarrier("dhl") === "DHL" && normaliseCarrier("Bpost") === "OTHER" && carrierLabel("Bpost") === "Bpost" && carrierLabel("dpd") === "DPD", "Tracking: carrier names are normalised; unknown ones keep the typed name", "Tracking: normalisation wrong");
    check(!trackingUrl("DHL", "A&B=1/../x")!.includes("&B") && trackingUrl("DHL", "A&B=1")!.includes("A%26B%3D1"), "Tracking: the code is URL-encoded", "Tracking: code not encoded");
  }

  console.warn = realWarn;
  slack.close(); discord.close(); failing.close(); hanging.close();
}

async function phase2() {
  // The real Resend SDK talks to a local stand-in (RESEND_BASE_URL), so the
  // success path, a rejected message and a hung request are all exercised for
  // real. The investigators found that resend RETURNS {error} for an unverified
  // domain or a bad key instead of throwing, which the old code never noticed.
  const warnings: string[] = [];
  const errors: string[] = [];
  console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(" ")); };
  console.error = (...a: unknown[]) => { errors.push(a.map(String).join(" ")); };
  const slack = await server(ok200);
  const resendRequests: Array<Record<string, unknown>> = [];
  const resend = await server((_q, res, hit) => {
    const body = JSON.parse(hit.body || "{}") as Record<string, unknown>;
    resendRequests.push(body);
    const to = String(Array.isArray(body.to) ? body.to[0] : body.to);
    if (to.startsWith("hang@")) return; // never answers
    res.setHeader("content-type", "application/json");
    if (to.startsWith("reject@")) {
      res.statusCode = 422;
      res.end(JSON.stringify({ name: "validation_error", message: "The wasfix.nl domain is not verified", statusCode: 422 }));
      return;
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ id: "msg_local_1" }));
  });
  process.env.SLACK_WEBHOOK_URL = slack.url;
  process.env.RESEND_API_KEY = "re_local_test_key";
  process.env.RESEND_BASE_URL = resend.url.replace(/\/hook$/, "");
  process.env.COMPANY_EMAIL = "hallo@example.test";
  const em = await import("../src/lib/email");

  const okRes = await em.sendWelcomeEmail("ok@example.com", "Piet");
  const sent = resendRequests[0] ?? {};

  // Content of the order mails: every link carries the guest token, the facts are present.
  resendRequests.length = 0;
  const base = { orderId: "abc12345xyz", name: "Piet", accessToken: "TOK123" };
  await em.sendPaymentReceivedEmail("ok@example.com", { ...base, totalEur: 30.45, invoiceNumber: "2026-00007" });
  await em.sendStripeOrderConfirmation("ok@example.com", { ...base, items: [{ name: "Pomp", quantity: 2, total: 20.3 }], totalEur: 20.3, invoiceNumber: "2026-00008" });
  await em.sendOrderShippedEmail("ok@example.com", { ...base, carrier: "PostNL", trackingCode: "3SQA123", postalCode: "1011 AB" });
  await em.sendOrderCancelledEmail("ok@example.com", { ...base, wasPaid: true, creditNoteNumber: "CN-2026-00003", refundEur: 30.45, reason: "uitverkocht" });
  await em.sendRefundEmail("ok@example.com", { ...base, amountEur: 10, creditNoteNumber: "CN-2026-00004", partial: true });
  await em.sendBankTransferInstructions("ok@example.com", { ...base, invoiceNumber: "2026-00009", totalEur: 30.45, dueAt: new Date("2026-12-01"), iban: "NL02ABNA0123456789", ibanName: "WasFix Test B.V." });
  await em.sendOrderConfirmation("ok@example.com", { ...base, items: [{ name: "Pomp", quantity: 1, total: 10 }], total: 10 });
  const htmls = resendRequests.map((r) => String(r.html));
  const subjects = resendRequests.map((r) => String(r.subject));
  const content = {
    count: htmls.length,
    allLinkToken: htmls.every((h) => h.includes("/bestelling/abc12345xyz?t=TOK123")),
    paidInvoice: htmls[0].includes("2026-00007") && subjects[0].includes("#ABC12345"),
    stripe: htmls[1].includes("2026-00008") && htmls[1].includes("retourvoorwaarden"),
    shipped: htmls[2].includes("3SQA123") && htmls[2].includes("jouw.postnl.nl/track-and-trace/3SQA123-NL-1011AB") && htmls[2].includes("PostNL"),
    cancelled: htmls[3].includes("CN-2026-00003") && htmls[3].includes("uitverkocht") && htmls[3].includes("30,45"),
    refund: htmls[4].includes("CN-2026-00004") && htmls[4].includes("10,00"),
    footer: htmls.every((h) => h.includes("WasFix")),
    noOldLink: htmls.every((h) => !/\/bestelling\/abc12345xyz"/.test(h)),
  };

  const rejected = await em.sendBankTransferInstructions("reject@example.com", {
    orderId: "abc12345xyz", name: "Piet", accessToken: "tok", invoiceNumber: "2026-00001", totalEur: 30.45, dueAt: new Date(), iban: "NL02ABNA0123456789", ibanName: "WasFix Test B.V.",
  });
  await new Promise((r) => setTimeout(r, 150));
  const alert = slack.hits.map((h) => JSON.parse(h.body).text as string).find((t) => t.includes("E-mail niet verstuurd"));

  const t0 = Date.now();
  const hung = await em.sendOrderShippedEmail("hang@example.com", { orderId: "abc12345xyz", name: "Piet", carrier: "DHL", trackingCode: "JVGL1" });
  const hungMs = Date.now() - t0;

  console.log(
    JSON.stringify({
      okRes,
      sent: { from: sent.from, subject: sent.subject, replyTo: sent.reply_to, hasText: typeof sent.text === "string" && !/<[a-z]/i.test(sent.text as string) && (sent.text as string).length > 20, hasHtml: typeof sent.html === "string" },
      content,
      rejected,
      alert: alert ?? null,
      errorLogged: errors.some((e) => e.includes("[email]")),
      addressInLogs: [...errors, ...warnings].some((l) => l.includes("example.com")),
      addressInAlert: (alert ?? "").includes("example.com"),
      hung,
      hungMs,
    }),
  );
  slack.close();
  resend.close();
  process.exit(0);
}

async function phase3() {
  // sendBankTransferInstructions in production with a partial company identity.
  process.env.RESEND_API_KEY = "re_invalid_key_for_test";
  const em = await import("../src/lib/email");
  const res = await em.sendBankTransferInstructions("klant@example.com", {
    orderId: "abc12345xyz", name: "Piet", invoiceNumber: "2026-00001", totalEur: 30.45, dueAt: new Date(), iban: "NL00ABCD0123456789", ibanName: "WasFix Pro",
  });
  console.log(JSON.stringify(res));
  process.exit(0);
}

async function phase4() {
  // A half-configured shop: RESEND_API_KEY is set but nobody said where owner
  // mail should go. The built-in default address (support@wasfix.nl) must not
  // count as a channel, receive alerts or receive customers' replies.
  const withSlack = process.argv.includes("--slack");
  const warnings: string[] = [];
  console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(" ")); };
  const slack = await server(ok200);
  const requests: Array<Record<string, unknown>> = [];
  const resend = await server((_q, res, hit) => {
    requests.push(JSON.parse(hit.body || "{}") as Record<string, unknown>);
    res.setHeader("content-type", "application/json");
    res.statusCode = 200;
    res.end(JSON.stringify({ id: "msg_local_4" }));
  });
  if (withSlack) process.env.SLACK_WEBHOOK_URL = slack.url;
  process.env.RESEND_API_KEY = "re_local_test_key";
  process.env.RESEND_BASE_URL = resend.url.replace(/\/hook$/, "");
  const n = await import("../src/lib/notify");
  const em = await import("../src/lib/email");
  const has = n.hasNotifyChannel();
  const first = await n.notifyOwner({ event: "x", title: "t" });
  await n.notifyOwner({ event: "x", title: "t" });
  const noChannelWarnings = warnings.filter((w) => w.includes("no owner notification channel")).length;
  const noChannelText = warnings.find((w) => w.includes("no owner notification channel")) ?? "";
  const rma = await em.sendRmaNotification({ rmaNumber: "RMA-QA-1", orderId: "CMUZKSN0", name: "Piet", email: "klant@example.com", reason: "DEFECT", notes: "kapot" });
  await new Promise((r) => setTimeout(r, 150));
  console.log(
    JSON.stringify({
      has,
      configured: first.configured,
      noChannelWarnings,
      warnsAboutAddress: /ORDER_NOTIFY_EMAIL|COMPANY_EMAIL/.test(noChannelText),
      ownerAddress: em.ownerEmailAddress(),
      recipients: requests.map((r) => String(Array.isArray(r.to) ? r.to[0] : r.to)),
      replyTos: requests.map((r) => (r.reply_to === undefined ? null : String(r.reply_to))),
      toDefault: requests.some((r) => JSON.stringify(r.to).includes("support@wasfix.nl")),
      rmaOk: rma.ok,
      slackTexts: slack.hits.map((h) => String(JSON.parse(h.body).text)),
    }),
  );
  slack.close();
  resend.close();
  process.exit(0);
}

async function main() {
  if (process.argv.includes("--with-key")) return phase2();
  if (process.argv.includes("--prod-guard")) return phase3();
  if (process.argv.includes("--no-address")) return phase4();
  try {
    await phase1();
    const child = spawnSync("npx", ["tsx", __filename, "--with-key"], { encoding: "utf8", env: { ...process.env } });
    const line = (child.stdout.split("\n").find((l) => l.startsWith("{")) ?? "{}");
    const r = JSON.parse(line) as {
      okRes?: { ok: boolean; id?: string };
      sent?: { from?: string; subject?: string; replyTo?: string; hasText?: boolean; hasHtml?: boolean };
      content?: Record<string, number | boolean>;
      rejected?: { ok: boolean; error?: string };
      alert?: string | null;
      errorLogged?: boolean;
      addressInLogs?: boolean;
      addressInAlert?: boolean;
      hung?: { ok: boolean; error?: string };
      hungMs?: number;
    };
    check(r.okRes?.ok === true && r.okRes.id === "msg_local_1", "E-mail via the real Resend SDK (local stand-in): an accepted message returns {ok:true, id}", `Accepted mail: ${line} ${child.stderr.slice(0, 300)}`);
    check(r.sent?.replyTo === "hallo@example.test", "E-mail: replyTo is COMPANY.email (the texts say 'antwoord op deze e-mail')", `replyTo missing: ${JSON.stringify(r.sent)}`);
    check(r.sent?.hasHtml === true && r.sent?.hasText === true, "E-mail: sent with an HTML body and a plain-text alternative", `body parts: ${JSON.stringify(r.sent)}`);
    const c = r.content ?? {};
    check(c.count === 7 && c.allLinkToken === true && c.noOldLink === true, "Order mails: all 7 order-related mails link to /bestelling/<id>?t=<token> (no token-less link left)", `Mail links: ${JSON.stringify(c)}`);
    check(c.paidInvoice === true && c.stripe === true, "Mails: payment received names order and invoice; the Stripe confirmation carries the invoice number and withdrawal info", `Paid mails: ${JSON.stringify(c)}`);
    check(c.shipped === true, "Mails: shipped mail has carrier, plain code and the PostNL link with the postcode", `Shipped mail: ${JSON.stringify(c)}`);
    check(c.cancelled === true && c.refund === true, "Mails: cancellation names the credit note and the refunded amount; refund mail names its credit note", `Cancel/refund mails: ${JSON.stringify(c)}`);
    check(c.footer === true, "Mails: every mail carries the seller identity footer", `Footers: ${JSON.stringify(c)}`);
    check(r.rejected?.ok === false && /not verified/.test(r.rejected?.error ?? ""), "E-mail with an unverified domain: Resend answers 422 and the sender returns {ok:false, error} (the old code returned undefined)", `Rejected mail: ${JSON.stringify(r.rejected)}`);
    check(typeof r.alert === "string" && r.alert.includes("E-mail niet verstuurd (bank-transfer-instructions)") && r.alert.includes("not verified"), "E-mail failure is escalated to the owner by template name, with Resend's reason", `No escalation: ${r.alert}`);
    check(r.errorLogged === true, "E-mail failure is logged at error level", `No error log: ${line}`);
    check(r.addressInLogs === false && r.addressInAlert === false, "E-mail failure: the customer's address is in neither the log nor the owner alert", `Address leaked: ${line}`);
    check(r.hung?.ok === false && /timeout/.test(r.hung?.error ?? "") && (r.hungMs ?? 0) >= 9500 && (r.hungMs ?? 0) < 13000, `E-mail to a Resend that never answers: given up after the 10 s transport timeout (${r.hungMs} ms)`, `Hung Resend: ${JSON.stringify(r.hung)} ${r.hungMs} ms`);
    const guard = (extra: Record<string, string>) => {
      const c = spawnSync("npx", ["tsx", __filename, "--prod-guard"], {
        encoding: "utf8",
        env: { ...process.env, NODE_ENV: "production", SLACK_WEBHOOK_URL: "", COMPANY_NAME: "", COMPANY_STREET: "", COMPANY_POSTAL_CODE: "", COMPANY_CITY: "", COMPANY_KVK: "", COMPANY_VAT: "", COMPANY_IBAN: "", ...extra },
      });
      return JSON.parse(c.stdout.split("\n").find((l) => l.startsWith("{")) ?? "{}") as { ok?: boolean; error?: string };
    };
    const partial = guard({ COMPANY_KVK: "90000001" });
    check(partial.ok === false && partial.error === "company_not_ready", "Wire instructions: in production with only COMPANY_KVK set the bank-transfer mail is refused (no placeholder IBAN reaches a customer)", `Wire instructions guard: ${JSON.stringify(partial)}`);
    const whole = guard({ COMPANY_NAME: "WasFix Test B.V.", COMPANY_STREET: "Teststraat 1", COMPANY_POSTAL_CODE: "1011 AB", COMPANY_CITY: "Amsterdam", COMPANY_KVK: "90000001", COMPANY_VAT: "NL900000010B01", COMPANY_IBAN: "NL02ABNA0123456789" });
    check(whole.error !== "company_not_ready", "Wire instructions: with the full identity the mail is attempted (it then fails only at the network)", `Wire instructions with full identity: ${JSON.stringify(whole)}`);

    // ── Half-configured: Resend key but no owner address ──────────────────
    const half = (extra: Record<string, string>, flags: string[] = []) => {
      const c = spawnSync("npx", ["tsx", __filename, "--no-address", ...flags], {
        encoding: "utf8",
        env: { ...process.env, SLACK_WEBHOOK_URL: "", DISCORD_WEBHOOK_URL: "", ORDER_NOTIFY_EMAIL: "", COMPANY_EMAIL: "", ...extra },
      });
      const line = c.stdout.split("\n").find((l) => l.startsWith("{")) ?? "{}";
      return { r: JSON.parse(line) as Record<string, unknown>, raw: `${line} ${c.stderr.slice(0, 300)}` };
    };
    const none = half({});
    check(none.r.has === false && none.r.configured === false && none.r.ownerAddress === null, "No owner address: the invented default support@wasfix.nl is NOT a channel (hasNotifyChannel false, ownerEmailAddress null)", `Default address counted as a channel: ${none.raw}`);
    check(none.r.noChannelWarnings === 1 && none.r.warnsAboutAddress === true, "No owner address: the one-time warning fires and names ORDER_NOTIFY_EMAIL / COMPANY_EMAIL", `No warning for a half-configured shop: ${none.raw}`);
    check(none.r.toDefault === false && JSON.stringify(none.r.recipients) === JSON.stringify(["klant@example.com"]) && none.r.replyTos instanceof Array && (none.r.replyTos as unknown[]).every((x) => x === null), "No owner address: nothing is mailed to the default address and the customer mail carries no reply-to", `Mail went to the default address or has a reply-to: ${none.raw}`);
    const viaSlack = half({}, ["--slack"]);
    const texts = (viaSlack.r.slackTexts as string[] | undefined) ?? [];
    check(texts.some((t) => t.includes("Nieuwe retour-aanvraag") && t.includes("RMA-QA-1")) && texts.every((t) => !t.includes("klant@example.com") && !t.includes("Piet")), "No owner address, Slack set: the RMA alert reaches Slack with the RMA number and no customer data", `RMA alert not routed to Slack: ${viaSlack.raw}`);
    const configured = half({ COMPANY_EMAIL: "owner@example.test" });
    check(configured.r.has === true && configured.r.ownerAddress === "owner@example.test" && (configured.r.recipients as string[]).includes("owner@example.test") && (configured.r.replyTos as unknown[]).includes("klant@example.com"), "A configured COMPANY_EMAIL is the owner channel: the RMA alert goes there (reply-to is the applicant)", `Configured address not used: ${configured.raw}`);
    const customerReply = (configured.r.replyTos as Array<string | null>)[(configured.r.recipients as string[]).indexOf("klant@example.com")];
    check(customerReply === "owner@example.test", "A configured COMPANY_EMAIL is the reply-to of the customer's mail", `Customer mail reply-to is ${customerReply}`);
  } finally {
    console.log(log.join("\n"));
    const failures = log.filter((l) => l.startsWith("❌")).length;
    console.log(`\n${log.length - failures}/${log.length} checks passed`);
    if (failures > 0) process.exitCode = 1;
    process.exit(process.exitCode ?? 0);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
