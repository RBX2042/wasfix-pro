/**
 * The diagnose page in a real browser at phone width: what a visitor sees and can tap.
 *
 * The things scripts/qa-diagnose.ts can only grep for in the source (no horizontal
 * overflow, 44 px targets, 16 px input, markdown that cannot inject, a photo that is
 * downscaled before upload, funnel events only after consent, the camera button only
 * when an AI will answer) are measured here.
 *
 * Needs a running server WITHOUT a Gemini key (the dev server in demo mode is fine) and
 * Playwright (see scripts/lib/browser.ts). The AI answers are canned by intercepting the
 * browser's own requests, so no model is involved.
 *
 * Usage: BASE_URL=http://localhost:3208 npx tsx scripts/qa-diagnose-ui.ts
 */
import zlib from "node:zlib";
import { loadPlaywright, makeChecker } from "./lib/browser";

const BASE = process.env.BASE_URL ?? "http://localhost:3208";
const { check, note, finish } = makeChecker("diagnose page in a browser");

/** A noise PNG: incompressible, so a 2000x1500 one is well over the 4.5 MB request limit of serverless functions. */
function noisePng(w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = (x * 31 + y * 17 + ((x * y) % 251)) & 255;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (t: string, d: Buffer) => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([l, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  // Random bytes make the PNG big; the pattern above only fills the structure.
  for (let i = 0; i < raw.length; i++) if (i % (w * 3 + 1) !== 0) raw[i] ^= (Math.random() * 256) | 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 1 })), chunk("IEND", Buffer.alloc(0))]);
}

// apiSuccess() sends the payload as is, without an envelope.
const AI_PAYLOAD = {
  ...{
    message:
      "Waarschijnlijk een **afvoerprobleem**.\n\n- Controleer het filter\n- [Gids](/gidsen/filter-reinigen)\n- [Evil](/\\evil.example.com)\n- [Data](data:text/html,hi)\n- [JS](javascript:alert(1))\n- <img src=x onerror=window.__xss=1>",
    diagnosis: { errorCode: "E18", confidence: 70, mainCause: "Verstopte pomp of afvoerslang", alternativeCauses: ["A", "B"], diyFriendly: false, urgency: "high", recommendedAction: "Haal de stekker eruit" },
    recommendedParts: [
      { id: "p1", sku: "WF-PUMP-0001", name: "Afvoerpomp".padEnd(90, "X"), brand: "Bosch", priceEur: 34.5, imageUrl: null, stock: 5, category: "PUMP" },
      { id: "p2", sku: "WF-FILT-0002", name: "Filter", brand: "Universeel", priceEur: 9.95, imageUrl: null, stock: 0, category: "FILTER" },
    ],
    recommendedGuides: [{ id: "g1", slug: "filter-reinigen", title: "Filter reinigen ".repeat(8), difficulty: "EASY", timeMinutes: 10, summary: "x" }],
    sessionId: "qa-ui-session-0001",
    mode: "ai",
    model: "fake-model",
    label: null,
    fallbackReason: null,
    notice: "Dit is een indicatie op basis van jouw omschrijving, geen garantie.",
    quota: { limit: 3, used: 1, remaining: 2 },
  },
};

