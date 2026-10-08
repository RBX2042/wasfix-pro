/**
 * Browser checks for the storefront (bundle S7): consent, exit intent, the product page
 * on a phone, funnel events. Needs Playwright (a global install is fine) and a running
 * server:
 *
 *   node scripts/qa-storefront-browser.mjs http://localhost:3307            # a production build
 *   node scripts/qa-storefront-browser.mjs http://localhost:3207 --loaders  # a dev server started with
 *       NEXT_PUBLIC_GA_ID=G-QATEST123 NEXT_PUBLIC_POSTHOG_KEY=phc_qatest  (the keys are compiled in)
 *   node scripts/qa-storefront-browser.mjs http://localhost:3207 --sweep --widths=320,375
 *       # horizontal-overflow sweep of EVERY URL in /sitemap.xml (plus the noindex city pages and a
 *       # few extra routes) at the given widths, in a non-mobile context so overflow cannot hide
 *       # behind a widened layout viewport. Add --only=/foutcodes to restrict it to a path prefix.
 *
 * Exit code 1 if any check fails. Each check says what the old behaviour was.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("/opt/node22/lib/node_modules/playwright/index.js"));
}

const base = (process.argv[2] ?? "http://localhost:3307").replace(/\/$/, "");
const loadersOnly = process.argv.includes("--loaders");
let failed = 0;
const check = (ok, name, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `\n        ${detail}` : ""}`);
  if (!ok) failed++;
};
const consentCookie = (c) => ({ name: "wasfix-consent", value: encodeURIComponent(JSON.stringify({ functional: true, ts: 1, ...c })), url: base });
const THIRD_PARTY = /(vercel-scripts|_vercel\/(insights|speed-insights)|posthog\.com|googletagmanager\.com|google-analytics\.com|crisp\.chat)/;

const browser = await chromium.launch();
const phone = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };

async function newPage(opts = phone, cookies = []) {
  const ctx = await browser.newContext(opts);
  if (cookies.length) await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  return { ctx, page, requests };
}

if (loadersOnly) {
  // PostHog and GA must load after consent and not before. Both are routed to an empty
  // script so the check does not need the real services.
  const { ctx, page, requests } = await newPage();
  await ctx.route(/googletagmanager\.com|posthog\.com|google-analytics\.com/, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  await page.goto(base + "/foutcodes/Bosch-E18", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  check(!requests.some((u) => /googletagmanager|posthog/.test(u)), "no GA/PostHog request before consent");
  await page.getByRole("button", { name: "Alles accepteren" }).click();
  await page.waitForTimeout(1500);
  check(requests.some((u) => /googletagmanager\.com\/gtag\/js\?id=G-QATEST123/.test(u)), "GA4 gtag.js is requested after 'Alles accepteren'", requests.filter((u) => /google|posthog/.test(u)).join(" "));
  check(requests.some((u) => /posthog\.com\/static\/array\.js/.test(u)), "PostHog array.js is requested after 'Alles accepteren' (was: bare import('posthog-js') failing in the browser)");
  const state = await page.evaluate(() => ({ dl: Array.isArray(window.dataLayer) && window.dataLayer.length, ph: typeof window.posthog, init: window.posthog && window.posthog._i && window.posthog._i.length }));
  check(state.dl > 0 && state.ph === "object" && state.init >= 1, "dataLayer filled and posthog stub initialised", JSON.stringify(state));
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.getByRole("link", { name: /Foutcodes/ }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  check(!consoleErrors.some((e) => /module specifier/.test(e)), "no 'Failed to resolve module specifier' error");
  // Withdraw: the next consent event switches providers off.
  await page.evaluate(() => {
    document.cookie = `wasfix-consent=${encodeURIComponent(JSON.stringify({ functional: true, analytics: false, marketing: false, ts: 2 }))}; Path=/`;
    window.dispatchEvent(new CustomEvent("wasfix-consent-update", { detail: { analytics: false } }));
  });
  await page.waitForTimeout(500);
  check(await page.evaluate(() => window["ga-disable-G-QATEST123"] === true), "withdrawing consent sets the GA disable flag");
  await ctx.close();
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : "\nall loader checks passed");
  process.exit(failed ? 1 : 0);
}

// ── Cookie banner on a phone (A6-16, A6-17) ──────────────────────────────
{
  const { ctx, page, requests } = await newPage();
  await page.addInitScript(() => {
    window.__lcp = null;
    new PerformanceObserver((l) => {
      const e = l.getEntries().pop();
      window.__lcp = { t: Math.round(e.startTime), tag: e.element ? e.element.tagName : "", inBanner: e.element ? !!e.element.closest('[role="dialog"]') : false };
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });
  await page.goto(base + "/foutcodes/Bosch-E18", { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const banner = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-labelledby="consent-title"]');
    const r = d?.getBoundingClientRect();
    return r ? { h: Math.round(r.height), vh: innerHeight } : null;
  });
  check(!!banner && banner.h / banner.vh <= 0.2, `cookie banner covers at most 20% of a 375x812 phone (${banner ? Math.round((banner.h / banner.vh) * 100) : "?"}%; was 32%)`);
  const lcp = await page.evaluate(() => window.__lcp);
  check(lcp && !lcp.inBanner, `the cookie banner is not the LCP element (LCP ${lcp?.t}ms, ${lcp?.tag}; was the banner paragraph at 3.4s)`);
  check(!requests.some((u) => THIRD_PARTY.test(u)), "zero third-party / analytics requests before consent");
  check((await ctx.cookies()).filter((c) => c.name !== "wasfix-consent").length === 0, "no cookies before consent");
  await page.getByRole("button", { name: "Aanpassen" }).click();
  const boxes = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] input[type="checkbox"]')].map((c) => ({ checked: c.checked, disabled: c.disabled })));
  check(boxes.length === 3 && boxes[1].checked === false && boxes[2].checked === false, "analytics and marketing boxes are NOT pre-ticked (was: analytics pre-ticked)", JSON.stringify(boxes));
  await page.getByRole("button", { name: "Mijn keuze opslaan" }).click();
  await page.waitForTimeout(1500);
  const saved = decodeURIComponent((await ctx.cookies()).find((c) => c.name === "wasfix-consent")?.value ?? "{}");
  check(JSON.parse(saved).analytics === false, "saving the untouched panel records analytics: false", saved);
  check(!requests.some((u) => THIRD_PARTY.test(u)), "no analytics requests after saving 'no analytics'");
  await ctx.close();
}

// ── After 'Alles accepteren': funnel events, no PII (A6-19) ──────────────
{
  const { ctx, page, requests } = await newPage();
  await page.goto(base + "/onderdelen/WF-PUMP-01", { waitUntil: "load" });
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Alles accepteren" }).click();
  await page.waitForTimeout(1500);
  check(requests.some((u) => /_vercel\/insights/.test(u)), "Vercel Analytics loads after consent");
  const first = await page.evaluate(() => (window.vaq ?? []).filter((e) => e[0] === "event").map((e) => e[1]));
  check(first.some((e) => e.name === "visit") && first.some((e) => e.name === "part_viewed" && e.data && e.data.sku === "WF-PUMP-01"), "visit and part_viewed (sku only) fire once consent is given", JSON.stringify(first));
  await page.getByRole("button", { name: "In winkelmand" }).first().click();
  await page.waitForTimeout(500);
  await page.goto(base + "/checkout", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const events = [...first, ...(await page.evaluate(() => (window.vaq ?? []).filter((e) => e[0] === "event").map((e) => e[1])))];
  const names = events.map((e) => e.name);
  console.log("      events seen:", names.join(", "));
  check(names.includes("checkout_started"), "checkout_started fires on /checkout with a non-empty cart");
  const pii = JSON.stringify(events).match(/@|email|\"name\":\"[A-Z][a-z]+ [A-Z]/);
  check(!pii, "no personal data in any event payload", JSON.stringify(events).slice(0, 300));
  await ctx.close();
  // Add to cart on the product page (the click happened before the navigation, so verify on a fresh page).
  const b = await newPage(phone, [consentCookie({ analytics: true, marketing: false })]);
  await b.page.goto(base + "/onderdelen/WF-PUMP-01", { waitUntil: "load" });
  await b.page.waitForTimeout(1200);
  await b.page.getByRole("button", { name: "In winkelmand" }).first().click();
  await b.page.waitForTimeout(600);
  const ev2 = await b.page.evaluate(() => (window.vaq ?? []).filter((e) => e[0] === "event").map((e) => e[1]));
  check(ev2.some((e) => e.name === "part_added_to_cart" && e.data && e.data.sku === "WF-PUMP-01"), "part_added_to_cart fires with the sku only", JSON.stringify(ev2));
  await b.ctx.close();
}

// ── Without analytics consent nothing fires ──────────────────────────────
{
  const { ctx, page, requests } = await newPage(phone, [consentCookie({ analytics: false, marketing: false })]);
  await page.goto(base + "/onderdelen/WF-PUMP-01", { waitUntil: "load" });
  await page.getByRole("button", { name: "In winkelmand" }).first().click();
  await page.waitForTimeout(1500);
  check(!requests.some((u) => THIRD_PARTY.test(u)) && (await page.evaluate(() => (window.vaq ?? []).length)) === 0, "with 'alleen functioneel' no analytics request and no queued event");
  await ctx.close();
}

// ── Exit intent (A1-16, A5-27) ───────────────────────────────────────────
{
  const desktop = { viewport: { width: 1280, height: 800 } };
  const fire = async (page) => {
    await page.evaluate(() => document.dispatchEvent(new MouseEvent("mouseleave", { clientY: -5, bubbles: true })));
    await page.waitForTimeout(400);
    return page.evaluate(() => !!document.querySelector('[aria-label="Gratis cheatsheet aanbieding"]'));
  };
  for (const path of ["/checkout", "/bestelling/abc", "/upgrade"]) {
    const { ctx, page } = await newPage(desktop, [consentCookie({ analytics: false })]);
    await page.goto(base + path, { waitUntil: "load" });
    await page.waitForTimeout(800);
    check(!(await fire(page)), `exit-intent popup does NOT open on ${path} (was: opened over the form)`);
    await ctx.close();
  }
  const { ctx, page } = await newPage(desktop, [consentCookie({ analytics: false })]);
  await page.goto(base + "/foutcodes/Bosch-E18", { waitUntil: "load" });
  await page.waitForTimeout(800);
  check(await fire(page), "exit-intent popup still opens on a content page");
  const text = await page.evaluate(() => document.querySelector('[aria-label="Gratis cheatsheet aanbieding"]')?.textContent ?? "");
  check(!/in je inbox|Stuur PDF|per e-mail gestuurd/i.test(text), "the popup no longer promises an e-mail (the PDF mail could never be sent)", text.slice(0, 200));
  await page.fill('input[type="email"]', "qa-storefront@example.test");
  await page.getByRole("button", { name: "Download" }).click();
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => document.querySelector('[aria-label="Gratis cheatsheet aanbieding"]')?.innerText ?? "");
  const href = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Gratis cheatsheet aanbieding"] a')].map((a) => a.getAttribute("href")));
  check(/staat klaar/i.test(after) && href.includes("/leadmagnets/foutcodes-cheatsheet.html"), "after signing up the popup shows the download link instead of 'check je inbox'", after.slice(0, 200));
  await ctx.close();
}

// ── checkout_completed only on the success redirect (A6-19) ──────────────
// Before: any /bestelling/* view counted - unpaid orders, e-mail revisits, 404s.
{
  const b = await newPage(phone, [consentCookie({ analytics: true, marketing: false })]);
  const seen = async () => (await b.page.evaluate(() => (window.vaq ?? []).filter((e) => e[0] === "event").map((e) => e[1].name)));
  await b.page.goto(base + "/bestelling/qa-no-such-order", { waitUntil: "load" });
  await b.page.waitForTimeout(1500);
  if (!new URL(b.page.url()).pathname.startsWith("/bestelling")) {
    console.log("      (skipped: /bestelling redirects visitors without an order on this server)");
  } else {
    check(!(await seen()).includes("checkout_completed"), "viewing /bestelling/<id> without ?success=1 does NOT fire checkout_completed (was: fired on any order page)");
    await b.page.goto(base + "/bestelling/qa-no-such-order?success=1", { waitUntil: "load" });
    await b.page.waitForTimeout(1500);
    check((await seen()).includes("checkout_completed"), "the ?success=1 redirect of checkout fires checkout_completed once");
  }
  await b.ctx.close();
}

// ── Withdrawing consent removes the provider cookies (A5-25) ─────────────
// Before: _ga* and ph_* cookies stayed in the browser after withdrawal.
{
  const b = await newPage(phone, [consentCookie({ analytics: true, marketing: false })]);
  await b.page.goto(base + "/foutcodes/Bosch-E18", { waitUntil: "load" });
  await b.page.waitForTimeout(1200);
  await b.page.evaluate(() => {
    for (const c of ["_ga=GA1.1.1.1", "_ga_QATEST123=GS1.1.1", "ph_phc_qatest_posthog=%7B%7D", "qa_keep=1"]) document.cookie = `${c}; Path=/`;
  });
  const names = async () => (await b.ctx.cookies()).map((c) => c.name);
  check((await names()).includes("_ga") && (await names()).includes("ph_phc_qatest_posthog"), "precondition: the provider cookies are present before withdrawal");
  await b.page.evaluate(() => {
    document.cookie = `wasfix-consent=${encodeURIComponent(JSON.stringify({ functional: true, analytics: false, marketing: false, ts: 3 }))}; Path=/`;
    window.dispatchEvent(new CustomEvent("wasfix-consent-update", { detail: { analytics: false } }));
  });
  await b.page.waitForTimeout(600);
  const left = await names();
  check(!left.some((n) => /^(_ga|ph_)/.test(n)) && left.includes("qa_keep"), "withdrawing analytics consent removes _ga* and ph_* cookies and leaves other cookies alone", left.join(","));
  await b.ctx.close();
}

// ── Persisted cart must not reopen the drawer (A5-27) ────────────────────
{
  const { ctx, page } = await newPage(phone, [consentCookie({ analytics: false })]);
  await page.addInitScript(() => {
    localStorage.setItem("wasfix-cart", JSON.stringify({ state: { items: [{ partId: "x", sku: "WF-PUMP-01", name: "Pomp", brand: "Universeel", priceEur: 28.5, quantity: 1 }], isOpen: true }, version: 2 }));
  });
  await page.goto(base + "/checkout", { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const openDrawer = await page.evaluate(() => !!document.querySelector('[role="dialog"][data-state="open"]'));
  check(!openDrawer, "a full page load of /checkout does not open the cart drawer (was: reopened by the persisted isOpen)");
  await ctx.close();
}

// ── Product page on a phone (A1-14, A6-11, A6-15) ────────────────────────
{
  const { ctx, page, requests } = await newPage(phone, [consentCookie({ analytics: false })]);
  const js = [];
  page.on("response", async (r) => {
    if (/\/_next\/static\/.*\.js/.test(r.url())) try { js.push({ url: r.url(), bytes: (await r.body()).length }); } catch { /* ignore */ }
  });
  await page.goto(base + "/onderdelen/WF-PUMP-01", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const fold = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /In winkelmand/.test(b.textContent || ""));
    const price = [...document.querySelectorAll("span")].find((e) => /^€\s?\d/.test((e.textContent || "").trim()) && e.className.includes("text-3xl"));
    const nav = [...document.querySelectorAll("nav")].find((n) => getComputedStyle(n).position === "fixed");
    return { btnBottom: btn?.getBoundingClientRect().bottom, priceTop: price?.getBoundingClientRect().top, navTop: nav?.getBoundingClientRect().top ?? 812 };
  });
  check(fold.btnBottom < fold.navTop, `'In winkelmand' is above the fold and above the bottom nav at 375x812 (button bottom ${Math.round(fold.btnBottom)}px, nav top ${Math.round(fold.navTop)}px; was: top at 864px)`);
  check(fold.priceTop < 500, `price is above the fold (top ${Math.round(fold.priceTop)}px; was 670px)`);
  const heavy = js.filter((x) => x.bytes > 250000);
  const total = Math.round(js.reduce((s, x) => s + x.bytes, 0) / 1024);
  console.log(`      product page JS on load: ${total} KB decoded in ${js.length} scripts (before: 1677 KB)`);
  check(total < 1200 && heavy.length === 0, "three.js is not part of the product page load (no chunk over 250 KB)", heavy.map((h) => `${h.url.split("/").pop()}:${Math.round(h.bytes / 1024)}KB`).join(" "));
  const before3d = js.length;
  await page.getByRole("tab", { name: /3D/ }).click();
  await page.waitForTimeout(2500);
  check(js.length > before3d, "opening the '3D (schematisch)' tab loads the viewer on demand");
  const body = await page.evaluate(() => document.body.innerText);
  check(/incl\. 21% btw/.test(body) && /gratis vanaf/.test(body), "VAT and shipping are stated on the product page");
  check(!/Bancontact|België/.test(body), "no Belgium / Bancontact on the product page");
  await ctx.close();
}

