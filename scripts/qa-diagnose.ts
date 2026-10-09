/**
 * The diagnosis: honesty, quota, cost control, the B2B route and the photo path.
 *
 * Most checks here would have failed on the code before bundle S8 (fixed 87%
 * confidence, a quota unit per chat message, the v1 route calling itself over HTTP,
 * the canned "Bosch E18" photo result) or before the repair round (Dutch ordinals
 * read as error codes, one shared daily budget, no server-side turn bound). Some are
 * plain guards for behaviour that was already right ("unlimited plans touch no monthly
 * counter"); they are not regression tests and are labelled "guard". Source greps are
 * labelled "source"; behaviour that needs a browser is in scripts/qa-diagnose-ui.ts.
 * A fake model stands in for Gemini (no key exists in CI); a local HTTP server stands
 * in for Slack.
 *
 * The checks that look for rows in the shared database look only at the keys THIS
 * script creates (its own IPs and qa-diag- keys), so a row left by something else does
 * not change the result.
 *
 * Usage: DATABASE_URL=postgresql://.../wasfix_a8 npx tsx --conditions=react-server scripts/qa-diagnose.ts
 * The script runs as NODE_ENV=production without INTERNAL_API_KEY and
 * NEXT_PUBLIC_APP_URL on purpose: that is the configuration that broke the B2B API.
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { DiagnoseOutcome, Failure } from "../src/lib/diagnose-core";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (use your own sandbox database)");
  process.exit(2);
}
(process.env as Record<string, string>).NODE_ENV = "production";
delete process.env.INTERNAL_API_KEY;
delete process.env.NEXT_PUBLIC_APP_URL;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_AI_API_KEY;
delete process.env.DEMO_MODE;
delete process.env.RESEND_API_KEY;
delete process.env.DISCORD_WEBHOOK_URL;
delete process.env.ORDER_NOTIFY_EMAIL;
delete process.env.COMPANY_EMAIL;

const log: string[] = [];
let failed = 0;
const check = (cond: boolean, ok: string, bad: string) => {
  if (!cond) failed++;
  log.push(cond ? `✅ ${ok}` : `❌ ${bad}`);
};
const read = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf8");

type Hit = { path: string; body: string };
function slackServer() {
  const hits: Hit[] = [];
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({ path: req.url ?? "", body });
      res.statusCode = 200;
      res.end("ok");
    });
  });
  return new Promise<{ url: string; hits: Hit[]; close: () => void }>((resolve) =>
    srv.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/hook`, hits, close: () => { srv.closeAllConnections?.(); srv.close(); } })),
  );
}

const DIAGNOSIS_TEXT =
  'Waarschijnlijk een afvoerprobleem.\n<diagnosis>{"errorCode":"E18","confidence":70,"mainCause":"Verstopte pluizenfilter of afvoerpomp","alternativeCauses":["Geknikte afvoerslang"],"diyFriendly":true,"urgency":"medium","recommendedAction":"Maak eerst het pluizenfilter schoon","brand":"Bosch"}</diagnosis>';
const CLARIFY_TEXT = "Welk merk wasmachine heb je?";

async function main() {
  const slack = await slackServer();
  process.env.SLACK_WEBHOOK_URL = slack.url;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const core = await import("../src/lib/diagnose-core");
  const gem = await import("../src/lib/gemini");
  const guard = await import("../src/lib/ai-guard");
  const ent = await import("../src/lib/entitlements");
  const { hashApiKey } = await import("../src/lib/api-auth");
  const { NextRequest } = await import("next/server");
  // The key a visitor from this IP gets (a hash, never the raw address).
  const anonKey = (ip: string) => ent.anonymousKey(new NextRequest("http://localhost/x", { headers: { "x-forwarded-for": ip } }));
  const TEST_IPS = Array.from({ length: 40 }, (_, i) => `203.0.113.${i + 5}`);
  const extraKeys: string[] = [];

  // A fake model: counts calls, records what it was given, behaves as scripted.
  const calls: Array<{ kind: "chat" | "image"; system: string; message?: string; mime?: string }> = [];
  let script: (kind: "chat" | "image", n: number) => string | Error = () => DIAGNOSIS_TEXT;
  const backend: import("../src/lib/gemini").AiBackend = {
    name: "fake-model-1",
    async chat({ system, message }) {
      calls.push({ kind: "chat", system, message });
      const r = script("chat", calls.length);
      if (r instanceof Error) throw r;
      return r;
    },
    async describeImage({ system, mimeType }) {
      calls.push({ kind: "image", system, mime: mimeType });
      const r = script("image", calls.length);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  const useModel = (on: boolean) => gem._setAiBackendForTests(on ? backend : null);
  const resetCalls = () => { calls.length = 0; };

  const errors: string[] = [];
  const realError = console.error;
  console.error = (...a: unknown[]) => { errors.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };
  const warnOnly = console.warn;
  const warns: string[] = [];
  console.warn = (...a: unknown[]) => { warns.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };

  const consumerFor = (id: string, limit = 3) => ({ kind: "consumer" as const, userId: null, quotaKey: `ip:qa-diag-${id}`, monthlyLimit: limit });
  const usedOf = async (scope: string, key: string) => (await prisma.usageCounter.findUnique({ where: { scope_key: { scope, key } } }))?.count ?? 0;
  const monthly = (id: string) => usedOf("diagnose", `ip:qa-diag-${id}`);
  const msg = (content: string, role: "user" | "assistant" = "user") => ({ role, content });
  const day = guard.amsterdamDay();
  const dayUsed = (tier: "free" | "paid" | "api") => usedOf("gemini-day", `${day}:${tier}`);
  const seedDay = async (tier: "free" | "paid" | "api", count: number) =>
    prisma.usageCounter.upsert({
      where: { scope_key: { scope: "gemini-day", key: `${day}:${tier}` } },
      create: { scope: "gemini-day", key: `${day}:${tier}`, count, windowEnd: new Date(Date.now() + 2 * 86400_000) },
      update: { count },
    });

  async function cleanup() {
    await prisma.usageCounter.deleteMany({
      where: {
        OR: [
          { key: { contains: "qa-diag-" } },
          ...TEST_IPS.map((ip) => ({ key: { startsWith: anonKey(ip) } })), // the visitor's counters and every "<visitor>|<session>" conversation counter
          ...extraKeys.map((k) => ({ key: { startsWith: k } })),
          { scope: { in: ["gemini-day", "gemini-alert"] } },
        ],
      },
    });
  }
  await cleanup();
  await prisma.diagnosis.deleteMany({ where: { sessionId: { startsWith: "qa-diag-" } } });

  try {
    // ─── 1. Honest fallback ──────────────────────────────────────────────────
    useModel(false);
    guard._resetAiGuardForTests();
    const fb = await core.runDiagnosis({ messages: [msg("Mijn Bosch geeft foutcode E18, water blijft staan")], sessionId: "qa-diag-fb-0001", caller: consumerFor("fb") });
    check(fb.ok === true && fb.mode === "fallback", "No model: the answer is mode 'fallback'", `No model: expected fallback, got ${JSON.stringify(fb).slice(0, 200)}`);
    if (fb.ok) {
      check(fb.model === null, "Fallback reports model null (nothing ran)", `Fallback reports model ${fb.model}`);
      check(fb.label === "Snelle zoekhulp op foutcodes - geen AI-analyse", "Fallback label is exactly 'Snelle zoekhulp op foutcodes - geen AI-analyse'", `Fallback label wrong: ${fb.label}`);
      check(fb.message.includes("Snelle zoekhulp op foutcodes - geen AI-analyse"), "The label is part of the message itself", "Label missing from the message text");
      check(fb.diagnosis !== null && !("confidence" in fb.diagnosis), "Fallback diagnosis carries NO confidence field", `Fallback diagnosis has confidence: ${JSON.stringify(fb.diagnosis)}`);
      check(!/\d\s*%/.test(fb.message) && !/zekerheid/i.test(fb.message), "Fallback text has no percentage and no 'zekerheid'", `Fallback text claims a percentage: ${fb.message.slice(0, 160)}`);
      check(!/gemini|powered by|flash/i.test(fb.message) && !/gemini|flash/i.test(JSON.stringify(fb.model)), "Fallback never names Gemini or a model", "Fallback mentions Gemini/model");
      const row = await prisma.errorCode.findFirst({ where: { code: { equals: "E18", mode: "insensitive" }, machine: { brand: "Bosch" } } });
      check(Boolean(row) && fb.diagnosis?.mainCause === row?.title, `Fallback answers from the sourced table row ('${row?.title}')`, `Fallback cause '${fb.diagnosis?.mainCause}' is not the table row '${row?.title}'`);
      check(fb.notice.includes("geen garantie") && fb.notice.includes("stekker"), "Every result carries the indication-not-guarantee and unplug notice", "Notice missing on the fallback");
      check(fb.recommendedParts.length > 0, "Fallback recommends the catalogue parts linked to the code", "Fallback recommends no parts for Bosch E18");
    }
    check((await monthly("fb")) === 0 && (await usedOf("diagnose-calls", "ip:qa-diag-fb")) === 0, "Fallback consumed no quota and no AI-call budget", "Fallback consumed quota");
    check((await dayUsed("free")) === 0 && (await dayUsed("paid")) === 0 && (await dayUsed("api")) === 0, "Fallback is not metered as a Gemini call (no tier's daily counter touched)", "Fallback was metered against the daily Gemini counter");
    const savedFallback = await prisma.diagnosis.count({ where: { sessionId: "qa-diag-fb-0001" } });
    check(savedFallback === 0, "A fallback lookup is not stored as a diagnosis", "Fallback was stored as a diagnosis row");

    // The old matcher took the Dutch word 'de' for a code and invented a diagnosis.
    const q = gem.parseFallbackQuery;
    check(q(["Bosch lekt onder de deur door"]).code === null, "'onder de deur' is not read as code 'dE'", "'de' in a sentence was read as an error code");
    check(q(["LG trilt en loopt door de kamer"]).code === null, "'door de kamer' is not read as a code", "'de' read as a code in 'door de kamer'");
    check(q(["Samsung dE"]).code === "dE", "'Samsung dE' is read as code dE", `'dE' not recognised: ${q(["Samsung dE"]).code}`);
    check(q(["mijn machine toont foutcode OE"]).code === "OE", "'foutcode OE' is read as OE", "foutcode OE not recognised");
    check(q(["De wasmachine is kapot"]).code === null, "Sentence-case 'De' is not a code", "'De' read as a code");
    check(q(["Miele geeft F11"]).code === "F11" && q(["Miele geeft F11"]).brand === "Miele", "'Miele geeft F11' -> Miele F11", "Miele F11 not parsed");
    const samsungUe = await core.runDiagnosis({ messages: [msg("Samsung UE")], sessionId: "qa-diag-fb-0002", caller: consumerFor("fb2") });
    check(samsungUe.ok === true && samsungUe.mode === "fallback" && !(samsungUe.diagnosis && /koolborstel|lager/i.test(samsungUe.diagnosis.mainCause)), "'Samsung UE' no longer becomes 'koolborstels of trommellager'", "Samsung UE still invents a motor diagnosis");
    const noCode = await core.runDiagnosis({ messages: [msg("Bosch lekt onder de deur door")], sessionId: "qa-diag-fb-0003", caller: consumerFor("fb3") });
    check(noCode.ok === true && noCode.diagnosis === null && !noCode.message.includes("Defect deurslot") && !/\d\s*%/.test(noCode.message), "Symptom without a code: no invented diagnosis, no percentage", `Symptom-only answer invented a diagnosis: ${noCode.ok ? noCode.message.slice(0, 200) : ""}`);
    const unknownCode = await core.runDiagnosis({ messages: [msg("Bosch foutcode E999")], sessionId: "qa-diag-fb-0004", caller: consumerFor("fb4") });
    check(unknownCode.ok === true && unknownCode.diagnosis === null && /staat niet in onze database/.test(unknownCode.message), "An unknown code is reported as unknown, not guessed", "Unknown code did not say so");
    const ambiguous = await core.runDiagnosis({ messages: [msg("foutcode E18")], sessionId: "qa-diag-fb-0005", caller: consumerFor("fb5") });
    check(ambiguous.ok === true && ambiguous.diagnosis === null && /betekent per merk iets anders/.test(ambiguous.message), "A code that exists for several brands asks for the brand", "Ambiguous code was not disambiguated");

    // Dutch ordinals and numbers are not error codes (the same class of bug as 'de' = dE).
    const ordinalCases: Array<[string[], string | null, string | null, string]> = [
      [["Mijn Samsung lekt bij de 2e wasbeurt"], "Samsung", null, "'bij de 2e wasbeurt'"],
      [["Mijn wasmachine is van 2e hands en trilt"], null, null, "'van 2e hands'"],
      [["mijn wasmachine heeft h 2 uur nodig"], null, null, "'h 2 uur'"],
      [["Bij de 4e keer stopt hij weer, Samsung"], "Samsung", null, "'bij de 4e keer'"],
      [["hij staat op de 1e verdieping"], null, null, "'op de 1e verdieping'"],
      [["wasmachine staat op 40 graden"], null, null, "'staat op 40 graden'"],
      [["Bosch 8 kg en 1400 toeren"], "Bosch", null, "'Bosch 8 kg'"],
      [["Miele WM14 doet het niet"], "Miele", null, "a model name after the brand"],
    ];
    for (const [texts, brand, code, label] of ordinalCases) {
      const r = q(texts);
      check(r.code === code && r.brand === brand, `${label}: not read as a code (brand ${brand}, code ${code})`, `${label}: parsed as brand ${r.brand}, code ${r.code}`);
    }
    // ...while the real ways of typing a code still work.
    const goodCases: Array<[string[], string, string, string]> = [
      [["Samsung 4e"], "Samsung", "4e", "brand + lower-case digit-letter"],
      [["foutcode 4e"], "", "4e", "explicit 'foutcode' + digit-letter"],
      [["bosch e18"], "Bosch", "e18", "lower-case letter-digits after a brand"],
      [["mijn wasmachine geeft e18"], "", "e18", "context word + letter-digits"],
      [["LG PE"], "LG", "PE", "two capitals after a brand (a real LG code)"],
      [["LG dE1"], "LG", "dE1", "dE1"],
      [["Mijn Bosch geeft de foutcode E18"], "Bosch", "E18", "'geeft de foutcode E18' (the article after 'geeft' is not the code)"],
    ];
    for (const [texts, brand, code, label] of goodCases) {
      const r = q(texts);
      check(r.code === code && (brand === "" || r.brand === brand), `${label}: ${code}`, `${label}: got brand ${r.brand}, code ${r.code}`);
    }
    // A corrected or multi-turn conversation: newest message first, per field.
    check(q(["Bosch E18", "nee, Miele F11"]).brand === "Miele" && q(["Bosch E18", "nee, Miele F11"]).code === "F11", "Corrected conversation ['Bosch E18','nee, Miele F11'] -> Miele F11 (a pair from one message)", `corrected conversation: ${JSON.stringify(q(["Bosch E18", "nee, Miele F11"]))}`);
    check(q(["Bosch E18", "nee, F11"]).brand === "Bosch" && q(["Bosch E18", "nee, F11"]).code === "F11", "...a new code with no brand keeps the brand from the earlier turn", `code-only correction: ${JSON.stringify(q(["Bosch E18", "nee, F11"]))}`);
    check(q(["Bosch E18", "Miele"]).brand === "Miele" && q(["Bosch E18", "Miele"]).code === "E18", "...a new brand with no code keeps the code from the earlier turn", `brand-only correction: ${JSON.stringify(q(["Bosch E18", "Miele"]))}`);
    check(q(["E18", "het is een Bosch"]).brand === "Bosch" && q(["E18", "het is een Bosch"]).code === "E18", "...the brand may come after the code", "brand after code not found");
    const corrected = await core.runDiagnosis({ messages: [msg("Bosch E18"), msg("x", "assistant"), msg("nee, Miele F11")], sessionId: "qa-diag-fb-0006", caller: consumerFor("fb6") });
    check(corrected.ok === true && corrected.mode === "fallback" && /Foutcode F11 \(Miele\)/.test(corrected.message), "...and the fallback answers Miele F11, not 'Miele E18 staat niet in onze database'", `corrected fallback: ${corrected.ok ? corrected.message.slice(0, 160) : ""}`);
    const ordinalAnswer = await core.runDiagnosis({ messages: [msg("Mijn Samsung lekt bij de 2e wasbeurt")], sessionId: "qa-diag-fb-0007", caller: consumerFor("fb7") });
    check(ordinalAnswer.ok === true && ordinalAnswer.diagnosis === null && !/Spanningsstoring|EcoBubble|175/.test(ordinalAnswer.message) && ordinalAnswer.recommendedParts.length === 0, "...so 'Samsung lekt bij de 2e wasbeurt' no longer recommends a Samsung board for code 2E", `ordinal answered: ${ordinalAnswer.ok ? ordinalAnswer.message.slice(0, 160) : ""}`);
    const noBrand = await core.runDiagnosis({ messages: [msg("foutcode F11")], sessionId: "qa-diag-fb-0008", caller: consumerFor("fb8") });
    check(noBrand.ok === true && noBrand.mode === "fallback" && (!noBrand.diagnosis || /Je noemde geen merk/.test(noBrand.message)), "A code with no brand never reads as certain: the answer says which brand it is for and asks", `code without brand: ${noBrand.ok ? noBrand.message.slice(0, 220) : ""}`);
    // Recall: every code in the table, typed the two usual ways, is found with its brand.
    const allCodes = await prisma.errorCode.findMany({ select: { code: true, machine: { select: { brand: true } } } });
    const pairs = [...new Map(allCodes.map((r) => [`${r.machine.brand}|${r.code}`, r])).values()];
    for (const [name, form] of [["'Brand code'", (b: string, c: string) => `${b} ${c}`], ["'foutcode'", (b: string, c: string) => `mijn ${b} heeft foutcode ${c} en doet niets`]] as const) {
      const missed = pairs.filter((r) => { const x = q([form(r.machine.brand, r.code)]); return !(x.code?.toLowerCase() === r.code.toLowerCase() && x.brand === r.machine.brand); });
      check(missed.length === 0, `Recall ${name}: all ${pairs.length} codes in the table are recognised with their brand`, `Recall ${name}: missed ${missed.map((m) => `${m.machine.brand} ${m.code}`).join(", ")}`);
    }

    // ─── 2. AI mode: truthful model name, notice, grounding, live catalogue ───
    useModel(true);
    guard._resetAiGuardForTests();
    resetCalls();
    script = () => DIAGNOSIS_TEXT;
    const ai = await core.runDiagnosis({ messages: [msg("Bosch E18, water blijft staan")], sessionId: "qa-diag-ai-0001", caller: consumerFor("ai") });
    check(ai.ok === true && ai.mode === "ai" && ai.model === "fake-model-1" && ai.label === null, "AI answer: mode 'ai' and the model that really ran", `AI answer wrong: ${JSON.stringify(ai).slice(0, 200)}`);
    if (ai.ok) {
      check(ai.diagnosis?.confidence === 70, "AI confidence is the model's own number, passed through", "AI confidence lost");
      check(!ai.message.includes("<diagnosis>"), "The <diagnosis> block is stripped from the message", "Message still contains the JSON block");
      check(ai.notice.includes("geen garantie"), "AI answers carry the same notice", "AI answer has no notice");
      const json = JSON.stringify(ai);
      check(!/costEur|supplier|costSource/.test(json), "Recommended parts expose no cost or supplier", "Cost/supplier leaked in the response");
      check(ai.recommendedParts.length > 0, "AI answer links catalogue parts", "No parts recommended for E18");
    }
    check(calls[0]?.system.includes("DATABASE-GEGEVENS (uit de foutcode-database") && calls[0].system.includes("Afvoer fout") && /Betekenis (gecontroleerd|niet bevestigd)/.test(calls[0].system) && !calls[0].system.includes("DATABASE-GEGEVENS (gecontroleerd"), "A recognised code puts the table row into the model prompt, with its own verified/unconfirmed label per row (the header no longer claims 'gecontroleerd' for all)", "Model prompt has no database grounding");
    resetCalls();
    await core.runDiagnosis({ messages: [msg("Mijn wasmachine maakt lawaai")], sessionId: "qa-diag-ai-0002", caller: consumerFor("ai2") });
    check(!calls[0]?.system.includes("DATABASE-GEGEVENS ("), "Without a recognised code nothing is injected", "Grounding injected without a code");
    resetCalls();
    await core.runDiagnosis({ messages: [msg("Mijn Samsung lekt bij de 2e wasbeurt")], sessionId: "qa-diag-ai-0004", caller: consumerFor("ai4") });
    check(!calls[0]?.system.includes("DATABASE-GEGEVENS ("), "'bij de 2e wasbeurt' puts NO database row into the model prompt (the AI path used the same wrong parse)", `ordinal grounded the model: ${calls[0]?.system.slice(-200)}`);
    resetCalls();
    await core.runDiagnosis({ messages: [msg("foutcode F11")], sessionId: "qa-diag-ai-0005", caller: consumerFor("ai5") });
    check(calls[0]?.system.includes("DATABASE-GEGEVENS (") && /geen merk genoemd/.test(calls[0].system), "A code without a brand is grounded but the model is told the brand was not named", `no-brand grounding: ${calls[0]?.system.slice(-260)}`);

    // live price/stock: change a part and see the answer change without any cache
    const linked = ai.ok ? ai.recommendedParts[0] : null;
    if (linked) {
      const before = await prisma.part.findUnique({ where: { id: linked.id }, select: { stock: true, priceEur: true } });
      await prisma.part.update({ where: { id: linked.id }, data: { stock: 0, priceEur: 77.77 } });
      const live = await core.runDiagnosis({ messages: [msg("Bosch E18, water blijft staan")], sessionId: "qa-diag-ai-0003", caller: consumerFor("ai3") });
      const again = live.ok ? live.recommendedParts.find((p) => p.id === linked.id) : undefined;
      check(Boolean(again) && again!.stock === 0 && again!.priceEur === 77.77, "Recommended parts show the live price and stock (sold out stays visible with stock 0)", `Parts not live: ${JSON.stringify(again)}`);
      await prisma.part.update({ where: { id: linked.id }, data: { stock: before!.stock, priceEur: before!.priceEur } });
    }

    // ─── 3. Quota: one unit per conversation, not per message ───────────────
    useModel(true);
    guard._resetAiGuardForTests();
    resetCalls();
    const turns = [CLARIFY_TEXT, CLARIFY_TEXT, DIAGNOSIS_TEXT, DIAGNOSIS_TEXT];
    let t = 0;
    script = () => turns[Math.min(t++, turns.length - 1)];
    const free = consumerFor("quota");
    const convo = async (session: string, texts: string[]) => {
      const history: Array<{ role: "user" | "assistant"; content: string }> = [];
      let last: DiagnoseOutcome | null = null;
      for (const text of texts) {
        history.push(msg(text));
        last = await core.runDiagnosis({ messages: [...history], sessionId: session, caller: free });
        if (last.ok) history.push(msg(last.message, "assistant"));
      }
      return last!;
    };
    const first = await convo("qa-diag-quota-A001", ["Hallo, mijn wasmachine is kapot", "Bosch", "E18 water blijft staan", "en nu?"]);
    check(first.ok === true && first.diagnosis !== null, "A free visitor gets a finished diagnosis in a 4-message conversation", `Free visitor never saw a result: ${JSON.stringify(first).slice(0, 160)}`);
    check((await monthly("quota")) === 1, "4 messages in one conversation cost ONE free diagnosis (was 4)", `Conversation cost ${await monthly("quota")} units`);
    if (first.ok) check(first.quota?.used === 1 && first.quota.remaining === 2 && first.quota.limit === 3, "The response tells how many remain (2 of 3)", `quota in response: ${JSON.stringify(first.quota)}`);
    t = 0; script = () => DIAGNOSIS_TEXT;
    await convo("qa-diag-quota-B001", ["Bosch E18"]);
    await convo("qa-diag-quota-C001", ["Bosch E18"]);
    check((await monthly("quota")) === 3, "Three conversations = 3 units", `Units after three conversations: ${await monthly("quota")}`);
    resetCalls();
    const fourth = await convo("qa-diag-quota-D001", ["Bosch E18"]);
    check(!fourth.ok && fourth.status === 429 && (fourth as Failure).details?.code === "limit_reached" && calls.length === 0, "The 4th conversation is refused (429 limit_reached) before any model call", `4th conversation: ${JSON.stringify(fourth).slice(0, 160)}, model calls ${calls.length}`);
    const stillOpen = await core.runDiagnosis({ messages: [msg("Bosch E18"), msg("x", "assistant"), msg("nog een vraag")], sessionId: "qa-diag-quota-A001", caller: free });
    check(stillOpen.ok === true, "An already paid conversation can still continue at the limit", "A paid conversation was cut off at the limit");

    // exhausted visitor cannot ride a fresh session id, not even in parallel
    resetCalls();
    const rides = await Promise.all(Array.from({ length: 6 }, () => core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-ride-0001", caller: free })));
    check(rides.every((r) => !r.ok && r.status === 429) && calls.length === 0, "6 parallel requests on a new session at the limit: all refused, model never called", `${rides.filter((r) => r.ok).length} of 6 got through at the limit`);

    // 10 parallel conversations on a fresh visitor with a 3-allowance
    resetCalls();
    const par = consumerFor("par");
    const burst = await Promise.all(Array.from({ length: 10 }, (_, i) => core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: `qa-diag-par-${String(i).padStart(4, "0")}`, caller: par })));
    check(burst.filter((r) => r.ok).length === 3 && calls.length === 3 && (await monthly("par")) === 3, "10 parallel conversations on a 3-allowance: exactly 3 answered, 3 model calls, counter 3", `${burst.filter((r) => r.ok).length} answered, ${calls.length} model calls, counter ${await monthly("par")}`);

    // parallel messages of ONE new conversation pay once
    resetCalls();
    const same = consumerFor("same", 10);
    const dup = await Promise.all(Array.from({ length: 5 }, () => core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-same-0001", caller: same })));
    check(dup.every((r) => r.ok) && (await monthly("same")) === 1, "5 parallel messages of one new conversation cost one unit", `counter ${await monthly("same")} after 5 parallel messages of one conversation`);

    // paid plans: unlimited, no counter row
    const paid = consumerFor("paid", -1);
    for (let i = 0; i < 5; i++) await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: `qa-diag-paid-${String(i).padStart(4, "0")}`, caller: paid });
    check((await monthly("paid")) === 0, "guard: unlimited plans keep their rule: no monthly counter is touched", "Unlimited plan consumed monthly units");
    check((await usedOf("diagnose-calls", "ip:qa-diag-paid")) === 5, "...but the per-identity daily bound still counts them", "Daily identity bound not counted for a paid plan");

    // Server-side conversation bound: single-message payloads under ONE sessionId used to get 60 model calls for 1 unit.
    resetCalls();
    const looper = consumerFor("loop");
    const loopStatuses: number[] = [];
    for (let i = 0; i < core.MAX_USER_TURNS + 8; i++) loopStatuses.push((await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-loop-0001", caller: looper })).ok ? 200 : 422);
    check(calls.length === core.MAX_USER_TURNS && loopStatuses.slice(0, core.MAX_USER_TURNS).every((x) => x === 200) && loopStatuses.slice(core.MAX_USER_TURNS).every((x) => x === 422), `One sessionId with single-message payloads: ${core.MAX_USER_TURNS} model calls, then refused (was 60)`, `loop: ${calls.length} model calls, statuses ${loopStatuses.join(",")}`);
    check((await monthly("loop")) === 1, "...for exactly one conversation unit", `loop cost ${await monthly("loop")} units`);

    // 12 parallel messages of ONE new conversation on a 1-unit allowance: nobody is refused for a race
    resetCalls();
    const racer = consumerFor("race", 1);
    const race = await Promise.all(Array.from({ length: core.MAX_USER_TURNS }, () => core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-race-0001", caller: racer })));
    check(race.every((r) => r.ok) && (await monthly("race")) === 1, `${core.MAX_USER_TURNS} parallel messages of one new conversation on a 1-unit allowance: all answered, one unit (was ~1 in 3 refused)`, `${race.filter((r) => !r.ok).length} of ${core.MAX_USER_TURNS} refused, counter ${await monthly("race")}`);

    // daily bound per plan
    const freeBound = consumerFor("fbound");
    await prisma.usageCounter.create({ data: { scope: "diagnose-calls", key: "ip:qa-diag-fbound", count: core.FREE_DAILY_CALLS, windowEnd: new Date(Date.now() + 86400_000) } });
    resetCalls();
    const fb429 = await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-fbound-001", caller: freeBound });
    check(!fb429.ok && fb429.status === 429 && (fb429 as Failure).details?.code === "daily_limit" && calls.length === 0 && (await monthly("fbound")) === 0, `A free identity is bounded at ${core.FREE_DAILY_CALLS} model calls a day, with no model call and no unit spent`, `free daily bound: ${JSON.stringify(fb429).slice(0, 140)}`);
    const paidBound = consumerFor("pbound", -1);
    await prisma.usageCounter.create({ data: { scope: "diagnose-calls", key: "ip:qa-diag-pbound", count: core.PAID_DAILY_CALLS - 1, windowEnd: new Date(Date.now() + 86400_000) } });
    const p1 = await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-pbound-001", caller: paidBound });
    const p2 = await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-pbound-002", caller: paidBound });
    check(p1.ok && !p2.ok && p2.status === 429 && /eerlijk gebruik/.test((p2 as Failure).error) && (p2 as Failure).error.includes(String(core.PAID_DAILY_CALLS)), `A paid plan has a disclosed fair-use bound of ${core.PAID_DAILY_CALLS} AI messages a day; the refusal names it`, `paid daily bound: ${JSON.stringify(p2).slice(0, 200)}`);

    // conversation length bound
    const long = await core.runDiagnosis({ messages: Array.from({ length: core.MAX_USER_TURNS + 1 }, (_, i) => msg(`vraag ${i}`)), sessionId: "qa-diag-long-0001", caller: consumerFor("long") });
    check(!long.ok && long.status === 422 && (long as Failure).details?.code === "conversation_too_long", "A conversation past the turn limit is refused (422)", `Long conversation: ${JSON.stringify(long).slice(0, 120)}`);

    // ─── 4. Refund when the upstream fails ──────────────────────────────────
    useModel(true);
    guard._resetAiGuardForTests();
    await prisma.usageCounter.deleteMany({ where: { scope: "gemini-day" } });
    resetCalls();
    script = () => Object.assign(new Error("[GoogleGenerativeAI Error]: [503 Service Unavailable] The model is overloaded"), { status: 503 });
    const down = consumerFor("down");
    const failedTurn = await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-down-0001", caller: down });
    check(failedTurn.ok === true && failedTurn.mode === "fallback" && failedTurn.fallbackReason === "error" && failedTurn.model === null, "Model error: the visitor gets the labelled fallback, model null", `Model error answer: ${JSON.stringify(failedTurn).slice(0, 160)}`);
    check((await monthly("down")) === 0 && (await usedOf("diagnose-conv", "ip:qa-diag-down|qa-diag-down-0001")) === 0 && (await usedOf("diagnose-calls", "ip:qa-diag-down")) === 0, "...and the quota unit, the conversation marker and the daily-bound unit are refunded", "A failed model call kept quota units");
    check((await dayUsed("free")) === 0, "...and a 503 gives the daily Gemini budget unit back too", `Daily budget after a 503: ${await dayUsed("free")}`);
    // the same visitor can still use all three after three failures
    for (let i = 0; i < 3; i++) await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: `qa-diag-down-${String(i + 10).padStart(4, "0")}`, caller: down });
    check((await monthly("down")) === 0, "Three failed conversations leave the allowance untouched", "Allowance eaten by failures");
    // a timeout may have been billed: the daily budget keeps that unit, the visitor does not pay
    script = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-down-0099", caller: down });
    check((await monthly("down")) === 0 && (await dayUsed("free")) === 1, "A timeout refunds the visitor but keeps the daily budget unit (the call may have been billed)", `after timeout: monthly ${await monthly("down")}, daily ${await dayUsed("free")}`);
    // A key that reaches an error message must not reach the log. The Gemini SDK or a proxy can echo a URL with ?key=...
    errors.length = 0;
    warns.length = 0;
    // Assembled at run time: a literal in the Google API key shape is refused by GitHub push protection.
    const leakedKey = ["AIza", "SyD-FAKEKEYFORTESTING0123456789abcd"].join("");
    // Once as an unclassifiable error (logged with error), once as a 503 (logged with warn): both paths redact.
    script = () => new Error(`fetch failed: https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=${leakedKey}`);
    await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-down-0098", caller: down });
    script = () => Object.assign(new Error(`503 Service Unavailable ?key=${leakedKey}`), { status: 503 });
    await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-down-0097", caller: down });
    const logged = [...errors, ...warns];
    check(errors.some((e) => /ai-guard/.test(e)) && warns.some((e) => /ai-guard/.test(e)) && logged.every((e) => !e.includes(leakedKey) && !/AIza/.test(e)) && logged.filter((e) => e.includes("[redacted-key]")).length >= 2, "An API key inside a Gemini error message is redacted before it is logged (error and warn paths)", `log lines: ${logged.join(" // ").slice(0, 300)}`);
    check(guard.redactSecrets(`x ${leakedKey} y`) === "x [redacted-key] y", "redactSecrets removes a key-shaped string", "redactSecrets did not redact");

    // ─── 5. Daily cap and owner notice ──────────────────────────────────────
    useModel(true);
    guard._resetAiGuardForTests();
    script = () => DIAGNOSIS_TEXT;
    await prisma.usageCounter.deleteMany({ where: { scope: { in: ["gemini-day", "gemini-alert"] } } });
    slack.hits.length = 0;
    const paidCap = guard.GEMINI_TIER_DAILY_CAPS.paid;
    const warnAt = Math.ceil(paidCap * guard.DAILY_WARN_FRACTION);
    await seedDay("paid", warnAt - 1);
    resetCalls();
    const cap = consumerFor("cap", -1);
    await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-cap-00001", caller: cap });
    await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-cap-00002", caller: cap });
    check(slack.hits.length === 1 && /AI-aanroepen vandaag voor betalende klanten/i.test(slack.hits[0].body), "Crossing 80% of a tier's daily cap notifies the owner exactly once", `80% alert hits: ${slack.hits.length} ${slack.hits[0]?.body.slice(0, 120)}`);
    await seedDay("paid", paidCap);
    resetCalls();
    slack.hits.length = 0;
    const over1 = await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-cap-00003", caller: cap });
    const over2 = await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-cap-00004", caller: cap });
    check(over1.ok && over1.mode === "fallback" && over1.fallbackReason === "daily_cap" && over2.ok && over2.mode === "fallback" && calls.length === 0, "At a tier's daily cap that tier degrades to the labelled fallback and the model is not called", `At cap: ${JSON.stringify(over1).slice(0, 120)}, model calls ${calls.length}`);
    check(slack.hits.length === 1 && /limiet bereikt/i.test(slack.hits[0].body), "...and the owner is told ONCE that the cap was reached", `cap alert hits: ${slack.hits.length}`);
    check(slack.hits.length > 0 && !/@\w+\.\w+/.test(slack.hits[0].body) && !/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/.test(slack.hits[0].body), "The owner notice carries no e-mail address", "Owner notice contains an address (or was never sent)");
    check((await dayUsed("paid")) === paidCap, "A refused request does not push the daily counter past the cap", `daily counter ${await dayUsed("paid")}`);

    // The tiers are separate: one tier at its cap does not switch off the others.
    resetCalls();
    const stillFree = await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-tier-0001", caller: consumerFor("tierfree") });
    check(stillFree.ok && stillFree.mode === "ai", "Paying customers at their cap do not switch off the AI for free visitors (separate budgets)", `free visitor while paid is capped: ${JSON.stringify(stillFree).slice(0, 120)}`);
    await seedDay("api", guard.GEMINI_TIER_DAILY_CAPS.api);
    const paidOk = await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-tier-0002", caller: consumerFor("tierpaid", -1) });
    const apiCapped = await core.runDiagnosis({ messages: [msg("x")], caller: { kind: "api" } });
    check(paidOk.ok && paidOk.mode === "fallback" && paidOk.fallbackReason === "daily_cap", "(the paid tier itself is still capped: labelled fallback)", "paid tier not capped");
    check(!apiCapped.ok && apiCapped.status === 503, "The B2B API answers 503 (not a keyword fallback) at ITS cap", "API at cap did not 503");
    await seedDay("paid", 0);
    const paidAfterApi = await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-tier-0003", caller: consumerFor("tierpaid", -1) });
    check(paidAfterApi.ok && paidAfterApi.mode === "ai", "...and an API tier at its cap does not touch paying consumers", `paid user while api is capped: ${JSON.stringify(paidAfterApi).slice(0, 120)}`);
    const gate = await core.aiServiceState(consumerFor("tierfree"));
    await seedDay("free", guard.GEMINI_TIER_DAILY_CAPS.free);
    const gateCapped = await core.aiServiceState(consumerFor("tierfree"));
    check(gate.available && !gateCapped.available && gateCapped.reason === "daily_cap", "GET /api/diagnose's gate reports daily_cap for a capped tier (the page header no longer promises an AI that cannot answer)", `gate ${JSON.stringify(gate)} / ${JSON.stringify(gateCapped)}`);

    // ─── 6. Retired model: visible failure, one notice, no endless retries ──
    useModel(true);
    guard._resetAiGuardForTests();
    await prisma.usageCounter.deleteMany({ where: { scope: { in: ["gemini-day", "gemini-alert"] } } });
    slack.hits.length = 0;
    errors.length = 0;
    resetCalls();
    script = () => Object.assign(new Error("[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent: [404 Not Found] models/gemini-2.0-flash is no longer available"), { status: 404 });
    const gone1 = await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-gone-0001", caller: consumerFor("gone") });
    const gone2 = await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-gone-0002", caller: consumerFor("gone") });
    const gone3 = await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-gone-0003", caller: consumerFor("gone") });
    check(gone1.ok && gone1.mode === "fallback" && gone1.fallbackReason === "model_unavailable", "A retired model is shown as fallback (reason model_unavailable), not as AI", `retired model: ${JSON.stringify(gone1).slice(0, 140)}`);
    check(errors.some((e) => /GEMINI_MODEL/.test(e)), "...and logged with logger.error naming GEMINI_MODEL", "No error log naming GEMINI_MODEL");
    check(slack.hits.length === 1 && /model niet gevonden/i.test(slack.hits[0].body) && /GEMINI_MODEL/.test(slack.hits[0].body), "...and the owner gets ONE notice telling them to set GEMINI_MODEL", `retired-model notices: ${slack.hits.length}`);
    check(calls.length === 1 && gone2.ok && gone3.ok && gone2.fallbackReason === "model_unavailable", "...and the next requests skip the doomed call (circuit open), 1 model call in total", `model calls with a retired model: ${calls.length}`);
    check((await monthly("gone")) === 0, "...and nobody paid a unit for it", "Units spent on a retired model");
    const { classifyGeminiError } = gem;
    check(classifyGeminiError(Object.assign(new Error("API key not valid. Please pass a valid API key."), { status: 400 })) === "auth", "classify: Google's 400 'API key not valid' is an auth failure", "classify: invalid key misread");
    check(classifyGeminiError(Object.assign(new Error("Resource has been exhausted"), { status: 429 })) === "quota" && classifyGeminiError(new Error("fetch failed")) === "other", "classify: 429 is quota, unknown errors are 'other'", "classify wrong");
    guard._resetAiGuardForTests();

    // ─── 7. The B2B route: in-process, production, no INTERNAL_API_KEY ──────
    const user = await prisma.user.upsert({
      where: { email: "qa-diag-b2b@wasfixpro.test" },
      update: { plan: "MONTEUR_PRO", stripeSubStatus: "active" },
      create: { email: "qa-diag-b2b@wasfixpro.test", name: "QA B2B", plan: "MONTEUR_PRO", stripeSubStatus: "active", role: "CONSUMER" },
    });
    const apiKey = "wf_live_qadiagnosekey000000000000000001";
    await prisma.apiKey.deleteMany({ where: { userId: user.id } });
    await prisma.apiKey.create({ data: { userId: user.id, name: "qa", prefix: apiKey.slice(0, 14), hash: hashApiKey(apiKey), scopes: "read:parts,read:errorcodes", rateLimit: 1000 } });
    const acct = `acct:${user.id}`;
    extraKeys.push(acct);
    await prisma.usageCounter.deleteMany({ where: { key: acct } });
    // What the route's own visitor IP would have been charged if the call had fallen into the visitor bucket.
    const v1Visitor = anonKey("203.0.113.9");
    const visitorUnits = async () => (await usedOf("diagnose", v1Visitor)) + (await usedOf("diagnose-calls", v1Visitor));
    const v1 = await import("../src/app/api/v1/diagnose/route");
    const v1call = (extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
      v1.POST(new NextRequest("http://localhost/api/v1/diagnose", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...headers },
        body: JSON.stringify({ brand: "Bosch", errorCode: "E18", symptoms: "Foutcode E18, water blijft staan", ...extra }),
      }));

    const realFetch = globalThis.fetch;
    const fetched: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      fetched.push(String(input));
      return realFetch(input, init);
    }) as typeof fetch;

    useModel(true);
    guard._resetAiGuardForTests();
    script = () => DIAGNOSIS_TEXT;
    resetCalls();
    const statuses: number[] = [];
    let lastBody: { data?: { diagnosis?: unknown; notice?: string }; meta?: { model_used?: string; mode?: string } } = {};
    for (let i = 0; i < 5; i++) {
      const res = await v1call();
      statuses.push(res.status);
      lastBody = await res.json();
    }
    check(statuses.every((s) => s === 200), "v1/diagnose: 5 calls in a production env without INTERNAL_API_KEY / NEXT_PUBLIC_APP_URL -> 5 x 200 (was 200,200,200,502,502)", `statuses ${statuses.join(",")}`);
    check(!fetched.some((u) => u.includes("/api/diagnose")) && !fetched.some((u) => u.includes("localhost:3000")), "...with no HTTP call to /api/diagnose at all", `fetched: ${fetched.join(", ")}`);
    check((await usedOf("api", acct)) === 5, "...metered 5 against the account's API allowance", `api counter ${await usedOf("api", acct)}`);
    check((await visitorUnits()) === 0, "...and the anonymous visitor quota of the caller's IP was never touched (was: INTERNAL_API_KEY missing -> everything in the 3/month bucket)", `visitor units for the API caller's IP: ${await visitorUnits()}`);
    check((await usedOf("diagnose-calls", acct)) === 5, "...and the account's own daily bound counts the 5 calls", `account daily counter ${await usedOf("diagnose-calls", acct)}`);
    check(lastBody.meta?.model_used === "fake-model-1" && lastBody.meta?.mode === "ai", "meta.model_used is the model that really ran", `meta ${JSON.stringify(lastBody.meta)}`);
    check(Boolean(lastBody.data?.notice), "The API response carries the indication notice", "API response has no notice");
    const dbRows = await prisma.diagnosis.count({ where: { sessionId: { startsWith: "qa-diag-api" } } });
    check(dbRows === 0, "API traffic is not stored as consumer diagnoses", "API call stored a diagnosis");

    // language is real now
    resetCalls();
    await v1call({ language: "de" });
    check(calls[0]?.system.includes("Deutsch"), "language=de reaches the model prompt", "language is still ignored");
    await prisma.usageCounter.update({ where: { scope_key: { scope: "api", key: acct } }, data: { count: 5 } });

    // failures are not billed
    script = () => Object.assign(new Error("boom"), { status: 500 });
    const r500 = await v1call();
    check(r500.status === 502 && (await usedOf("api", acct)) === 5, "upstream failure -> 502 and the call is NOT metered (refund)", `status ${r500.status}, api counter ${await usedOf("api", acct)}`);
    script = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    const r504 = await v1call();
    check(r504.status === 504 && (await usedOf("api", acct)) === 5, "timeout -> 504 and not metered", `status ${r504.status}, api counter ${await usedOf("api", acct)}`);

    // no model: loud 503, nothing metered, not the anonymous bucket
    useModel(false);
    errors.length = 0;
    const r503 = await v1call();
    const b503 = await r503.json();
    check(r503.status === 503 && r503.headers.get("retry-after") === "300" && (await usedOf("api", acct)) === 5, "no model -> 503 with Retry-After, not metered", `status ${r503.status}, api counter ${await usedOf("api", acct)}`);
    check(errors.some((e) => /GEMINI_API_KEY/.test(e)), "...and logger.error says GEMINI_API_KEY is not configured", "misconfiguration not logged");
    check(!("data" in b503) && (await visitorUnits()) === 0, "...and no keyword answer was served as the product, nothing charged to the caller's IP bucket", "API served a fallback answer");
    // a 400 costs nothing
    useModel(true);
    const bad = await v1.POST(new NextRequest("http://localhost/api/v1/diagnose", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ brand: "Bosch" }) }));
    check(bad.status === 400 && (await usedOf("api", acct)) === 5, "malformed request -> 400, not metered", `status ${bad.status}`);
    // monthly cap still holds
    await prisma.usageCounter.update({ where: { scope_key: { scope: "api", key: acct } }, data: { count: 1000 } });
    script = () => DIAGNOSIS_TEXT;
    resetCalls();
    const r429 = await v1call();
    check(r429.status === 429 && calls.length === 0, "monthly allowance exhausted -> 429 without a model call", `status ${r429.status}`);
    globalThis.fetch = realFetch;

    // one-shot: the model is told not to ask questions; a call that still ends without a diagnosis is not billed
    await prisma.usageCounter.update({ where: { scope_key: { scope: "api", key: acct } }, data: { count: 5 } });
    resetCalls();
    script = () => CLARIFY_TEXT;
    const rAsk = await v1call();
    const bAsk = await rAsk.json();
    check(/eenmalige aanvraag/.test(calls[0]?.system ?? "") && /Stel geen vragen/.test(calls[0]?.system ?? ""), "The API prompt says it is a one-shot request: no questions", "API prompt still invites clarifying questions");
    check(rAsk.status === 200 && bAsk.data.diagnosis === null && bAsk.meta.counted === false && (await usedOf("api", acct)) === 5, "A one-shot answer without a diagnosis is returned but NOT counted (meta.counted false, allowance unchanged)", `question answer: ${rAsk.status} counted ${bAsk.meta?.counted}, api counter ${await usedOf("api", acct)}`);
    script = () => DIAGNOSIS_TEXT;
    const rGood = await v1call();
    check(rGood.status === 200 && (await rGood.json()).meta.counted === true && (await usedOf("api", acct)) === 6, "...while an answer with a diagnosis is counted", "good answer not counted");
    // per-account daily bound (a twentieth of the monthly allowance, at least 50): API callers used to escape every identity bound
    await prisma.usageCounter.update({ where: { scope_key: { scope: "api", key: acct } }, data: { count: 6 } });
    const dailyLimit = guard.apiAccountDailyCalls(1000);
    await prisma.usageCounter.upsert({
      where: { scope_key: { scope: "diagnose-calls", key: acct } },
      create: { scope: "diagnose-calls", key: acct, count: dailyLimit, windowEnd: new Date(Date.now() + 86400_000) },
      update: { count: dailyLimit },
    });
    resetCalls();
    const rDaily = await v1call();
    check(guard.apiAccountDailyCalls(1000) === 50 && rDaily.status === 429 && calls.length === 0 && (await usedOf("api", acct)) === 6, "An API account is bounded per day (1,000/month -> 50/day): 429, no model call, the monthly allowance is given back", `daily bound: ${rDaily.status}, model calls ${calls.length}, api counter ${await usedOf("api", acct)}`);
    await prisma.usageCounter.deleteMany({ where: { scope: "diagnose-calls", key: acct } });
    // the daily budget of the api tier is separate from the consumers'
    await seedDay("api", guard.GEMINI_TIER_DAILY_CAPS.api);
    const rApiCap = await v1call();
    const consumerDuringApiCap = await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-tier-0010", caller: consumerFor("tierpaid2", -1) });
    check(rApiCap.status === 503 && consumerDuringApiCap.ok && consumerDuringApiCap.mode === "ai" && (await usedOf("api", acct)) === 6, "At the API tier's cap: API answers 503 and is not billed, consumers keep their AI", `api at cap: ${rApiCap.status}; consumer ${consumerDuringApiCap.ok ? consumerDuringApiCap.mode : "refused"}`);
    await prisma.usageCounter.deleteMany({ where: { scope: "gemini-day" } });

    // A Gemini quota that stays exhausted: not silent. After a few 429s in a row the circuit opens and the owner is told once.
    useModel(true);
    guard._resetAiGuardForTests();
    await prisma.usageCounter.deleteMany({ where: { scope: { in: ["gemini-day", "gemini-alert"] } } });
    slack.hits.length = 0;
    errors.length = 0;
    resetCalls();
    script = () => Object.assign(new Error("[GoogleGenerativeAI Error]: [429 Too Many Requests] Resource has been exhausted (e.g. check quota)."), { status: 429 });
    const quotaOutcomes: DiagnoseOutcome[] = [];
    check(guard.QUOTA_STREAK_TO_OPEN >= 2 && guard.QUOTA_STREAK_TO_OPEN <= 5, "a run of 2-5 quota errors is what opens the circuit (not never, not on the first 429)", `QUOTA_STREAK_TO_OPEN is ${guard.QUOTA_STREAK_TO_OPEN}`);
    for (let i = 0; i < 6; i++) quotaOutcomes.push(await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: `qa-diag-quota429-${i}00`, caller: consumerFor("q429") }));
    check(quotaOutcomes.every((o) => o.ok && o.mode === "fallback") && guard.circuitReason() === "quota", "A persistent 429 still answers from the labelled fallback and opens the circuit", `after ${quotaOutcomes.length} 429s: circuit ${guard.circuitReason()}`);
    check(calls.length === guard.QUOTA_STREAK_TO_OPEN, `...after ${guard.QUOTA_STREAK_TO_OPEN} in a row the model is no longer called (${calls.length} calls for ${quotaOutcomes.length} requests)`, `model calls: ${calls.length}`);
    check(slack.hits.length === 1 && /Gemini-quotum bereikt/.test(slack.hits[0].body), "...and the owner gets exactly one notice that the Gemini quota is exhausted", `quota notices: ${slack.hits.length} ${slack.hits[0]?.body.slice(0, 100)}`);
    check(errors.some((e) => /billing and limits/.test(e)), "...and it is logged with logger.error", "no error log for a persistent quota failure");
    guard._resetAiGuardForTests();
    script = () => Object.assign(new Error("429"), { status: 429 });
    await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-quota429-9100", caller: consumerFor("q429") });
    script = () => DIAGNOSIS_TEXT;
    await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-quota429-9200", caller: consumerFor("q429") });
    script = () => Object.assign(new Error("429"), { status: 429 });
    await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-quota429-9300", caller: consumerFor("q429") });
    await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-quota429-9400", caller: consumerFor("q429") });
    check(guard.circuitReason() === null, "An isolated 429 (a success in between) does not open the circuit", `circuit ${guard.circuitReason()}`);
    guard._resetAiGuardForTests();
    useModel(false);

    // ─── 8. Photo path ──────────────────────────────────────────────────────
    const imgRoute = await import("../src/app/api/diagnose/image/route");
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0"), Buffer.alloc(300, 7)]);
    const photoReq = (bytes: Buffer, ip: string, session = "qa-diag-photo-0001", type = "image/png") => {
      const form = new FormData();
      form.append("image", new Blob([new Uint8Array(bytes)], { type }), "foto.png");
      form.append("sessionId", session);
      return imgRoute.POST(new NextRequest("http://localhost/api/diagnose/image", { method: "POST", body: form, headers: { "x-forwarded-for": ip } }));
    };
    useModel(false);
    const random = Buffer.alloc(200, 0);
    for (let i = 0; i < 200; i++) random[i] = (i * 37 + 11) % 251;
    const rRandom = await photoReq(random, "203.0.113.20");
    check(rRandom.status === 415, "200 random bytes labelled image/png are rejected (415), not diagnosed", `random bytes: ${rRandom.status}`);
    const rNoModel = await photoReq(jpeg, "203.0.113.21");
    const bNoModel = await rNoModel.json();
    check(rNoModel.status === 503 && /foto kon niet worden beoordeeld/i.test(bNoModel.error) && !/E18|Bosch|78/.test(JSON.stringify(bNoModel)), "A real photo without a model: 503 'foto kon niet worden beoordeeld', no invented Bosch E18", `no-model photo: ${rNoModel.status} ${JSON.stringify(bNoModel).slice(0, 160)}`);
    check((await usedOf("diagnose", anonKey("203.0.113.21"))) === 0 && (await usedOf("diagnose-calls", anonKey("203.0.113.21"))) === 0, "...and costs no quota", "photo without a model consumed quota");
    const big = Buffer.concat([jpeg, Buffer.alloc(core.MAX_IMAGE_BYTES, 1)]);
    const rBig = await photoReq(big, "203.0.113.22");
    check(rBig.status === 413 && /4 MB/.test((await rBig.json()).error), "A photo over 4 MB is refused with a Dutch 413 (Vercel's cap is 4.5 MB)", `big photo: ${rBig.status}`);

    useModel(true);
    guard._resetAiGuardForTests();
    resetCalls();
    script = () => JSON.stringify({ detectedCode: "E18", detectedBrand: "Bosch", detectedSymptom: null, confidence: 80, description: "Ik zie foutcode E18 op het display van een Bosch.", suggestedQuery: "Bosch E18" });
    const rOk = await photoReq(jpeg, "203.0.113.23", "qa-diag-photo-0002");
    const bOk = await rOk.json();
    check(rOk.status === 200 && bOk.recognised === true && bOk.matchedErrorCode?.code === "E18" && bOk.recommendedParts.length > 0 && bOk.model === "fake-model-1" && !("confidence" in bOk), "Photo with a model: recognised code, matched table row, live parts, real model name, no confidence number", `photo ok: ${rOk.status} ${JSON.stringify(bOk).slice(0, 200)}`);
    check(calls[0]?.mime === "image/jpeg", "The mime type sent to the model is the sniffed one", `mime ${calls[0]?.mime}`);
    check((await usedOf("diagnose", anonKey("203.0.113.23"))) === 1, "A photo takes one conversation unit", "photo unit not taken");
    // text in the same conversation does not pay again
    const textAfter = await core.runDiagnosis({ messages: [msg("Bosch E18")], sessionId: "qa-diag-photo-0002", caller: { kind: "consumer", userId: null, quotaKey: anonKey("203.0.113.23"), monthlyLimit: 3 } });
    check(textAfter.ok && (await usedOf("diagnose", anonKey("203.0.113.23"))) === 1, "...and the text diagnosis in the same conversation does not take a second one", "photo + text cost two units");
    script = () => "dit is geen json";
    const rJunk = await photoReq(jpeg, "203.0.113.24", "qa-diag-photo-0003");
    check(rJunk.status === 502 && (await usedOf("diagnose", anonKey("203.0.113.24"))) === 0, "An unreadable model answer -> 502 'kon niet worden beoordeeld' and the unit is refunded", `junk answer: ${rJunk.status}, unit ${await usedOf("diagnose", anonKey("203.0.113.24"))}`);
    script = () => JSON.stringify({ detectedCode: null, detectedBrand: null, detectedSymptom: null, confidence: 20, description: "Het display is niet leesbaar; maak een scherpere foto.", suggestedQuery: "" });
    const rUnclear = await photoReq(jpeg, "203.0.113.25", "qa-diag-photo-0004");
    const bUnclear = await rUnclear.json();
    check(rUnclear.status === 200 && bUnclear.recognised === false && bUnclear.detectedCode === null && bUnclear.recommendedParts.length === 0, "A photo the model cannot read is reported as unrecognised, with no parts", `unclear: ${JSON.stringify(bUnclear).slice(0, 160)}`);
    script = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    const rTimeout = await photoReq(jpeg, "203.0.113.26", "qa-diag-photo-0005");
    check(rTimeout.status === 504 && (await usedOf("diagnose", anonKey("203.0.113.26"))) === 0, "A model timeout on a photo -> 504 and the unit is refunded", `photo timeout: ${rTimeout.status}`);
    script = () => JSON.stringify({ detectedCode: null, detectedBrand: null, detectedSymptom: "lek", confidence: 70, description: "Water op de vloer.", suggestedQuery: "lek" });
    const photoIp = "203.0.113.27";
    const photoStatuses: number[] = [];
    for (let i = 0; i < 4; i++) photoStatuses.push((await photoReq(jpeg, photoIp, "qa-diag-photo-0006")).status);
    check(photoStatuses.join() === "200,200,200,429", "At most 3 photos per conversation (4th -> 429)", `photo statuses ${photoStatuses.join()}`);

    // ─── 9. The diagnose route ──────────────────────────────────────────────
    const route = await import("../src/app/api/diagnose/route");
    useModel(false);
    const post = (messages: unknown, ip: string, sessionId?: string) =>
      route.POST(new NextRequest("http://localhost/api/diagnose", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ messages, sessionId }) }));
    const rFb = await post([{ role: "user", content: "Miele F11 pomp werkt niet" }], "203.0.113.30", "qa-diag-route-0001");
    const bFb = await rFb.json();
    check(rFb.status === 200 && bFb.mode === "fallback" && bFb.model === null && bFb.label === gem.FALLBACK_LABEL && !("confidence" in (bFb.diagnosis ?? {})), "POST /api/diagnose without a model: mode fallback, model null, label, no confidence", `route fallback: ${JSON.stringify(bFb).slice(0, 200)}`);
    const rGet = await route.GET(new NextRequest("http://localhost/api/diagnose", { headers: { "x-forwarded-for": "203.0.113.31" } }));
    const bGet = await rGet.json();
    check(bGet.aiAvailable === false && bGet.quota.limit === 3 && bGet.quota.remaining === 3, "GET /api/diagnose tells the page whether an AI will answer and how many free diagnoses remain", `GET: ${JSON.stringify(bGet)}`);
    const rBadSession = await post([{ role: "user", content: "x" }], "203.0.113.32", "bad id with spaces");
    check(rBadSession.status === 400, "A malformed sessionId is refused", `bad session: ${rBadSession.status}`);
    useModel(true);
    script = () => DIAGNOSIS_TEXT;
    const ip = "203.0.113.33";
    const sids = ["qa-diag-route-0010", "qa-diag-route-0011", "qa-diag-route-0012", "qa-diag-route-0013"];
    const rs = [] as Response[];
    for (const sid of sids) rs.push(await post([{ role: "user", content: "Bosch E18" }], ip, sid));
    const b4 = await rs[3].json();
    check(rs.slice(0, 3).every((r) => r.status === 200) && rs[3].status === 429 && b4.details?.code === "limit_reached" && b4.details.used === 3 && b4.details.limit === 3, "Route: 3 conversations answered, the 4th is 429 limit_reached (used 3 / limit 3)", `route quota: ${rs.map((r) => r.status).join()}`);
    const b1 = await rs[0].json();
    check(b1.quota?.remaining === 2 && b1.mode === "ai" && b1.model === "fake-model-1", "Route response reports quota.remaining and the real model", `route first: ${JSON.stringify(b1.quota)} ${b1.model}`);

    // ─── 10. entitlements.refundUsage ───────────────────────────────────────
    await ent.consumeUsage("qa-diag-refund", "qa-diag-r", 3);
    await ent.refundUsage("qa-diag-refund", "qa-diag-r");
    await ent.refundUsage("qa-diag-refund", "qa-diag-r");
    check((await usedOf("qa-diag-refund", "qa-diag-r")) === 0, "refundUsage never goes below zero", "refundUsage went negative");
    await prisma.usageCounter.deleteMany({ where: { scope: "qa-diag-refund" } });

    // An IPv6 visitor is one free bucket per /64, not one per address (host bits are theirs to rotate).
    const v6a = anonKey("2001:db8:abcd:12::1");
    check(v6a === anonKey("2001:db8:abcd:12:ffff:ffff:ffff:ffff") && v6a !== anonKey("2001:db8:abcd:13::1") && anonKey("::ffff:203.0.113.5") === anonKey("203.0.113.5") && anonKey("203.0.113.5") !== anonKey("203.0.113.6"), "IPv6 free-tier buckets are per /64 (two addresses of one /64 share, another /64 does not); IPv4 and IPv4-mapped IPv6 are unchanged", "IPv6 normalisation wrong");

    // SafeMarkdown is rendered for real in its own process (react-dom/server cannot load under react-server).
    const md = spawnSync("npx", ["tsx", "scripts/qa-diagnose-markdown.ts"], { cwd: path.join(__dirname, ".."), encoding: "utf8", env: { ...process.env, NODE_ENV: "development" } });
    const mdLines = (md.stdout ?? "").split("\n").filter((l) => /^(PASS|FAIL)/.test(l));
    check(md.status === 0 && mdLines.length >= 5 && mdLines.every((l) => l.startsWith("PASS")), `SafeMarkdown rendered and inspected (${mdLines.filter((l) => l.startsWith("PASS")).length}/${mdLines.length} checks in scripts/qa-diagnose-markdown.ts, including '/\\host' and javascript: links)`, `SafeMarkdown: ${mdLines.filter((l) => !l.startsWith("PASS")).join(" | ") || (md.stderr ?? "").slice(0, 300)}`);

    // ─── 11. Pure helpers and source claims ─────────────────────────────────
    const photoLib = await import("../src/components/diagnose/photo");
    const d = photoLib.fitDimensions(4000, 3000, 1600);
    check(d.width === 1600 && d.height === 1200 && photoLib.fitDimensions(800, 600, 1600).width === 800, "fitDimensions scales the long edge to 1600 and never up", `fitDimensions ${JSON.stringify(d)}`);
    check(core.sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])) === "image/png" && core.sniffImageType(new Uint8Array([1, 2, 3, 4])) === null, "sniffImageType reads magic bytes", "sniffImageType wrong");

    const dark = read("src/components/redesign/DiagnoseDark.tsx");
    const page = read("src/app/diagnose/page.tsx");
    check(!/Powered by Google Gemini|60s|JD<|"JD"|Wij weten wat er echt mis is|binnen 60|Gemini 2\.0 Flash/.test(dark + page), "source: The diagnose page has no 'Powered by Google Gemini', '60s', 'JD' avatar or hard-coded model name", "Unverified wording still on the diagnose page");
    check(/EVT\.DIAGNOSE_STARTED/.test(dark) && /EVT\.DIAGNOSE_COMPLETED/.test(dark), "source: diagnose_started / diagnose_completed are fired through the consent-gated track()", "funnel events missing");
    check(/font-size: 16px/.test(dark) && /minmax\(0, 1fr\)/.test(dark) && /In winkelmand/.test(dark) && /min-height: 44px/.test(dark), "source (measured in scripts/qa-diagnose-ui.ts): 16px input, minmax(0,1fr) grid, labelled 44px 'In winkelmand' control", "mobile fixes missing");
    for (const f of ["src/app/api/diagnose/route.ts", "src/app/api/diagnose/image/route.ts", "src/app/api/v1/diagnose/route.ts"]) {
      check(/export const maxDuration = 60/.test(read(f)), `source: ${f} exports maxDuration = 60`, `${f} has no maxDuration`);
    }
    const v1src = read("src/app/api/v1/diagnose/route.ts");
    check(!/INTERNAL_API_KEY|NEXT_PUBLIC_APP_URL|X-Internal-Auth|fetch\(/.test(v1src), "v1/diagnose does not mention INTERNAL_API_KEY, NEXT_PUBLIC_APP_URL or fetch()", "v1/diagnose still self-calls");
    const info = read("src/app/api-info/page.tsx");
    check(!/OpenAPI 3\.0|SDKs voor|99%|api\.wasfix\.nl|"symptom"/.test(info) && /symptoms/.test(info) && /PLAN_API_MONTHLY_CALLS/.test(info), "api-info: no SDK/OpenAPI/99%/api.wasfix.nl claims; field is 'symptoms'; limits read from PLAN_API_*", "api-info still carries unbacked claims");
    const over = read("src/app/over/page.tsx");
    check(!/tegen onze eigen foutcode-database/.test(over.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")), "/over no longer claims every diagnosis is checked against our database", "/over still claims database grounding unconditionally");
    const fs = await import("node:fs");
    check(!fs.existsSync(path.join(__dirname, "..", "src/app/diagnose/diagnose-client.tsx")), "Dead src/app/diagnose/diagnose-client.tsx is gone", "diagnose-client.tsx still exists");
  } finally {
    gem._setAiBackendForTests(null);
    console.error = realError;
    console.warn = warnOnly;
    await cleanup().catch(() => undefined);
    await prisma.diagnosis.deleteMany({ where: { sessionId: { startsWith: "qa-diag-" } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: "qa-diag-b2b@wasfixpro.test" } }).catch(() => undefined);
    await prisma.$disconnect();
    slack.close();
  }

  console.log(log.join("\n"));
  console.log(`\n${log.length - failed}/${log.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(log.join("\n"));
  console.error(err);
  process.exit(1);
});