async function main() {
  const pw = loadPlaywright();
  if (!pw) {
    console.log("SKIP: Playwright is not installed (set PLAYWRIGHT_PATH). Nothing was checked.");
    process.exit(0);
  }
  const reachable = await fetch(`${BASE}/api/diagnose`).then((r) => r.ok).catch(() => false);
  if (!reachable) {
    console.error(`No server answers at ${BASE}/api/diagnose. Start one (no GEMINI_API_KEY) or set BASE_URL.`);
    process.exit(2);
  }
  const serverState = (await (await fetch(`${BASE}/api/diagnose`)).json()) as { aiAvailable?: boolean };
  if (serverState.aiAvailable === true) {
    console.error("This server has an AI configured; the fallback checks need one without. Unset GEMINI_API_KEY.");
    process.exit(2);
  }

  const browser = await pw.chromium.launch();
  try {
    // ── 1. The real server, no AI: the labelled fallback ─────────────────────
    note("real server without a model, 375 px");
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.addCookies([{ name: "wasfix-consent", value: encodeURIComponent(JSON.stringify({ analytics: true })), url: BASE }]);
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      (window as unknown as { __ev: unknown[] }).__ev = [];
      (window as unknown as { gtag: unknown }).gtag = (_c: string, e: string, p: unknown) => (window as unknown as { __ev: unknown[] }).__ev.push({ e, p });
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (e: unknown) => pageErrors.push(String(e)));
    await page.goto(`${BASE}/diagnose`, { waitUntil: "networkidle", timeout: 120_000 });
    await page.waitForSelector('[data-testid="mode-fallback"]', { timeout: 60_000 });
    const section = await page.locator("section.section").first().innerHTML();
    check(!/Powered by Google Gemini|60s|JD|binnen 60/.test(section), "no 'Powered by Google Gemini', '60s' or hard-coded initials on the page");
    check((await page.locator('[data-testid="mode-fallback"]').innerText()).includes("Snelle zoekhulp op foutcodes - geen AI-analyse") && (await page.locator('[data-testid="mode-ai"]').count()) === 0, "the header says 'Snelle zoekhulp ... geen AI-analyse' and never 'AI' while no model exists");
    check((await page.getByRole("button", { name: /Foto .* toevoegen/ }).count()) === 0 && !/foto van het display/i.test(await page.locator("p.lead").innerText()), "no camera button and no 'voeg een foto toe' while no AI will answer (it could only end in a refusal)");
    const inputSize = await page.locator("input.dz-input").evaluate((e: Element) => getComputedStyle(e).fontSize);
    check(inputSize === "16px", `chat input font-size is ${inputSize} (iOS zooms below 16px)`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal overflow before chatting");

    await page.getByRole("button", { name: /Bosch E18/ }).click();
    await page.waitForSelector('[data-testid="rec-part"]', { timeout: 30_000 });
    const bubble = await page.locator(".msg-ai .msg-body").last().innerText();
    check(bubble.includes("Snelle zoekhulp op foutcodes - geen AI-analyse") && !/\d+\s?%/.test(bubble) && !bubble.includes("**"), "the fallback bubble is labelled, has no percentage and no raw markdown");
    const resultText = await page.locator(".diag-result").innerText();
    check(!/INSCHATTING AI|VERTROUWEN|%/.test(resultText), "the result panel shows no confidence for a lookup");
    check(/geen garantie/.test(resultText) && (await page.locator('a[href="/disclaimer"]').count()) > 0, "the result carries the not-a-guarantee notice and a link to the disclaimer");
    const add = page.getByRole("button", { name: /in winkelmand/i });
    const n = await add.count();
    let minH = 999;
    for (let i = 0; i < n; i++) minH = Math.min(minH, (await add.nth(i).boundingBox())!.height);
    check(n >= 1 && minH >= 44, `${n} 'In winkelmand' buttons, the smallest is ${minH}px high (>= 44)`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal overflow after the result");
    await add.first().click();
    await page.waitForTimeout(400);
    const cart = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => /cart/i.test(k)).map(([, v]) => v).join(""));
    check(/WF-/.test(cart), "'In winkelmand' puts the part in the cart store");
    const ev1 = (await page.evaluate(() => (window as unknown as { __ev: { e: string }[] }).__ev)) as { e: string; p?: unknown }[];
    check(ev1.some((e) => e.e === "diagnose_started") && ev1.some((e) => e.e === "diagnose_completed"), `funnel events fire after consent: ${ev1.map((e) => e.e).join(",")}`);
    check(!/water blijft|Mijn Bosch|E18, water/.test(JSON.stringify(ev1)), "the events carry no message text");

    // ── 2. AI mode with a canned answer: markdown, photo, result layout ───────
    note("canned AI answer, 375 px and 320 px");
    await page.route("**/api/diagnose", async (route: { request: () => { method: () => string }; fulfill: (o: unknown) => Promise<void> }) => {
      if (route.request().method() === "POST") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(AI_PAYLOAD) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ aiAvailable: true, fallbackLabel: null, quota: { limit: 3, used: 0, remaining: 3 }, signedIn: false, maxUserTurns: 12 }) });
    });
    let uploaded = 0;
    await page.route("**/api/diagnose/image", async (route: { request: () => { postDataBuffer: () => Buffer | null }; fulfill: (o: unknown) => Promise<void> }) => {
      uploaded = route.request().postDataBuffer()?.length ?? 0;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "De foto kon niet worden beoordeeld: de AI is nu niet beschikbaar." }) });
    });
    await page.goto(`${BASE}/diagnose`, { waitUntil: "networkidle" });
    check((await page.locator('[data-testid="quota-line"]').innerText()).includes("Nog 3 van 3 gratis diagnoses"), "the quota line says 'Nog 3 van 3 gratis diagnoses'");
    check((await page.locator('[data-testid="mode-ai"]').count()) === 1 && (await page.getByRole("button", { name: /Foto .* toevoegen/ }).count()) === 1, "with an AI available the AI label and the camera button are shown");
    const cam = await page.getByRole("button", { name: /Foto .* toevoegen/ }).boundingBox();
    check(!!cam && cam.width >= 44 && cam.height >= 44, `the camera button is ${cam?.width}x${cam?.height}`);

    const png = noisePng(2000, 1500);
    await page.setInputFiles('[data-testid="photo-input"]', { name: "display.png", mimeType: "image/png", buffer: png });
    await page.waitForFunction(() => document.body.innerText.includes("kon niet worden beoordeeld"), null, { timeout: 60_000 });
    check(png.length > 4.5 * 1024 * 1024 && uploaded > 0 && uploaded <= 1.6 * 1024 * 1024, `a ${(png.length / 1048576).toFixed(1)} MB photo is uploaded as ${(uploaded / 1048576).toFixed(2)} MB (<= 1.5 MB + form overhead)`);

    await page.getByRole("button", { name: /Nieuwe diagnose/ }).click().catch(() => undefined);
    await page.locator("input.dz-input").fill("Bosch E18 water blijft staan");
    await page.locator("input.dz-input").press("Enter");
    await page.waitForSelector('[data-testid="rec-part"]');
    const aiBubble = page.locator(".msg-ai .msg-body").last();
    const links = (await aiBubble.locator("a").evaluateAll((as: Element[]) => as.map((a) => a.getAttribute("href")))) as string[];
    check(JSON.stringify(links) === JSON.stringify(["/gidsen/filter-reinigen"]), `of the model's links only the safe one is a link: ${JSON.stringify(links)} (no '/\\\\host', data:, javascript:)`);
    check((await aiBubble.locator("script, img").count()) === 0 && ((await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss)) ?? null) === null, "markup from the model is not rendered and runs nothing");
    const rt = await page.locator(".diag-result").innerText();
    check(/INSCHATTING AI/.test(rt) && /70%/.test(rt) && /geen meting/.test(rt), "the model's own number is shown, labelled as an estimate, 'geen meting'");
    check((await page.locator('[data-testid="monteur-flag"]').count()) === 1, "diyFriendly=false shows the monteur flag");
    check(/Uitverkocht/.test(rt) && (await page.getByRole("button", { name: /in winkelmand/i }).count()) === 1, "a sold-out part says Uitverkocht and has no add button");
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 812 });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no horizontal overflow at ${width}px with a 90-character unbroken part name and a long guide title`);
    }

    // ── 3. Without consent no event fires ─────────────────────────────────────
    note("no consent");
    const ctx2 = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const p2 = await ctx2.newPage();
    await p2.addInitScript(() => {
      (window as unknown as { __ev: string[] }).__ev = [];
      (window as unknown as { gtag: unknown }).gtag = (_c: string, e: string) => (window as unknown as { __ev: string[] }).__ev.push(e);
    });
    await p2.route("**/api/diagnose", (route: { request: () => { method: () => string }; fulfill: (o: unknown) => Promise<void>; continue: () => Promise<void> }) =>
      route.request().method() === "POST" ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(AI_PAYLOAD) }) : route.continue(),
    );
    await p2.goto(`${BASE}/diagnose`, { waitUntil: "networkidle" });
    await p2.locator("input.dz-input").fill("Bosch E18");
    await p2.locator("input.dz-input").press("Enter");
    await p2.waitForSelector('[data-testid="rec-part"]');
    check(((await p2.evaluate(() => (window as unknown as { __ev: string[] }).__ev.filter((e) => e.startsWith("diagnose_")))) as string[]).length === 0, "without analytics consent no diagnose_* event is sent");
    check(pageErrors.length === 0, `no page errors ${pageErrors.join(";").slice(0, 200)}`);
  } finally {
    await browser.close();
  }
  process.exit(finish());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