// ── Tap targets (A6-28) ──────────────────────────────────────────────────
{
  for (const path of ["/", "/foutcodes/Bosch-E18", "/onderdelen/WF-PUMP-01", "/merken/Bosch", "/bosch-wasmachine-reparatie", "/gidsen", "/gidsen/trommellager-vervangen", "/onderdelen", "/wasmachine-kapot/amsterdam"]) {
    const { ctx, page } = await newPage(phone, [consentCookie({ analytics: false })]);
    await page.goto(base + path, { waitUntil: "load" });
    await page.waitForTimeout(900);
    const small = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll("a, button, summary, [role=button], [role=tab], input:not([type=hidden])").forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === "inline" && el.tagName === "A") return; // inline text links are exempt
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || cs.visibility === "hidden") return;
        if (r.height < 40) out.push(`${el.tagName} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24)}" ${Math.round(r.height)}px`);
      });
      return out;
    });
    // None under 40px on any audited page. Was: up to 3 allowed per page, and only 5 pages audited.
    const allowed = 0;
    check(small.length <= allowed, `${path}: interactive elements under 40px high: ${small.length}, allowed ${allowed} (was 25-65 on dark pages)`, small.slice(0, 8).join("; "));
    const unlabeled = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => !(b.textContent || "").trim() && !b.getAttribute("aria-label") && !b.getAttribute("title")).length);
    check(unlabeled === 0, `${path}: no unlabeled icon buttons (${unlabeled})`);
    await ctx.close();
  }
}

// ── Horizontal overflow sweep (A6-27) ────────────────────────────────────
// Before: the sweep was 26 hand-picked URLs (3 of them error-code pages) and 55 of the 329
// code pages still overflowed a 375px phone by up to 262px. This one walks the sitemap.
if (process.argv.includes("--sweep")) {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const widths = (arg("widths") ?? "375").split(",").map(Number);
  const only = arg("only");
  const xml = await (await fetch(base + "/sitemap.xml")).text();
  let paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => { const u = new URL(m[1]); return u.pathname + u.search; });
  // Not in the sitemap on purpose (noindex) or only reachable by link:
  paths.push("/wasmachine-kapot/amsterdam", "/wasmachine-kapot/groningen", "/onderdelen?q=pomp", "/onderdelen?cat=PUMP", "/foutcodes?brand=Miele", "/foutcodes?q=E1", "/zanussi-wasmachine-reparatie", "/checkout", "/diagnose", "/prijzen");
  paths = [...new Set(paths)].filter((p) => !only || p.startsWith(only));
  for (const width of widths) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 } });
    await ctx.addCookies([consentCookie({ analytics: false })]);
    const bad = [];
    let next = 0;
    const worker = async () => {
      const page = await ctx.newPage();
      while (next < paths.length) {
        const path = paths[next++];
        try {
          await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 60000 });
          await page.waitForTimeout(150);
          const r = await page.evaluate(() => {
            const de = document.documentElement;
            const cw = de.clientWidth;
            const doc = de.scrollWidth - cw;
            // Elements poking out of the viewport that no clipping ancestor hides.
            const out = [];
            for (const el of document.body.querySelectorAll("*")) {
              const cs = getComputedStyle(el);
              if (cs.position === "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 || rect.right <= cw + 1) continue;
              let clipped = false;
              for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
                const ac = getComputedStyle(a);
                if (ac.position === "fixed") { clipped = true; break; }
                if (/(hidden|auto|scroll|clip)/.test(ac.overflowX) && a.getBoundingClientRect().right <= cw + 1) { clipped = true; break; }
              }
              if (!clipped) out.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 2).join(".") : ""} +${Math.round(rect.right - cw)}`);
            }
            // A box whose text is wider than the box itself (a long unbreakable word in a narrow
            // flex child): its own rectangle still fits, so the loop above cannot see it.
            for (const el of document.body.querySelectorAll("*")) {
              const cs = getComputedStyle(el);
              if (cs.position === "fixed" || cs.display === "none" || cs.display === "inline" || !/visible/.test(cs.overflowX)) continue;
              if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && el.getBoundingClientRect().left + el.scrollWidth > cw + 1) {
                out.push(`${el.tagName.toLowerCase()} text wider than its box (${el.scrollWidth}>${el.clientWidth}) "${(el.textContent || "").trim().slice(0, 30)}"`);
              }
            }
            return { doc, out: out.slice(0, 3), n: out.length };
          });
          if (r.doc > 1 || r.n > 0) bad.push(`${path} doc+${r.doc} ${r.out.join(" ; ")}`);
        } catch (e) {
          bad.push(`${path} ${String(e).slice(0, 80)}`);
        }
      }
      await page.close();
    };
    await Promise.all([worker(), worker(), worker()]);
    check(bad.length === 0, `${paths.length} URLs at ${width}px: no horizontal overflow (${bad.length} overflow)`, bad.slice(0, 15).join("\n        "));
    await ctx.close();
  }
}

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall browser checks passed");
process.exit(failed ? 1 : 0);
