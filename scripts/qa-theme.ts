/**
 * Theme QA (bundle T, decision D22): light by default, a switch to dark, every page legible in both.
 *
 *   npx tsx scripts/qa-theme.ts                                           token + palette + source checks (no server, no browser)
 *   QA_BASE_URL=http://localhost:3000 npx tsx scripts/qa-theme.ts          ... and the browser checks against a PRODUCTION server
 *   QA_DEMO_URL=http://localhost:3300 ...                                  ... and the pages behind the login (dashboard, admin, packing slip,
 *                                                                          work-order invoice) against a server started with DEMO_MODE=true
 *   DATABASE_URL=... (same database as the servers)                        ... and the printed documents (invoice, credit note, packing slip, pick list,
 *                                                                          work-order invoice): the script seeds one order and removes it again.
 *                                                                          It WRITES to that database (a user, a part, an order, an invoice and a credit
 *                                                                          note of year 2999, with QA_DEMO_URL also a work order and maybe a monteur
 *                                                                          profile): a throw-away database, never production.
 *   QA_THEME_FULL=1                                                        the full page list (about 45 pages) instead of the 12 representative ones
 *   QA_REQUIRE_BROWSER=1                                                   a missing Chromium or QA_BASE_URL is a FAILURE, not a SKIPPED line (CI sets it)
 *
 * What it proves, and where each part would fail:
 *  S1  the token sets of globals.css: every text pair reaches 4.5:1 and every UI colour 3:1, in BOTH sets
 *      (fails if a token is changed to a failing contrast); the dark set sits inside "@media not print".
 *  S2  the palette of the redesign pages (wasfix-design.css): every text colour on every surface, both palettes.
 *  S3  the meta theme-color constants and the palette of the stand-alone error page equal the tokens.
 *  S4  the wiring: light is the default (layout.tsx, theme-provider.tsx), "system" stays selectable.
 *  a   a fresh browser whose OS prefers DARK and whose storage is empty renders LIGHT (fails if defaultTheme becomes "system").
 *  b   the toggle exists in the header, the mobile menu, the bottom bar and the footer, has a name, works by keyboard and
 *      mouse; Donker survives a reload (and is on <html> before the first paint) and client navigation; Licht undoes it;
 *      Systeem follows the OS in both directions; theme-color follows the choice (fails if a layout loses its toggle).
 *  c   no console error, page error or hydration warning in either theme.
 *  d   a contrast sweep of every visible text element, page x {light, dark} x {375, 1280}; gradients are bounded
 *      by their colour stops or, where that is not enough (and for text in an SVG), measured on the rendered pixels with the
 *      text hidden; both are counted separately, and exceptions are listed with a reason.
 *  e   no horizontal overflow at 375 px in dark.
 *  e2  tablet widths (768 to 1180 px), light and dark: the page does not scroll sideways, the header row fits on one line, the nav stays reachable.
 *  e3  the OPENED mobile menu, the footer controls and the bottom bar panel at 320 to 480 px (and 768): nothing sticks out of the gutter.
 *  j   form-field boundaries reach 3:1 against the surface behind (WCAG 1.4.11, non-text contrast), light and dark; every field shows a focus ring.
 *  k   a stored theme the app never wrote (" dark", "dark light", "banana", ...) and a browser that refuses web storage do not take the pages down:
 *      the site stays light and usable (fails if the stored-theme guard in layout.tsx or the storage guards of the exit-intent offer go).
 *  d0  the pixel verifier survives a layout shift between reading an element and photographing it (a harness self-test).
 *  f   documents print light under emulated print media with .dark set.
 *  g   the toggle works in the dashboard layout and on an admin page (QA_DEMO_URL).
 *  h   the stand-alone global error page honours the stored choice (bundled and rendered like Next does, in the browser and as a server string).
 *  i   overlays (cookie banner, search, cart drawer, exit-intent, the toggle panel) are legible in both themes.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { loadPlaywright, makeChecker } from "./lib/browser";
import { STANDALONE_PALETTE, THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "../src/components/theme-colors";

const { check, note, finish } = makeChecker("qa-theme");
const ROOT = process.cwd();
const BASE = process.env.QA_BASE_URL?.replace(/\/+$/, "");
const DEMO = process.env.QA_DEMO_URL?.replace(/\/+$/, "");
const FULL = process.env.QA_THEME_FULL === "1";
const REQUIRE = process.env.QA_REQUIRE_BROWSER === "1";
// Debug aids, not part of CI: QA_THEME_ONLY=d,i  runs only those browser parts (a b b2 b3 d0 d e2 e3 j k i f g h);
// QA_THEME_PAGES=/,/blog  replaces the page list.
const ONLY = process.env.QA_THEME_ONLY?.split(",").map((x) => x.trim());
const on = (part: string) => !ONLY || ONLY.includes(part);
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
/** A part that cannot run here: a visible SKIPPED line, and a failure when QA_REQUIRE_BROWSER=1 (CI). */
function skipOrFail(what: string) {
  if (REQUIRE) check(false, "", `${what} (QA_REQUIRE_BROWSER=1: a skipped check is a failure)`);
  else note(`SKIPPED ${what}`);
}

// ───────────────────────────── colour maths (WCAG 2.x) ─────────────────────────────
type RGB = [number, number, number];
const hslToRgb = (h: number, s: number, l: number): RGB => {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
};
function parseColour(c: string): RGB {
  const t = c.trim();
  if (t.startsWith("#")) {
    const v = t.length === 4 ? t.slice(1).split("").map((x) => x + x).join("") : t.slice(1);
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as RGB;
  }
  const hsl = /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/.exec(t);
  if (hsl) return hslToRgb(+hsl[1], +hsl[2], +hsl[3]);
  const rgb = /^(\d+)\s+(\d+)\s+(\d+)$/.exec(t);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
  throw new Error(`cannot read colour ${c}`);
}
const lum = ([r, g, b]: RGB) => {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: string, b: string) => {
  const la = lum(parseColour(a)), lb = lum(parseColour(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const over = (fg: string, alpha: number, bg: string): string => {
  const f = parseColour(fg), b = parseColour(bg);
  return `${Math.round(f[0] * alpha + b[0] * (1 - alpha))} ${Math.round(f[1] * alpha + b[1] * (1 - alpha))} ${Math.round(f[2] * alpha + b[2] * (1 - alpha))}`;
};
const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** The variables declared in the block that starts at `open` (the index of its "{"). */
function varsOfBlock(css: string, open: number): Record<string, string> {
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) { end = i; break; }
  }
  const out: Record<string, string> = {};
  for (const m of css.slice(open + 1, end).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const blockAfter = (css: string, marker: string) => {
  const at = css.indexOf(marker);
  if (at < 0) throw new Error(`marker not found: ${marker}`);
  return varsOfBlock(css, css.indexOf("{", at));
};

// ───────────────────────────── S1-S4: no server, no browser ─────────────────────────────
function staticChecks() {
  const globals = read("src/app/globals.css");
  const light = blockAfter(globals, "\n  :root {");
  // The dark token block is found wherever it is (a rule that starts a line with ".dark {"), and the guard is judged separately,
  // so a removed @media wrapper is reported as such instead of making the rest of the checks unreadable.
  const darkRule = /^[ \t]*\.dark \{/m.exec(globals);
  const darkOpenAt = darkRule ? darkRule.index + darkRule[0].indexOf(".dark {") : -1;
  const dark = darkOpenAt >= 0 ? blockAfter(globals.slice(darkOpenAt), ".dark {") : {};
  const darkGuarded = darkOpenAt >= 0 && /@media not print\s*\{\s*$/.test(globals.slice(0, darkOpenAt));

  note("S1 token sets (globals.css): WCAG contrast of every pair, light and dark");
  check(darkGuarded, "the dark token block sits inside '@media not print' (a printed document never gets the dark tokens)", "the .dark token block is not wrapped in @media not print");
  check(/@media print\s*\{[^}]*html\s*\{\s*color-scheme:\s*light\s*!important/.test(globals), "print forces color-scheme: light on <html> (next-themes writes it inline)", "no important color-scheme reset for print");
  check(/:root\s*\{[^}]*color-scheme:\s*light/.test(globals) && /\.dark\s*\{[^}]*color-scheme:\s*dark/.test(globals), "color-scheme is light on :root and dark on .dark", "color-scheme is not set on both token sets");

  const sets: Array<[string, Record<string, string>]> = [["light", light], ["dark", dark]];
  for (const [name, t] of sets) {
    const need = ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "destructive-foreground", "success", "success-foreground", "warning", "warning-foreground", "info", "info-foreground", "border", "input", "ring", "overlay", "code", "code-foreground", "hero-from", "hero-to"];
    const missing = need.filter((k) => !(`--${k}` in t));
    check(missing.length === 0, `${name}: the token set is complete (${need.length} tokens)`, `${name}: missing tokens ${missing.join(", ")}`);
    if (missing.length) continue;
    const v = (k: string) => t[`--${k}`];
    const fails: string[] = [];
    const pair = (label: string, fg: string, bg: string, min: number) => { const r = ratio(fg, bg); if (r < min) fails.push(`${label} ${r.toFixed(2)} < ${min}`); };
    const surfaces: Record<string, string> = { background: v("background"), card: v("card"), popover: v("popover"), muted: v("muted"), secondary: v("secondary") };
    for (const [sn, sv] of Object.entries(surfaces)) {
      pair(`foreground on ${sn}`, v("foreground"), sv, 4.5);
      pair(`muted-foreground on ${sn}`, v("muted-foreground"), sv, 4.5);
      for (const c of ["primary", "accent", "destructive", "success", "warning", "info"]) pair(`${c} (text) on ${sn}`, v(c), sv, 4.5);
    }
    pair("card-foreground on card", v("card-foreground"), v("card"), 4.5);
    pair("popover-foreground on popover", v("popover-foreground"), v("popover"), 4.5);
    pair("secondary-foreground on secondary", v("secondary-foreground"), v("secondary"), 4.5);
    for (const c of ["primary", "accent", "destructive", "success", "warning", "info"]) {
      pair(`${c}-foreground on ${c}`, v(`${c}-foreground`), v(c), 4.5);
      pair(`${c}-foreground on ${c}/90 over background (hover)`, v(`${c}-foreground`), over(v(c), 0.9, v("background")), 4.5);
      for (const a of [0.1, 0.15]) for (const [bn, bv] of [["background", v("background")], ["card", v("card")]] as const) {
        const tint = over(v(c), a, bv);
        pair(`${c} text on ${c}/${a * 100} over ${bn}`, v(c), tint, 4.5);
        pair(`foreground on ${c}/${a * 100} over ${bn}`, v("foreground"), tint, 4.5);
        pair(`muted-foreground on ${c}/${a * 100} over ${bn}`, v("muted-foreground"), tint, 4.5);
      }
    }
    pair("code-foreground on code", v("code-foreground"), v("code"), 4.5);
    for (const [sn, sv] of [["background", v("background")], ["card", v("card")]] as const) {
      pair(`input outline on ${sn} (UI 3:1)`, v("input"), sv, 3);
      pair(`focus ring on ${sn} (UI 3:1)`, v("ring"), sv, 3);
    }
    pair("focus ring on muted (UI 3:1)", v("ring"), v("muted"), 3);
    check(fails.length === 0, `${name}: every text pair reaches 4.5:1 and every UI colour 3:1`, `${name}: ${fails.join("; ")}`);
  }

  note("S2 the redesign palette (wasfix-design.css): every text colour on every surface, both palettes");
  const wf = read("src/app/wasfix-design.css");
  const wfLight = blockAfter(wf, "\n.wasfix-design {");
  const wfDark = blockAfter(wf, ".dark .wasfix-design {");
  check(/@media not print \{\s*\.dark \.wasfix-design \{/.test(wf), "the dark redesign palette sits inside '@media not print'", "the dark redesign palette is not wrapped in @media not print");
  for (const [name, p] of [["light", wfLight], ["dark", wfDark]] as const) {
    const fails: string[] = [];
    const g = (k: string) => p[`--${k}`];
    const surfaces: Record<string, string> = { bg: g("bg"), "bg-2": g("bg-2"), "surf-1": g("surf-1"), "surf-2": g("surf-2"), "surf-3": g("surf-3") };
    surfaces["acc-tint over surf-1"] = parseColourHex(over(hexChannels(g("acc-rgb")), 0.1, g("surf-1")));
    surfaces["acc-tint over bg"] = parseColourHex(over(hexChannels(g("acc-rgb")), 0.1, g("bg")));
    for (const [sn, sv] of Object.entries(surfaces)) for (const t of ["text", "text-2", "mute", "dim", "acc", "acc-2", "ok", "warn", "danger"]) {
      if (g(t) === undefined) { fails.push(`--${t} is missing`); continue; }
      const r = ratio(g(t), sv);
      if (r < 4.5) fails.push(`${t} on ${sn} ${r.toFixed(2)}`);
    }
    for (const stop of ["btn-from", "btn-to", "btn-from-hi", "btn-to-hi"]) {
      const r = ratio(g("on-acc"), g(stop));
      if (r < 4.5) fails.push(`white on ${stop} ${r.toFixed(2)}`);
    }
    for (const [sn, sv] of [["surf-1", g("surf-1")], ["bg", g("bg")]] as const) {
      const r = ratio(g("acc-2"), sv);
      if (r < 3) fails.push(`focus ring (acc-2) on ${sn} ${r.toFixed(2)} (UI 3:1)`);
    }
    // The edge of a form field identifies the control (WCAG 1.4.11): 3:1 against every surface a field can sit on. The hairlines
    // (--line, --line-hi) are decoration and stay below that; a field must use --field-line.
    if (g("field-line") === undefined) fails.push("--field-line is missing");
    else for (const [sn, sv] of Object.entries(surfaces).filter(([k]) => !k.includes("tint"))) {
      const r = ratio(g("field-line"), sv);
      if (r < 3) fails.push(`field edge (--field-line) on ${sn} ${r.toFixed(2)} (UI 3:1)`);
    }
    check(fails.length === 0, `redesign palette ${name}: every text colour reaches 4.5:1 on every surface, white on the primary button at all four stops, the focus ring and the form-field edge 3:1`, `redesign palette ${name}: ${fails.join("; ")}`);
  }

  note("S3 the constants that mirror tokens");
  const bgOf = (t: Record<string, string>) => hex(parseColour(t["--background"]));
  check(THEME_COLOR_LIGHT === bgOf(light) && THEME_COLOR_DARK === bgOf(dark), `theme-color constants (${THEME_COLOR_LIGHT} / ${THEME_COLOR_DARK}) equal the background tokens`, `theme-color constants ${THEME_COLOR_LIGHT}/${THEME_COLOR_DARK} differ from the tokens ${bgOf(light)}/${bgOf(dark)}`);
  for (const [name, t, pal] of [["light", light, STANDALONE_PALETTE.light], ["dark", dark, STANDALONE_PALETTE.dark]] as const) {
    const same = hex(parseColour(t["--foreground"])) === pal.foreground && hex(parseColour(t["--muted-foreground"])) === pal.muted && hex(parseColour(t["--primary"])) === pal.button && hex(parseColour(t["--primary-foreground"])) === pal.buttonText && bgOf(t) === pal.background;
    const fine = ratio(pal.foreground, pal.background) >= 4.5 && ratio(pal.muted, pal.background) >= 4.5 && ratio(pal.buttonText, pal.button) >= 4.5;
    check(same && fine, `stand-alone error page palette (${name}) equals the tokens and every text colour reaches 4.5:1`, `stand-alone error page palette (${name}) drifted from the tokens or fails contrast`);
  }

  note("S4 the wiring: light is the default, system stays a choice");
  const layout = read("src/app/layout.tsx");
  const provider = read("src/components/theme-provider.tsx");
  check(/<ThemeProvider[^>]*attribute="class"[^>]*defaultTheme="light"[^>]*enableSystem[^>]*disableTransitionOnChange/.test(layout), 'layout.tsx: <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>', "layout.tsx: the ThemeProvider props changed (defaultTheme must be light, enableSystem on)");
  check(/defaultTheme:\s*"light"/.test(provider) && /enableSystem:\s*true/.test(provider) && /storageKey:\s*"theme"/.test(provider), "theme-provider.tsx: the defaults are light, enableSystem, storage key 'theme'", "theme-provider.tsx: the defaults changed");
  check(/colorScheme:\s*"light"/.test(layout) && /prefers-color-scheme: light/.test(layout) && /prefers-color-scheme: dark/.test(layout), "layout.tsx: the viewport export carries colorScheme and both theme-color tags", "layout.tsx: no viewport export with colorScheme and theme-color");
  const tailwind = read("tailwind.config.ts");
  check(/darkMode:\s*\["variant",\s*"@media not print \{ &:is\(\.dark \*\) \}"\]/.test(tailwind), "tailwind: dark: utilities do not apply to print", "tailwind: darkMode is not the print-safe variant");
}

/** Compile one dark: utility with the repository's Tailwind config: it must come out inside @media not print. */
async function tailwindVariantCheck() {
  try {
    const postcss = (await import("postcss")).default;
    const tailwind = (await import("tailwindcss")).default as unknown as (c: unknown) => unknown;
    const config = (await import("../tailwind.config")).default as Record<string, unknown>;
    const out = await postcss([tailwind({ ...config, content: [{ raw: '<div class="dark:bg-primary bg-success/10 text-warning"></div>' }] }) as never]).process("@tailwind utilities;", { from: undefined });
    const css = out.css.replace(/\s+/g, " ");
    check(/@media not print \{[^}]*\.dark\\:bg-primary[^}]*:is\(\.dark \*\)/.test(css) || /@media not print \{ \.dark\\:bg-primary:is\(\.dark \*\)/.test(css), "tailwind output: a dark: utility is emitted inside '@media not print' (compiled with the repository's config)", `tailwind output for dark:bg-primary: ${css.slice(0, 300)}`);
    check(/\.bg-success\\\/10 \{ background-color: hsl\(var\(--success\) \/ 0\.1\)/.test(css) && /\.text-warning \{[^}]*hsl\(var\(--warning\)/.test(css), "tailwind output: bg-success/10 and text-warning resolve to the status tokens", `tailwind output for the status classes: ${css.slice(0, 400)}`);
  } catch (e) {
    check(false, "", `could not compile the Tailwind sample: ${String(e).slice(0, 200)}`);
  }
}
const hexChannels = (triple: string) => hex(parseColour(triple));
const parseColourHex = (triple: string) => hex(parseColour(triple));

// ───────────────────────────── the in-page contrast sweep ─────────────────────────────
// A string, not a function: Playwright serialises functions with their transpiled helpers, which do not exist in the page.
const SWEEP = String.raw`(opts) => {
  const res = { checked: 0, failures: [], unknown: [], bounded: 0, allowed: [], recheck: [] };
  let idx = 0;
  const queue = (el, entry, fgs) => { el.setAttribute('data-qa-sweep', String(idx)); const r = el.getBoundingClientRect(); res.recheck.push({ ...entry, idx: idx++, x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, fgs }); };
  const parse = (s) => {
    if (!s) return null;
    let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
    if (m) { const a = m[4] === undefined ? 1 : (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])); return [+m[1], +m[2], +m[3], a]; }
    m = /^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(s);
    if (m) { const a = m[4] === undefined ? 1 : (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])); return [+m[1] * 255, +m[2] * 255, +m[3] * 255, a]; }
    return null;
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const blend = (top, bottom) => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3]));
  const hexOf = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const opCache = new Map();
  const opChain = (e) => { if (opCache.has(e)) return opCache.get(e); const o = (parseFloat(getComputedStyle(e).opacity) || 0) * (e.parentElement ? opChain(e.parentElement) : 1); opCache.set(e, o); return o; };
  const splitTop = (s) => { const out = []; let d = 0, cur = ""; for (const ch of s) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && d === 0) { out.push(cur.trim()); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
  const stopsOf = (layer) => { const m = layer.match(/rgba?\([^)]*\)|color\(srgb[^)]*\)/g) || []; return m.map(parse).filter(Boolean); };
  const describe = (e) => { let s = e.tagName.toLowerCase(); if (e.id) s += "#" + e.id; const cls = (e.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 3); if (cls.length) s += "." + cls.join("."); return s; };
  const skipTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE", "META", "LINK", "OPTION", "DATALIST"]);
  const canvas = document.documentElement.classList.contains("dark") && !opts.print ? [18, 18, 18] : [255, 255, 255];

  // the layers behind an element, top-most first: [{ kind: "color", c } | { kind: "gradient", stops }] or { unknown }
  const layersBehind = (el) => {
    const layers = []; let opaque = false; let unknown = null;
    for (let e = el; e && !opaque; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const op = opChain(e);
      const bgi = cs.backgroundImage;
      if (bgi && bgi !== "none") {
        for (const layer of splitTop(bgi)) {
          if (/^url\(/.test(layer)) { unknown = "image"; continue; }
          const stops = stopsOf(layer).map((c) => [c[0], c[1], c[2], c[3] * op]);
          if (stops.length) layers.push({ kind: "gradient", stops });
          else unknown = unknown || "unreadable-gradient";
        }
      }
      const c = parse(cs.backgroundColor);
      if (c && c[3] * op > 0.001) { layers.push({ kind: "color", c: [c[0], c[1], c[2], c[3] * op] }); if (c[3] * op >= 0.999) opaque = true; }
      for (const x of opts.extra || []) {
        if (e.matches(x.container)) {
          const extra = e.querySelector(x.layer);
          if (extra) {
            const ecs = getComputedStyle(extra);
            for (const layer of splitTop(ecs.backgroundImage === "none" ? "" : ecs.backgroundImage)) { const stops = stopsOf(layer); if (stops.length) layers.splice(layers.length - (c && c[3] * op > 0.001 ? 1 : 0), 0, { kind: "gradient", stops }); }
          }
        }
      }
    }
    return { layers, unknown, opaque };
  };

  const candidates = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) { const n = walker.currentNode; if (n.nodeValue && n.nodeValue.trim() && n.parentElement && !skipTags.has(n.parentElement.tagName)) candidates.add(n.parentElement); }
  for (const f of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=submit]):not([type=button]), textarea, select')) candidates.add(f);

  const clientW = document.documentElement.clientWidth;
  for (const el of candidates) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (rect.bottom + scrollY < 0 || rect.right + scrollX < 0 || rect.left + scrollX >= Math.max(clientW, document.documentElement.scrollWidth)) continue;
    if (opChain(el) < 0.05) continue;
    if (el.closest(':disabled, [aria-disabled="true"], [hidden], [inert]')) continue;
    let clipped = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const o = getComputedStyle(a);
      if (/(hidden|clip)/.test(o.overflowX + o.overflowY)) { const r = a.getBoundingClientRect(); if (rect.right <= r.left || rect.left >= r.right || rect.bottom <= r.top || rect.top >= r.bottom) { clipped = true; break; } }
    }
    if (clipped) continue;

    const isField = el.matches("input, textarea, select");
    let fgStr = cs.color;
    if (el instanceof SVGElement) fgStr = cs.fill;
    if (isField && el.matches("input, textarea") && !el.value && el.getAttribute("placeholder")) fgStr = getComputedStyle(el, "::placeholder").color;
    else if (isField && !el.value && !(el.matches("select"))) continue;
    const fillColor = cs.webkitTextFillColor;
    let gradientText = false;
    if (!(el instanceof SVGElement)) {
      const f = parse(fillColor), c = parse(cs.color);
      const clipsToText = /text/.test(cs.webkitBackgroundClip || cs.backgroundClip);
      if (clipsToText && ((f && f[3] < 0.05) || (c && c[3] < 0.05))) gradientText = true;
      else if (f && fillColor !== cs.color) fgStr = fillColor;
    }
    const fg = parse(fgStr);
    if (!fg) continue;
    res.checked++;
    const fontSize = parseFloat(cs.fontSize); const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const allow = (opts.allow || []).find((a) => el.closest(a.selector));
    const text = (el.value || el.getAttribute("placeholder") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    const entry = { sel: describe(el), text, need };

    if (gradientText) {
      // background-clip: text paints the element's own gradient through the glyphs: judge the stops of that gradient.
      const stops = stopsOf(cs.backgroundImage);
      const { layers } = layersBehind(el.parentElement || el);
      let variants = [canvas];
      for (const l of layers.slice().reverse()) {
        if (l.kind === "color") variants = variants.map((v) => blend(l.c, v));
        else { const next = []; for (const v of variants) for (const s of l.stops) next.push(blend(s, v)); variants = next.slice(0, 24); }
      }
      let worst = Infinity;
      for (const v of variants) for (const sc of stops) worst = Math.min(worst, ratio(blend(sc, v), v));
      if (allow) { res.allowed.push({ ...entry, reason: allow.reason }); continue; }
      if (stops.length && worst >= need) { res.bounded++; continue; }
      queue(el, { ...entry, kind: "gradient text" }, stops.length ? stops : [[0, 0, 0, 1]]);
      continue;
    }

    const { layers, unknown, opaque } = layersBehind(el);
    if (unknown === "image") { if (allow) res.allowed.push({ ...entry, reason: allow.reason }); else queue(el, { ...entry, kind: "picture behind text" }, [[fg[0], fg[1], fg[2], fg[3] * opChain(el)]]); continue; }
    let variants = [canvas];
    let hasGradient = false;
    for (const l of layers.slice().reverse()) {
      if (l.kind === "color") variants = variants.map((v) => blend(l.c, v));
      else { hasGradient = true; const next = []; const seen = new Set(); for (const v of variants) for (const s of l.stops) { const b = blend(s, v); const k = b.map((x) => Math.round(x / 2)).join(","); if (!seen.has(k) && next.length < 24) { seen.add(k); next.push(b); } } variants = next; }
    }
    const fgAlpha = fg[3] * opChain(el);
    let worst = Infinity; let worstBg = variants[0];
    for (const v of variants) { const f = blend([fg[0], fg[1], fg[2], fgAlpha], v); const r = ratio(f, v); if (r < worst) { worst = r; worstBg = v; } }
    // Text in an SVG sits on shapes of that SVG, which are not ancestors: its background is only known from pixels.
    if (el instanceof SVGElement) { if (allow) res.allowed.push({ ...entry, reason: allow.reason }); else queue(el, { ...entry, kind: "svg text" }, [[fg[0], fg[1], fg[2], fgAlpha]]); continue; }
    if (worst >= need) { if (hasGradient) res.bounded++; continue; }
    if (allow) { res.allowed.push({ ...entry, reason: allow.reason, ratio: +worst.toFixed(2) }); continue; }
    if (hasGradient) { queue(el, { ...entry, kind: "gradient behind text" }, [[fg[0], fg[1], fg[2], fgAlpha]]); continue; }
    res.failures.push({ ...entry, kind: "solid", fg: hexOf(fg), bg: hexOf(worstBg), ratio: +worst.toFixed(2) });
  }
  return res;
}`;


// ───────────────────────────── pixel verification ─────────────────────────────
// A gradient bound is a ceiling, not a measurement, and text in an SVG sits on shapes that are not its ancestors. For those
// the page is photographed with the element's text hidden and the contrast is measured against the REAL pixels behind it.
function decodePng(buf: Buffer) {
  let pos = 8, w = 0, h = 0, ctype = 6;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ctype = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const bpp = ctype === 6 ? 4 : ctype === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}
type Recheck = { idx: number; sel: string; text: string; need: number; kind: string; x: number; y: number; w: number; h: number; fgs: number[][] };
/**
 * Wait until the page has stopped changing size. The home page's chat demo adds a message every second or two for about
 * five seconds after hydration, which moves everything below it; a sweep that starts in the middle of that judges a page
 * that no longer exists by the time its photographs are taken.
 */
async function waitStable(page: any, quietMs = 500, timeoutMs = 10000): Promise<boolean> {
  const t0 = Date.now();
  let last = "";
  let since = Date.now();
  // Self-playing content has quiet gaps of several seconds between its steps, so "nothing moved for half a second" is not
  // enough: wait until each known demo reports that it has played to its end (the chat on the home page: four messages, the last
  // one about 4.3 s after hydration, then no typing indicator).
  await page.waitForFunction(PLAYING_DEMOS_DONE, null, { timeout: timeoutMs }).catch(() => undefined);
  while (Date.now() - t0 < timeoutMs) {
    const now: string = await page.evaluate(() => `${document.documentElement.scrollHeight}x${document.documentElement.scrollWidth}`);
    if (now !== last) { last = now; since = Date.now(); }
    else if (Date.now() - since >= quietMs) return true;
    await page.waitForTimeout(100);
  }
  return false;
}
/** One expression per self-playing demo: true when there is no such demo on the page or it has finished. */
const PLAYING_DEMOS_DONE = `(() => {
  const chat = document.querySelector(".chat-body");
  if (chat && (chat.querySelectorAll(".msg").length < 4 || chat.querySelector(".typing"))) return false;
  return true;
})()`;
type Box = { x: number; y: number; w: number; h: number };
const sameBoxes = (a: Box[], b: Box[]) => a.length === b.length && a.every((r, i) => Math.abs(r.x - b[i].x) <= 1 && Math.abs(r.y - b[i].y) <= 1 && Math.abs(r.w - b[i].w) <= 1 && Math.abs(r.h - b[i].h) <= 1);
/** How many times one element is photographed before the layout is declared too restless to measure. */
const PHOTO_ATTEMPTS = 4;
async function verifyByPixels(page: any, items: Recheck[], label: string, failures: string[]): Promise<{ verified: number; skipped: number; covered: string[] }> {
  let verified = 0, skipped = 0;
  const covered: string[] = [];
  if (items.length) {
    // Freeze what moves, and hide the dev indicator (it only exists on `next dev`), so a photograph is a measurement.
    await page.addStyleTag({ content: "*,*::before,*::after{animation-play-state:paused !important;transition:none !important} nextjs-portal{display:none !important}" });
    await page.evaluate(() => document.querySelectorAll("svg").forEach((s) => (s as SVGSVGElement).pauseAnimations?.()));
  }
  for (const it of items.slice(0, 80)) {
    // One measurement is: read the line boxes of the element and hide it, photograph them, read the line boxes AGAIN (the
    // element is still hidden, so the layout is unchanged by us). If the boxes moved in between, something else moved the
    // page (a timer adding content above it), the photograph shows the wrong place, and the measurement is thrown away and
    // repeated once the page is still. It used to take the photograph on trust, and a chat message arriving in that gap made
    // the home page's "ERROR" label look like light text on a light drum (1.28:1) in 4 of 6 runs.
    let pick: { r: number; bg: number[]; fg: number[] } | null = null;
    let worstPng: Buffer | null = null;
    let wasCovered = false;
    for (let attempt = 0; attempt < PHOTO_ATTEMPTS; attempt++) {
      if (attempt > 0) await waitStable(page, 300, 4000);
      const at = await page.evaluate((i: number) => {
        const el = document.querySelector(`[data-qa-sweep="${i}"]`) as HTMLElement | SVGElement | null;
        if (!el) return null;
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" as ScrollBehavior });
        const r = el.getBoundingClientRect();
        const cx = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), cy = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
        const top = document.elementFromPoint(cx, cy);
        if (top && !el.contains(top) && !top.contains(el)) return { covered: true };
        (el as HTMLElement).style.visibility = "hidden";
        // One rectangle per line box: an inline link that wraps has a bounding box that also holds the text around it, which is not its background.
        const rects = [...el.getClientRects()].map((q) => ({ x: Math.max(0, q.left), y: Math.max(0, q.top), w: Math.min(q.width, innerWidth - Math.max(0, q.left)), h: Math.min(q.height, innerHeight - Math.max(0, q.top)) })).filter((q) => q.w >= 2 && q.h >= 2);
        return { covered: false, rects };
      }, it.idx);
      if (!at || at.covered || at.rects.length === 0) { wasCovered = true; if (at && !at.covered) await page.evaluate((i: number) => { const el = document.querySelector(`[data-qa-sweep="${i}"]`) as HTMLElement | null; if (el) el.style.visibility = ""; }, it.idx); break; }
      let here: { r: number; bg: number[]; fg: number[] } | null = null;
      let herePng: Buffer | null = null;
      for (const rc of at.rects as Box[]) {
        const png: Buffer = await page.screenshot({ clip: { x: rc.x, y: rc.y, width: Math.ceil(rc.w), height: Math.ceil(rc.h) } });
        const img = decodePng(png);
        const seen = new Map<number, { c: number[]; n: number }>();
        const step = Math.max(1, Math.floor(Math.sqrt((img.w * img.h) / 6000)));
        let total = 0;
        for (let py = 0; py < img.h; py += step) for (let px = 0; px < img.w; px += step) {
          const o = (py * img.w + px) * img.bpp;
          const k = (img.data[o] << 16) | (img.data[o + 1] << 8) | img.data[o + 2];
          const e = seen.get(k);
          if (e) e.n++; else seen.set(k, { c: [img.data[o], img.data[o + 1], img.data[o + 2]], n: 1 });
          total++;
        }
        // The contrast each background colour gives, worst first; the worst 5 percent of the pixels are set aside (a thin
        // line or an antialiased edge crossing the text is not "the background"), and the next one is the measurement.
        const scored: Array<{ r: number; n: number; bg: number[]; fg: number[] }> = [];
        for (const { c: bg, n } of seen.values()) {
          let worst = Infinity, wf: number[] = [0, 0, 0];
          for (const fg of it.fgs) {
            const a = fg[3];
            const f = [0, 1, 2].map((k) => fg[k] * a + bg[k] * (1 - a));
            const la = lum(f as RGB), lb = lum(bg as RGB);
            const r = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
            if (r < worst) { worst = r; wf = f; }
          }
          scored.push({ r: worst, n, bg, fg: wf });
        }
        scored.sort((a, b) => a.r - b.r);
        let seenN = 0, one = scored[scored.length - 1];
        for (const sc of scored) { seenN += sc.n; if (seenN >= total * 0.05) { one = sc; break; } }
        if (!here || one.r < here.r) { here = one; herePng = png; }
      }
      const after = await page.evaluate((i: number) => {
        const el = document.querySelector(`[data-qa-sweep="${i}"]`) as HTMLElement | null;
        if (!el) return null;
        const rects = [...el.getClientRects()].map((q) => ({ x: Math.max(0, q.left), y: Math.max(0, q.top), w: Math.min(q.width, innerWidth - Math.max(0, q.left)), h: Math.min(q.height, innerHeight - Math.max(0, q.top)) })).filter((q) => q.w >= 2 && q.h >= 2);
        el.style.visibility = "";
        return rects;
      }, it.idx);
      if (after && sameBoxes(at.rects as Box[], after as Box[])) { pick = here; worstPng = herePng; break; }
    }
    if (wasCovered) { skipped++; covered.push(`<${it.sel}> "${it.text}"`); continue; }
    if (!pick) { failures.push(`${label}: <${it.sel}> "${it.text}" could not be measured: the page kept moving under the photograph in ${PHOTO_ATTEMPTS} attempts (${it.kind})`); continue; }
    verified++;
    // Debug aid: QA_THEME_DUMP=<dir> keeps the photograph of every failing element.
    if (pick.r < it.need && process.env.QA_THEME_DUMP && worstPng) { try { fs.mkdirSync(process.env.QA_THEME_DUMP, { recursive: true }); fs.writeFileSync(path.join(process.env.QA_THEME_DUMP, `${label.replace(/\W+/g, "_")}-${it.idx}.png`), worstPng); } catch { /* best effort */ } }
    if (pick.r < it.need) failures.push(`${label}: <${it.sel}> "${it.text}" ${hex(pick.fg.map(Math.round) as RGB)} on ${hex(pick.bg as RGB)} = ${pick.r.toFixed(2)}:1 (needs ${it.need}, ${it.kind}, measured on pixels)`);
  }
  await page.evaluate(() => { document.querySelectorAll("[data-qa-sweep]").forEach((e) => e.removeAttribute("data-qa-sweep")); window.scrollTo(0, 0); });
  skipped += Math.max(0, items.length - 80);
  return { verified, skipped, covered };
}
/** One sweep of the open page: the in-page pass, then the pixel pass for what it could not decide. */
async function sweepPage(page: any, label: string, opts: { print?: boolean } = {}) {
  await waitStable(page, 250);
  const r = await page.evaluate(`(${SWEEP})(${JSON.stringify({ allow: ALLOW, extra: EXTRA_LAYERS, print: opts.print ?? false })})`);
  const failures: string[] = r.failures.map((f: { sel: string; text: string; fg: string; bg: string; ratio: number; need: number; kind: string }) => `${label}: <${f.sel}> "${f.text}" ${f.fg} on ${f.bg} = ${f.ratio}:1 (needs ${f.need}, ${f.kind})`);
  const px = await verifyByPixels(page, r.recheck as Recheck[], label, failures);
  return { checked: r.checked as number, bounded: r.bounded as number, allowed: r.allowed.length as number, pixel: px.verified, pixelSkipped: px.skipped, covered: px.covered.map((c) => `${label}: ${c}`), failures };
}

// Known exceptions. Each carries the reason; a failing element that matches is counted as "allowed", never as passed.
const ALLOW: Array<{ selector: string; reason: string }> = [
  { selector: "[data-qa-theme-allow]", reason: "an element a page marks itself (none today)" },
];
// The redesign pages paint a fixed glow layer (.app-bg) between the page colour and the content.
const EXTRA_LAYERS = [{ container: ".wasfix-design", layer: ".wasfix-design > .app-bg" }];

// Horizontal overflow of the open page, and the fit of its header row (the marketing header or the redesign nav). A string for the same reason as SWEEP.
const OVERFLOW_JS = String.raw`(() => {
  const vw = document.documentElement.clientWidth;
  const offenders = [];
  for (const el of document.body.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= vw + 2) continue;
    const cs = getComputedStyle(el);
    if (cs.position === "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
    let clipped = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a); if (/(hidden|clip|auto|scroll)/.test(o.overflowX)) { clipped = true; break; } }
    if (!clipped) offenders.push(el.tagName.toLowerCase() + "." + (el.getAttribute("class") || "").split(" ")[0]);
  }
  // The header row: no control past the container's right edge (the page does not scroll sideways here, a stray button is simply cut off),
  // and no link or button wrapped onto a second line.
  let header = null;
  const hdr = document.querySelector('header[class*="sticky"], nav.nav');
  if (hdr) {
    const inner = hdr.querySelector(".container") || hdr;
    const cs = getComputedStyle(inner);
    const limit = inner.getBoundingClientRect().right - parseFloat(cs.paddingRight);
    const kids = [...hdr.querySelectorAll("a, button")].filter((e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && st.visibility !== "hidden" && st.display !== "none"; });
    const name = (e) => (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 24);
    // Can a visitor get to the other pages from here? Either the links are on show (the desktop nav, or the second row of the
    // redesign nav at tablet widths) or there is a menu button. Neither: the pages are unreachable from the header.
    const shown = (e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none"; };
    // querySelectorAll matches against the whole document, so "nav a" inside <nav class="nav"> would count the brand and the buttons: ask the
    // redesign nav for its link list, and the marketing header for the <nav> inside it.
    const reach = { links: [...hdr.querySelectorAll(hdr.matches("nav") ? ".nav-links a" : "nav a")].filter(shown).length, menuButton: [...hdr.querySelectorAll('button[aria-label^="Menu"]')].some(shown) };
    header = { past: kids.filter((e) => e.getBoundingClientRect().right > limit + 0.5).map(name), wrapped: kids.filter((e) => e.getBoundingClientRect().height > 50).map(name), reach };
  }
  return { scroll: document.documentElement.scrollWidth, vw, offenders: offenders.slice(0, 5), header };
})()`;

// ───────────────────────────── the pages ─────────────────────────────
type PageDef = { name: string; path: string };
async function discover(): Promise<PageDef[]> {
  const get = async (p: string) => (await fetch(`${BASE}${p}`)).text();
  const first = (html: string, re: RegExp) => re.exec(html)?.[1];
  const part = first(await get("/onderdelen"), /href="(\/onderdelen\/[^"?#]+)"/) ?? "/onderdelen";
  const code = first(await get("/foutcodes"), /href="(\/foutcodes\/[^"?#]+)"/) ?? "/foutcodes";
  const core: PageDef[] = [
    { name: "home", path: "/" },
    { name: "onderdelen", path: "/onderdelen" },
    { name: "product", path: part },
    { name: "diagnose", path: "/diagnose" },
    { name: "foutcodes", path: "/foutcodes" },
    { name: "foutcode-detail", path: code },
    { name: "prijzen", path: "/prijzen" },
    { name: "merken", path: "/merken" },
    { name: "blog", path: "/blog" },
    { name: "contact", path: "/contact" },
    { name: "legal-privacy", path: "/privacy" },
    { name: "not-found", path: "/dit-bestaat-niet-qa-theme" },
  ];
  if (!FULL) return core;
  const guide = first(await get("/gidsen"), /href="(\/gidsen\/[^"?#]+)"/) ?? "/gidsen";
  const vsSlug: string = (JSON.parse(read("src/data/comparisons.json")) as Array<{ slug: string }>)[0].slug;
  const brand = first(await get("/merken"), /href="(\/merken\/[^"?#/]+)"/) ?? "/merken";
  const extra = ["/gidsen", guide, brand, "/over", "/help", "/garantie", "/voorwaarden", "/cookies", "/disclaimer", "/klachten", "/retourvoorwaarden", "/right-to-repair", "/pers", "/api-docs", "/api-info", "/tools/garantie-check", "/tools/predictive", "/tools/qr-sticker", "/tools/repareren-of-vervangen", "/monteur", "/inloggen", "/registreren", "/upgrade", "/checkout", "/retour/start", `/vs/${vsSlug}`, "/bosch-wasmachine-reparatie", "/wasmachine-kapot/amsterdam"];
  return [...core, ...extra.map((p) => ({ name: p.replace(/^\//, "").replace(/\W+/g, "-") || "x", path: p }))];
}

const REAL_ERROR = /hydrat|did not match|Minified React error|#418|#423|#425|Warning:|Text content does not match/i;
type Collector = { errors: string[] };
function collect(page: any): Collector {
  const c: Collector = { errors: [] };
  page.on("console", (m: any) => {
    // The browser logs "Failed to load resource ... 404" for a document that answers 404 on purpose (the not-found page);
    // that is the page under test doing its job, not an error. A 404 for any OTHER URL (an image, a script) still counts.
    if (m.type() === "error" && /Failed to load resource: the server responded with a status of 404/.test(m.text()) && m.location().url === page.mainFrame().url()) return;
    if (m.type() === "error" || (m.type() === "warning" && REAL_ERROR.test(m.text()))) c.errors.push(`console.${m.type()}: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e: any) => c.errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  return c;
}
/**
 * The production policy carries `upgrade-insecure-requests`, which is right on https://wasfix.nl. On a plain-http local server
 * Chromium upgrades even same-origin subresources to https and fails them (ERR_SSL_PROTOCOL_ERROR), which would break every
 * client-side navigation under test. The harness removes that one directive from DOCUMENT responses; every other directive of the
 * policy still applies (scripts/qa-csp.ts is the suite that judges the policy itself).
 */
async function relaxUpgradeInsecure(ctx: any, base: string) {
  const origin = new URL(base).origin;
  // Nothing outside the server under test is wanted (no network in CI sandboxes, and an unreachable host only makes `load` wait).
  await ctx.route((u: URL) => u.origin !== origin && /^https?:$/.test(u.protocol), (route: any) => route.abort());
  if (!origin.startsWith("http://")) return;
  await ctx.route((u: URL) => u.origin === origin, async (route: any) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const res = await route.fetch({ maxRedirects: 0 });
    const headers: Record<string, string> = { ...res.headers() };
    for (const k of ["content-security-policy", "content-security-policy-report-only"]) if (headers[k]) headers[k] = headers[k].replace(/;?\s*upgrade-insecure-requests/g, "");
    await route.fulfill({ response: res, headers });
  });
}
/** Run `fn` over `items` with at most `n` in flight (the machine has few cores; QA_THEME_CONCURRENCY overrides). */
const CONC = Math.max(1, Number(process.env.QA_THEME_CONCURRENCY ?? 3));
async function pool<T>(items: T[], fn: (x: T) => Promise<void>, n = CONC) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) await fn(items[next++]); }));
}
const consentCookie = (url: string) => ({ name: "wasfix-consent", value: encodeURIComponent(JSON.stringify({ functional: true, analytics: false, marketing: false, ts: 1 })), url });
async function context(browser: any, opts: { width?: number; theme?: string | null; os?: "light" | "dark"; consent?: boolean; base: string; print?: boolean }) {
  const ctx = await browser.newContext({ viewport: { width: opts.width ?? 1280, height: (opts.width ?? 1280) < 600 ? 812 : 800 }, colorScheme: opts.os ?? "light", reducedMotion: "reduce" });
  await relaxUpgradeInsecure(ctx, opts.base);
  if (opts.theme) await ctx.addInitScript((t: string) => { try { if (!sessionStorage.getItem("qa-theme-seeded")) { localStorage.setItem("theme", t); sessionStorage.setItem("qa-theme-seeded", "1"); } } catch { /* no storage */ } }, opts.theme);
  if (opts.consent !== false) await ctx.addCookies([consentCookie(opts.base)]);
  return ctx;
}
const isDark = (page: any) => page.evaluate(() => document.documentElement.classList.contains("dark"));
/** Wait until the page is hydrated: the toggle names its current choice (aria-label "Kleurthema: ...", aria-pressed) only after mount. */
async function settle(page: any) {
  await page.waitForSelector('[data-theme-trigger][aria-label^="Kleurthema:"], [data-theme-toggle="segmented"] [aria-pressed]', { state: "attached", timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(250);
}

async function chooseByMouse(page: any, value: "light" | "dark" | "system") {
  const root = page.locator("[data-theme-toggle]:visible").first();
  if ((await root.getAttribute("data-theme-toggle")) === "menu") await root.locator("[data-theme-trigger]").click();
  await page.locator(`[data-theme-choice="${value}"]:visible`).first().click();
  await page.waitForTimeout(150);
}
async function chooseByKeyboard(page: any, value: "light" | "dark" | "system") {
  const trigger = page.locator("[data-theme-trigger]:visible").first();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-theme-choice]:visible', { timeout: 3000 });
  for (let i = 0; i < 4; i++) {
    const at = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("data-theme-choice") ?? null);
    if (at === value) break;
    await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  return page.evaluate(() => (document.activeElement as HTMLElement | null)?.hasAttribute("data-theme-trigger") ?? false);
}

/**
 * Click the first header (or redesign nav) link to another public page: a CLIENT-side navigation, the document is not reloaded.
 * `sameDocument` says whether it really was one. A link into a private area is no test of anything here: without a session it
 * redirects off-site.
 */
async function clientNavigate(page: any): Promise<{ clicked: boolean; sameDocument: boolean }> {
  const here = new URL(page.url()).pathname;
  const hrefs: string[] = await page.locator('header a[href^="/"]:visible, .nav a[href^="/"]:visible').evaluateAll((as: HTMLAnchorElement[]) => as.map((a) => a.getAttribute("href") ?? ""));
  const target = hrefs.find((h) => h !== "/" && !h.startsWith("#") && h.split("?")[0] !== here && !/^\/(dashboard|admin|monteur|inloggen|registreren|checkout)(\/|$|\?)/.test(h));
  if (!target) return { clicked: false, sameDocument: true };
  const link = page.locator(`header a[href="${target}"]:visible, .nav a[href="${target}"]:visible`).first();
  await page.evaluate(() => { (window as unknown as { __qaNav?: number }).__qaNav = 1; });
  const before = page.url();
  await link.click();
  await page.waitForURL((u: URL) => u.toString() !== before, { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(400);
  return { clicked: true, sameDocument: await page.evaluate(() => (window as unknown as { __qaNav?: number }).__qaNav === 1) };
}

// ───────────────────────────── browser checks ─────────────────────────────
async function browserChecks(pw: any) {
  const browser = await pw.chromium.launch();
  try {
    const pages = process.env.QA_THEME_PAGES ? process.env.QA_THEME_PAGES.split(",").map((p) => ({ name: p.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "home", path: p })) : await discover();
    const base = BASE!;
    const names = (xs: string[]) => (xs.length ? ` (${xs.slice(0, 6).join(", ")}${xs.length > 6 ? ", ..." : ""})` : "");

    // ── a: first visit, OS prefers dark, nothing stored
    if (on("a")) {
      note("a  first visit with an OS that prefers DARK and empty storage renders LIGHT");
      const bad: string[] = [];
      let metaOk = true;
      const ctx = await context(browser, { os: "dark", theme: null, base });
      const page = await ctx.newPage();
      for (const p of pages) {
        await page.goto(base + p.path, { waitUntil: "domcontentloaded" });
        const st = await page.evaluate(() => ({ dark: document.documentElement.classList.contains("dark"), scheme: getComputedStyle(document.documentElement).colorScheme, stored: localStorage.getItem("theme"), bg: getComputedStyle(document.body).backgroundColor }));
        if (st.dark || st.scheme !== "light" || st.stored !== null) bad.push(`${p.name}: dark=${st.dark} color-scheme=${st.scheme} stored=${st.stored}`);
      }
      // The server's HTML, not the live DOM: once the page is hydrated the provider rewrites every tag to the chosen theme (check b3).
      const html = await (await ctx.request.get(base + "/")).text();
      const metaTags = html.match(/<meta\b[^>]*>/g) ?? [];
      const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
      const meta = {
        scheme: attr(metaTags.find((t: string) => attr(t, "name") === "color-scheme") ?? "", "content"),
        tags: metaTags.filter((t: string) => attr(t, "name") === "theme-color").map((t: string) => `${attr(t, "media")}=${attr(t, "content")}`),
      };
      metaOk = meta.scheme === "light" && meta.tags.some((t: string) => t.includes("light") && t.endsWith(THEME_COLOR_LIGHT)) && meta.tags.some((t: string) => t.includes("dark") && t.endsWith(THEME_COLOR_DARK));
      check(bad.length === 0, `no .dark on <html>, computed color-scheme light, nothing stored, on all ${pages.length} pages although the OS prefers dark`, `a fresh dark-OS visitor did not get light:${names(bad)}`);
      check(metaOk, "the viewport export emits color-scheme=light and a theme-color tag per scheme with the token colours", `viewport meta tags: ${JSON.stringify(meta)}`);
      await ctx.close();
    }

    // ── b + c: the toggle
    if (on("b")) {
      note("b  the toggle: where it is, its name, keyboard and mouse, persistence, system, theme-color");
      const noHeader: string[] = [], noMobileMenu: string[] = [], noBottom: string[] = [], noFooter: string[] = [], noName: string[] = [], badKeys: string[] = [], badDark: string[] = [], badReload: string[] = [], badNav: string[] = [], badLight: string[] = [], badSystem: string[] = [], badSwitchClose: string[] = [];
      const errors: string[] = [];
      // The two sign-in pages are stand-alone cards: their toggle is a fixed one in the corner, not part of a header or footer.
      // The bottom bar is not rendered in the admin, the dashboard and the checkout (MobileBottomNav.tsx): there the toggle is in the header's menu.
      const standalone = (path: string) => /^\/(inloggen|registreren)(\/|$)/.test(path);
      const barless = (path: string) => /^\/(admin|dashboard|checkout)(\/|$)/.test(path);
      await pool(pages, async (p) => {
        // desktop
        const ctx = await context(browser, { theme: null, base });
        const page = await ctx.newPage();
        const col = collect(page);
        await page.goto(base + p.path, { waitUntil: "load" });
        await settle(page);
        const hdr = await page.locator(standalone(p.path) ? '[data-theme-toggle="menu"]:visible' : 'header [data-theme-toggle="menu"]:visible, .nav [data-theme-toggle="menu"]:visible').count();
        if (hdr === 0) noHeader.push(p.name);
        const footer = standalone(p.path) ? 1 : await page.locator('footer [data-theme-toggle="segmented"]').count();
        if (footer === 0) noFooter.push(p.name);
        // Without a toggle in the header there is nothing to operate: the page is reported above and the rest of this flow is skipped.
        if (hdr > 0) {
          const label = await page.locator("[data-theme-trigger]:visible").first().getAttribute("aria-label");
          if (!label || !/^Kleurthema/.test(label)) noName.push(`${p.name}: ${label}`);
          // keyboard: open, move, choose Donker
          const refocused = await chooseByKeyboard(page, "dark");
          if (!(await isDark(page))) badKeys.push(p.name);
          if (!refocused) badSwitchClose.push(p.name);
          if ((await page.evaluate(() => localStorage.getItem("theme"))) !== "dark") badDark.push(`${p.name}: localStorage`);
          // reload: dark before the first paint
          await page.goto(base + p.path, { waitUntil: "domcontentloaded" });
          if (!(await isDark(page))) badReload.push(p.name);
          // client navigation keeps it
          await settle(page);
          const nav = await clientNavigate(page);
          if (nav.clicked && (!(await isDark(page)) || !nav.sameDocument)) badNav.push(`${p.name}${nav.sameDocument ? "" : " (full reload, not a client navigation)"}`);
          await page.goto(base + p.path, { waitUntil: "load" });
          await settle(page);
          // Licht by mouse
          await chooseByMouse(page, "light");
          if (await isDark(page)) badLight.push(p.name);
          if ((await page.evaluate(() => localStorage.getItem("theme"))) !== "light") badLight.push(`${p.name}: localStorage`);
          // Systeem follows the OS, both directions
          await chooseByMouse(page, "system");
          await page.emulateMedia({ colorScheme: "dark" });
          await page.waitForFunction(() => document.documentElement.classList.contains("dark"), null, { timeout: 3000 }).catch(() => undefined);
          const sysDark = await isDark(page);
          await page.emulateMedia({ colorScheme: "light" });
          await page.waitForFunction(() => !document.documentElement.classList.contains("dark"), null, { timeout: 3000 }).catch(() => undefined);
          const sysLight = !(await isDark(page));
          if (!sysDark || !sysLight) badSystem.push(`${p.name} (dark ${sysDark}, light ${sysLight})`);
        }
        errors.push(...col.errors.map((e) => `${p.name}: ${e}`));
        await ctx.close();

        // mobile: mobile menu (marketing header), bottom bar
        const mctx = await context(browser, { width: 375, theme: null, base });
        const mp = await mctx.newPage();
        const mcol = collect(mp);
        await mp.goto(base + p.path, { waitUntil: "load" });
        await settle(mp);
        const bottom = barless(p.path) ? 1 : await mp.locator('nav[aria-label="Mobiele navigatie"] [data-theme-toggle]:visible').count();
        if (bottom === 0) noBottom.push(p.name);
        const burger = mp.locator('header button[aria-label="Menu openen"]');
        if (barless(p.path) && (await burger.count()) === 0) noBottom.push(`${p.name} (no bottom bar and no menu)`);
        if (await burger.count()) {
          await burger.click();
          const inMenu = await mp.locator('header [data-theme-toggle="segmented"]:visible').count();
          if (inMenu === 0) noMobileMenu.push(p.name);
        }
        errors.push(...mcol.errors.map((e) => `${p.name} (375): ${e}`));
        await mctx.close();
      });
      check(noHeader.length === 0, `the header (or the redesign nav) of all ${pages.length} pages has the toggle at 1280 px`, `no toggle in the header/nav of:${names(noHeader)}`);
      check(noMobileMenu.length === 0, "the mobile menu of the marketing header has the segmented toggle", `no toggle in the mobile menu of:${names(noMobileMenu)}`);
      check(noBottom.length === 0, "the bottom bar has the toggle on every page at 375 px", `no toggle in the bottom bar of:${names(noBottom)}`);
      check(noFooter.length === 0, "the footer has the segmented toggle on every page", `no toggle in the footer of:${names(noFooter)}`);
      check(noName.length === 0, "the toggle has an accessible name (Kleurthema ...)", `unnamed toggle:${names(noName)}`);
      check(badKeys.length === 0 && badSwitchClose.length === 0, "keyboard: Enter opens it, the arrow keys move, Enter picks Donker, focus returns to the button", `keyboard operation failed:${names([...badKeys, ...badSwitchClose.map((x) => `${x} (focus not returned)`)])}`);
      check(badDark.length === 0, "choosing Donker puts .dark on <html> and 'dark' in localStorage 'theme'", `Donker did not stick:${names(badDark)}`);
      check(badReload.length === 0, "Donker survives a reload and is on <html> at DOMContentLoaded (before the first paint)", `after a reload:${names(badReload)}`);
      check(badNav.length === 0, "Donker survives a client-side navigation (no full reload)", `after navigating:${names(badNav)}`);
      check(badLight.length === 0, "choosing Licht removes .dark and stores 'light'", `Licht did not stick:${names(badLight)}`);
      check(badSystem.length === 0, "Systeem follows prefers-color-scheme: dark adds .dark, light removes it", `Systeem did not follow the OS:${names(badSystem)}`);
      note("c  console errors, page errors and hydration warnings (desktop and 375 px, theme switching included)");
      check(errors.length === 0, `no console error, page error or hydration warning on ${pages.length} pages (both widths, while switching themes)`, `console/page errors:${names(errors)}`);
    }

    // ── first paint with a stored dark choice
    if (on("b2")) {
      note("b2 no flash of the wrong theme");
      const ctx = await context(browser, { theme: "dark", base });
      await ctx.addInitScript(() => {
        const w = window as unknown as { __darkAt?: number };
        // Observe the document itself: at the moment an init script runs <html> may not exist yet.
        new MutationObserver(() => { if (document.documentElement?.classList.contains("dark") && w.__darkAt === undefined) w.__darkAt = performance.now(); }).observe(document, { attributes: true, subtree: true, attributeFilter: ["class"] });
      });
      const page = await ctx.newPage();
      const bad: string[] = [];
      for (const p of pages.slice(0, 4)) {
        await page.goto(base + p.path, { waitUntil: "load" });
        await page.waitForTimeout(300);
        const t = await page.evaluate(() => ({ darkAt: (window as unknown as { __darkAt?: number }).__darkAt, fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime }));
        if (t.darkAt === undefined || t.fcp === undefined || t.darkAt > t.fcp) bad.push(`${p.name}: dark at ${t.darkAt?.toFixed(0)} ms, first paint at ${t.fcp?.toFixed(0)} ms`);
      }
      check(bad.length === 0, "with Donker stored, .dark is on <html> before the first contentful paint", `the dark class arrived after the first paint:${names(bad)}`);
      await ctx.close();
    }

    // ── theme-color follows the choice
    if (on("b3")) {
      note("b3 <meta name=theme-color> follows the chosen theme, not the OS");
      const bad: string[] = [];
      const ctx = await context(browser, { theme: null, os: "light", base });
      const page = await ctx.newPage();
      await page.goto(base + "/", { waitUntil: "load" });
      await settle(page);
      const tags = () => page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute("content")));
      await chooseByMouse(page, "dark");
      let t = await tags();
      if (!t.length || !t.every((c: string) => c === THEME_COLOR_DARK)) bad.push(`OS light, Donker chosen: ${t.join("/")}`);
      await chooseByMouse(page, "light");
      t = await tags();
      if (!t.every((c: string) => c === THEME_COLOR_LIGHT)) bad.push(`Licht chosen: ${t.join("/")}`);
      await page.emulateMedia({ colorScheme: "dark" });
      await chooseByMouse(page, "light");
      t = await tags();
      if (!t.every((c: string) => c === THEME_COLOR_LIGHT)) bad.push(`OS dark, Licht chosen: ${t.join("/")}`);
      const rendered = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await chooseByMouse(page, "dark");
      const renderedDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const toHex = (s: string) => { const m = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(s)!; return hex([+m[1], +m[2], +m[3]]); };
      if (toHex(rendered) !== THEME_COLOR_LIGHT || toHex(renderedDark) !== THEME_COLOR_DARK) bad.push(`rendered body background ${toHex(rendered)}/${toHex(renderedDark)} differs from the theme-color constants`);
      // Next puts the server's tags (the phone's preference) back on every client-side navigation; the provider must put the colour of the
      // CHOSEN theme back after that, in both directions (OS light + Donker, OS dark + Licht), on two navigations in a row.
      const navTags: string[] = [];
      for (const [os, choice, want] of [["light", "dark", THEME_COLOR_DARK], ["dark", "light", THEME_COLOR_LIGHT]] as const) {
        await page.emulateMedia({ colorScheme: os });
        await settle(page);
        await chooseByMouse(page, choice);
        for (let hop = 1; hop <= 2; hop++) {
          const nav = await clientNavigate(page);
          if (!nav.clicked || !nav.sameDocument) { bad.push(`could not make a client-side navigation from ${new URL(page.url()).pathname} (clicked ${nav.clicked}, same document ${nav.sameDocument})`); break; }
          await settle(page);
          t = await tags();
          if (!t.length || !t.every((c: string) => c === want)) navTags.push(`OS ${os}, ${choice} chosen, after navigation ${hop} to ${new URL(page.url()).pathname}: ${t.join("/")} (want ${want})`);
        }
      }
      if (navTags.length) bad.push(...navTags);
      check(bad.length === 0, "every theme-color tag carries the colour of the CHOSEN theme (OS light + Donker, OS dark + Licht), equal to the rendered page background, and still does after client-side navigations", `theme-color: ${bad.join("; ")}`);
      await ctx.close();
    }

    // ── d0: the pixel verifier itself
    if (on("d0") || on("d")) await pixelVerifierSelfTest(browser);

    // ── d + e: the contrast sweep and overflow
    if (on("d")) {
      note(`d  contrast sweep: ${pages.length} pages x {light, dark} x {375, 1280}${FULL ? " (full)" : ""}; failures below 4.5:1 (3:1 for large text)`);
      const failures: string[] = [];
      const overflow: string[] = [];
      let totalChecked = 0, totalBounded = 0, totalAllowed = 0, totalPixel = 0, totalSkipped = 0;
      const coveredAll: string[] = [];
      // The four (theme, width) combinations run side by side, each in its own browser context; the pages of one combination
      // follow each other. A context is cheap, a page load under load is not, so QA_THEME_CONCURRENCY bounds the combinations in flight.
      const combos = (["light", "dark"] as const).flatMap((theme) => [375, 1280].map((width) => ({ theme, width })));
      const lines = new Map<string, string[]>();
      await pool(combos, async ({ theme, width }) => {
        const ctx = await context(browser, { width, theme, base });
        const page = await ctx.newPage();
        const out: string[] = [];
        lines.set(`${theme}${width}`, out);
        for (const p of pages) {
          await page.goto(base + p.path, { waitUntil: "load" });
          await settle(page);
          const r = await sweepPage(page, `${p.name} ${theme} ${width}`);
          totalChecked += r.checked; totalBounded += r.bounded; totalAllowed += r.allowed; totalPixel += r.pixel; totalSkipped += r.pixelSkipped; coveredAll.push(...r.covered);
          out.push(`   ${p.name.padEnd(16)} ${theme.padEnd(5)} ${String(width).padStart(4)}px  ${String(r.checked).padStart(4)} text elements, ${r.failures.length} fail, ${r.bounded} proven by gradient stops, ${r.pixel} measured on pixels, ${r.pixelSkipped} covered/over the cap, ${r.allowed} allowed`);
          failures.push(...r.failures);
          if (width === 375 && theme === "dark") {
            const o = await page.evaluate(OVERFLOW_JS);
            if (o.scroll > o.vw + 1 || o.offenders.length) overflow.push(`${p.name}: scrollWidth ${o.scroll} > ${o.vw} or overflowing ${o.offenders.join(", ")}`);
          }
        }
        await ctx.close();
      });
      for (const combo of combos) console.log((lines.get(`${combo.theme}${combo.width}`) ?? []).join("\n"));
      console.log(`   total: ${totalChecked} text elements judged; ${totalBounded} on gradients were proven by their colour stops, ${totalPixel} (gradients, pictures, SVG text) were measured on the rendered pixels, ${totalSkipped} were covered by something else or over the cap, ${totalAllowed} are allowed exceptions`);
      check(failures.length === 0, `no text below its contrast minimum on ${pages.length} pages in both themes at both widths (${totalChecked} elements judged)`, `contrast failures (${failures.length}):\n      ${failures.slice(0, 40).join("\n      ")}${failures.length > 40 ? `\n      ... and ${failures.length - 40} more` : ""}`);
      note(totalSkipped === 0 ? "every element on a gradient, a picture or an SVG was measured on pixels or proven by its stops"   : `${totalSkipped} element(s) could not be measured on pixels (covered by another element, or over the cap of 80 per page) and are NOT judged: ${coveredAll.slice(0, 6).join("; ")}`);
      note("e  horizontal overflow at 375 px in dark");
      check(overflow.length === 0, `no horizontal overflow at 375 px in dark on ${pages.length} pages`, `overflow in dark at 375 px:${names(overflow)}`);
    }

    // ── e2: the headers and the pages at tablet widths
    if (on("e2")) await tabletChecks(browser, base, pages);
    // ── e3: the opened mobile menu, the footers and the bottom bar panel on a phone
    if (on("e3")) await narrowChecks(browser, base);
    // ── j: form-field boundaries (non-text contrast)
    if (on("j")) await fieldChecks(browser, base);
    // ── k: a junk stored theme, blocked web storage
    if (on("k")) await robustnessChecks(browser, base);
    // ── i: overlays
    if (on("i")) await overlayChecks(browser, base);
    // ── f: documents
    if (on("f")) await documentChecks(browser, base);
    // ── g: dashboard + admin
    if (on("g")) await demoChecks(browser);
    // ── h: stand-alone error page
    if (on("h")) await globalErrorChecks(browser, base);
  } finally {
    await browser.close();
  }
}

/**
 * e2  The theme toggle made both header rows wider; at tablet widths (640-1180 px) the marketing header ran 13 px past the screen at
 * 1024 px and the redesign nav cut off "Start gratis" at 896-960 px, while the checks only looked at 375 and 1280. Here every page of
 * the list is loaded once per theme and resized through the tablet widths: the page must not scroll sideways, no control of the header
 * may sit past the container's right edge, no link or button may wrap onto a second line, and the other pages must stay reachable
 * (links on show or a menu button: the redesign nav used to have neither between 768 and 880 px, and after the toggle until 940 px).
 */
async function tabletChecks(browser: any, base: string, pages: PageDef[]) {
  const widths = [640, 768, 900, 960, 1024, 1100, 1180];
  note(`e2 header row and page overflow at ${widths.join(", ")} px, light and dark, ${pages.length} pages`);
  const bad: string[] = [];
  const combos = (["light", "dark"] as const).map((theme) => ({ theme }));
  await pool(combos, async ({ theme }) => {
    const ctx = await context(browser, { width: widths[0], theme, base });
    const page = await ctx.newPage();
    for (const p of pages) {
      await page.setViewportSize({ width: widths[0], height: 800 });
      await page.goto(base + p.path, { waitUntil: "load" });
      await settle(page);
      for (const w of widths) {
        await page.setViewportSize({ width: w, height: 800 });
        await page.waitForTimeout(60);
        const o = await page.evaluate(OVERFLOW_JS);
        const why: string[] = [];
        if (o.scroll > o.vw + 1) why.push(`scrollWidth ${o.scroll} > ${o.vw}`);
        if (o.offenders.length) why.push(`overflowing ${o.offenders.join(", ")}`);
        if (o.header?.past.length) why.push(`header controls past the container: ${o.header.past.join(", ")}`);
        if (o.header?.wrapped.length) why.push(`header controls wrapped: ${o.header.wrapped.join(", ")}`);
        // Below 768 px the bottom bar is the navigation of the redesign pages; from 768 px the header itself must offer it.
        if (w >= 768 && o.header && o.header.reach.links === 0 && !o.header.reach.menuButton) why.push("no navigation links and no menu button: the other pages cannot be reached from the header");
        if (why.length) bad.push(`${p.name} ${theme} ${w}px: ${why.join("; ")}`);
      }
    }
    await ctx.close();
  });
  const names = (xs: string[]) => (xs.length ? `\n      ${xs.slice(0, 12).join("\n      ")}${xs.length > 12 ? `\n      ... and ${xs.length - 12} more` : ""}` : "");
  check(bad.length === 0, `at ${widths.join(", ")} px the page does not scroll sideways, the header row (marketing header, redesign nav) fits on one line and the other pages stay reachable from it (links or a menu button), in both themes, on ${pages.length} pages`, `tablet widths:${names(bad)}`);
}

// The theme controls (segmented variant) on the page and whether each stays inside the content box of its container. A string, like SWEEP.
const FIT_JS = String.raw`(() => [...document.querySelectorAll('[data-theme-toggle="segmented"]')].filter((c) => c.getBoundingClientRect().width > 0).map((c) => {
  const r = c.getBoundingClientRect();
  const host = c.closest(".container") || document.body;
  const hr = host.getBoundingClientRect(), cs = getComputedStyle(host);
  const left = hr.left + parseFloat(cs.paddingLeft), right = hr.right - parseFloat(cs.paddingRight);
  const clipped = [...c.querySelectorAll("button")].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => (b.textContent || "").trim());
  return { where: c.closest("header") ? "in the opened menu" : c.closest("footer") ? "in the footer" : "on the page", outLeft: Math.round(left - r.left), outRight: Math.round(r.right - right), clipped };
}))()`;

/**
 * e3  The OPENED mobile menu, the footers and the bottom bar's panel on a phone. The segmented theme control is 262-292 px wide; in the
 * opened menu it sat beside its "Thema" label and ran 20-30 px past the content gutter at 320-414 px, and the page scrolled sideways at
 * 360 px. Every earlier check measured the header with the menu CLOSED. Here, in both themes: the opened menu (row, links, buttons, the
 * control) stays inside the page and inside the gutter, no choice of the control clips its word, the footer controls of a shop page and
 * a redesign page fit, the bottom bar's panel stays on the screen, and the opened menu passes the contrast sweep at 375 px.
 */
async function narrowChecks(browser: any, base: string) {
  const widths = [320, 360, 375, 414, 479, 480, 768];
  note(`e3 the opened mobile menu, the footer controls and the bottom bar panel fit at ${widths.join(", ")} px, light and dark`);
  const bad: string[] = [];
  const sweeps: string[] = [];
  let measured = 0;
  const combos = (["light", "dark"] as const).flatMap((theme) => widths.map((width) => ({ theme, width })));
  await pool(combos, async ({ theme, width }) => {
    const ctx = await context(browser, { width, theme, base });
    const page = await ctx.newPage();
    const tag = `${theme} ${width}px`;
    const judge = (where: string, controls: Array<{ where: string; outLeft: number; outRight: number; clipped: string[] }>) => {
      for (const c of controls) {
        measured++;
        if (c.outLeft > 1 || c.outRight > 1) bad.push(`${tag} ${where}: the theme control ${c.where} sticks out of the content area (${c.outLeft > 1 ? `${c.outLeft} px left` : `${c.outRight} px right`})`);
        if (c.clipped.length) bad.push(`${tag} ${where}: the theme control ${c.where} clips the word of ${c.clipped.join(", ")}`);
      }
    };
    // the shop header's menu, opened, and the footer of the same page
    await page.goto(base + "/onderdelen", { waitUntil: "load" });
    await settle(page);
    await page.locator('header button[aria-label="Menu openen"]').click();
    await page.waitForSelector('header [data-theme-toggle="segmented"]:visible', { timeout: 5000 }).catch(() => undefined);
    const controls = await page.evaluate(FIT_JS);
    if (!controls.some((c: { where: string }) => c.where === "in the opened menu")) bad.push(`${tag} /onderdelen: the opened menu has no theme control`);
    judge("/onderdelen", controls);
    const o = await page.evaluate(OVERFLOW_JS);
    if (o.scroll > o.vw + 1) bad.push(`${tag} /onderdelen with the menu open: scrollWidth ${o.scroll} > ${o.vw}`);
    if (o.header?.past.length) bad.push(`${tag} /onderdelen with the menu open: past the container: ${o.header.past.join(", ")}`);
    if (width === 375) { const r = await sweepPage(page, `open mobile menu ${tag}`); sweeps.push(...r.failures.slice(0, 3)); }
    // the footer of a redesign page
    await page.goto(base + "/diagnose", { waitUntil: "load" });
    await settle(page);
    judge("/diagnose", await page.evaluate(FIT_JS));
    // the bottom bar's panel opens upward from the sixth item and must stay on the screen
    if (width < 768) {
      await page.locator('nav[aria-label="Mobiele navigatie"] [data-theme-trigger]').click();
      const pr = await page.evaluate(() => { const r = document.querySelector('nav[aria-label="Mobiele navigatie"] .theme-toggle__panel')?.getBoundingClientRect(); return r ? { left: Math.round(r.left), right: Math.round(r.right - document.documentElement.clientWidth), top: Math.round(r.top) } : null; });
      if (!pr) bad.push(`${tag} /diagnose: the bottom bar's theme panel did not open`);
      else if (pr.left < 0 || pr.right > 0 || pr.top < 0) bad.push(`${tag} /diagnose: the bottom bar's theme panel leaves the screen (left ${pr.left}, right ${pr.right}, top ${pr.top})`);
    }
    await ctx.close();
  });
  const list = (xs: string[]) => (xs.length ? `\n      ${xs.slice(0, 12).join("\n      ")}${xs.length > 12 ? `\n      ... and ${xs.length - 12} more` : ""}` : "");
  check(bad.length === 0 && measured >= combos.length * 2, `at ${widths.join(", ")} px, light and dark: the opened mobile menu does not scroll sideways and its theme control stays inside the gutter without clipping a word; the footer controls (shop, redesign) and the bottom bar panel fit (${measured} controls measured)`, `narrow widths (${measured} controls measured):${list(bad)}`);
  check(sweeps.length === 0, "the opened mobile menu passes the contrast sweep at 375 px in both themes", `contrast in the opened mobile menu:${list(sweeps)}`);
}

// The edge of every form field (input, select, textarea) on the page, as the eye gets it: the border painted over the field's own fill, against the
// surface behind the field (solid layers only: the page's faint glow is not included, which the margin of the palette covers). A string, like SWEEP.
const FIELDS_JS = String.raw`(() => {
  const parse = (s) => { const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s || ""); if (!m) return null; const a = m[4] === undefined ? 1 : (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])); return [+m[1], +m[2], +m[3], a]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const blend = (top, bottom) => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat([1]);
  const canvas = document.documentElement.classList.contains("dark") ? [18, 18, 18, 1] : [255, 255, 255, 1];
  const behind = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { stack.push(c); if (c[3] >= 0.999) break; } } let out = canvas; for (const c of stack.reverse()) out = blend(c, out); return out; };
  const describe = (e) => { let s = e.tagName.toLowerCase(); if (e.getAttribute("type")) s += "[" + e.getAttribute("type") + "]"; const n = e.getAttribute("name") || e.getAttribute("aria-label") || e.getAttribute("placeholder") || ""; return n ? s + " " + n.slice(0, 28) : s; };
  const out = [];
  for (const f of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=submit]):not([type=button]):not([type=image]):not([type=color]), textarea, select')) {
    const cs = getComputedStyle(f), r = f.getBoundingClientRect();
    if (cs.display === "none" || cs.visibility === "hidden" || r.width < 8 || r.height < 8 || f.disabled || f.closest("[hidden], [inert]")) continue;
    const outside = behind(f.parentElement);
    const own = parse(cs.backgroundColor);
    const fill = own && own[3] > 0 ? blend(own, outside) : outside;
    let edge = 0;
    for (const s of ["Top", "Right", "Bottom", "Left"]) {
      const w = parseFloat(cs["border" + s + "Width"]), c = parse(cs["border" + s + "Color"]);
      if (w >= 1 && cs["border" + s + "Style"] !== "none" && c && c[3] > 0) edge = Math.max(edge, ratio(blend(c, fill), outside));
    }
    const strip = f.closest(".chat-input, .code-search");
    const stripLine = !!strip && ["Top", "Bottom"].some((s) => parseFloat(getComputedStyle(strip)["border" + s + "Width"]) >= 1);
    out.push({ el: describe(f), edge: +edge.toFixed(2), fill: +ratio(fill, outside).toFixed(2), embedded: stripLine });
  }
  return out;
})()`;

// Focus every visible field in turn and report the ones that show no ring. The last input before the focus is a key press (Tab), so a
// script focus counts as keyboard focus (:focus-visible) in Chromium. A ring is an outline (style other than none, width above 0) or a box-shadow.
const FOCUS_JS = String.raw`(() => {
  const missing = [];
  const describe = (e) => { let s = e.tagName.toLowerCase(); if (e.getAttribute("type")) s += "[" + e.getAttribute("type") + "]"; const n = e.getAttribute("name") || e.getAttribute("aria-label") || e.getAttribute("placeholder") || ""; return n ? s + " " + n.slice(0, 28) : s; };
  for (const f of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=submit]):not([type=button]):not([type=image]):not([type=color]), textarea, select')) {
    const rest = getComputedStyle(f), r = f.getBoundingClientRect();
    if (rest.display === "none" || rest.visibility === "hidden" || r.width < 8 || r.height < 8 || f.disabled || f.closest("[hidden], [inert]")) continue;
    f.focus({ preventScroll: true });
    if (document.activeElement !== f) continue;
    const cs = getComputedStyle(f);
    const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
    const shadow = cs.boxShadow !== "none" && cs.boxShadow !== rest.boxShadow;
    if (!outline && !shadow) missing.push(describe(f));
    f.blur();
  }
  return missing;
})()`;

/**
 * j  Form-field boundaries (WCAG 1.4.11, contrast of the parts of a control that identify it, 3:1). The text sweep never looked at
 * non-text contrast, and the redesign palette's hairline (1.2 to 1.3:1) was the edge of every field on /retour/start and the tools.
 * Every visible field of the pages below, in both themes, must be told apart from the surface behind it by its edge or its fill at 3:1.
 * The one allowed exception, named: the chat and code-search fields of the redesign pages have no edge of their own; they sit in a strip
 * with a hairline of its own, next to their button, and are named by their placeholder (the strip is checked to carry that line).
 */
async function fieldChecks(browser: any, base: string) {
  const pagesWithFields = ["/", "/diagnose", "/onderdelen", "/foutcodes", "/contact", "/retour/start", "/tools/garantie-check", "/tools/predictive", "/tools/qr-sticker", "/tools/repareren-of-vervangen", "/blog", ...(FULL ? ["/help", "/klachten", "/monteur", "/api-info", "/upgrade", "/gidsen"] : [])];
  note(`j  form-field boundaries reach 3:1 against the surface behind (non-text contrast), ${pagesWithFields.length} pages, light and dark`);
  const bad: string[] = [];
  const noRing: string[] = [];
  let fields = 0, byEdge = 0, byFill = 0, embedded = 0;
  const embeddedNames: string[] = [];
  await pool(["light", "dark"] as Array<"light" | "dark">, async (theme) => {
    const ctx = await context(browser, { width: 1280, theme, base });
    const page = await ctx.newPage();
    for (const path of pagesWithFields) {
      await page.goto(base + path, { waitUntil: "load" });
      await settle(page);
      await page.keyboard.press("Tab");
      const list: Array<{ el: string; edge: number; fill: number; embedded: boolean }> = await page.evaluate(FIELDS_JS);
      // A keyboard user needs to see which field has the focus: the field, once focused, must draw an outline or a shadow.
      // (Inline `outline: none` on the return form's fields did exactly the opposite, in both themes.)
      for (const el of await page.evaluate(FOCUS_JS)) noRing.push(`${path} ${theme}: ${el}`);
      for (const f of list) {
        fields++;
        if (f.edge >= 3) byEdge++;
        else if (f.fill >= 3) byFill++;
        else if (f.embedded) { embedded++; if (!embeddedNames.includes(f.el)) embeddedNames.push(f.el); }
        else bad.push(`${path} ${theme}: ${f.el} edge ${f.edge}:1, fill ${f.fill}:1 against the surface behind (needs 3:1)`);
      }
    }
    await ctx.close();
  }, 2);
  const list = (xs: string[]) => (xs.length ? `\n      ${xs.slice(0, 12).join("\n      ")}${xs.length > 12 ? `\n      ... and ${xs.length - 12} more` : ""}` : "");
  console.log(`   ${fields} fields: ${byEdge} told apart by their edge, ${byFill} by their fill, ${embedded} allowed (in a bordered strip: ${embeddedNames.join(", ") || "none"})`);
  check(bad.length === 0 && fields >= 20, `every form field (${fields} measured on ${pagesWithFields.length} pages in both themes) is told apart from its surface at 3:1 by its edge or fill; only the strip-embedded chat/search fields rely on their strip`, `field boundaries (${fields} fields measured, at least 20 expected):${list(bad)}`);
  check(noRing.length === 0, `every form field draws a focus ring (an outline or a shadow) when it has the focus, on ${pagesWithFields.length} pages in both themes`, `fields without a visible focus ring:${list(noRing)}`);
}

/**
 * d0  The pixel verifier measures what it photographs, even when the page moves between reading an element and photographing it (the
 * home page's chat demo does exactly that for its first five seconds). The test page shifts its layout the moment the verifier hides
 * the element, once: a verifier that trusts its first photograph looks at the wrong place (white, behind light text: 1.1:1) and
 * reports a failure that is not there; the real one reads the box again after the photograph, sees it moved, and measures again.
 */
async function pixelVerifierSelfTest(browser: any) {
  note("d0 the pixel verifier survives a layout shift between reading an element and photographing it");
  const ctx = await browser.newContext({ viewport: { width: 600, height: 400 }, colorScheme: "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.setContent('<body style="margin:0;background:#fff"><div id="host"></div><svg width="300" height="100" style="display:block"><rect width="300" height="100" fill="#0e1a33"/><text id="t" data-qa-sweep="0" x="10" y="60" font-size="28" fill="#e6f1ff">ERROR</text></svg></body>');
  await page.evaluate(`(() => { const t = document.getElementById("t"); let done = false; new MutationObserver(() => { if (!done && t.style.visibility === "hidden") { done = true; document.getElementById("host").style.cssText = "height:200px;background:#fff"; } }).observe(t, { attributes: true, attributeFilter: ["style"] }); })()`);
  const failures: string[] = [];
  const r = await verifyByPixels(page, [{ idx: 0, sel: "text#t", text: "ERROR", need: 4.5, kind: "svg text", x: 10, y: 30, w: 80, h: 30, fgs: [[230, 241, 255, 1]] }], "self-test", failures);
  const shifted = await page.evaluate(() => document.getElementById("host")!.style.height === "200px");
  check(shifted && r.verified === 1 && failures.length === 0, "light text on a dark SVG rectangle is measured on the dark rectangle although the page shifted under the first photograph", `the pixel verifier: shifted ${shifted}, verified ${r.verified}, ${failures.join(" | ") || "no failure reported"}`);
  await ctx.close();
}

async function overlayChecks(browser: any, base: string) {
  note("i  overlays are legible in both themes: cookie banner, toggle panel, search, cart drawer, exit-intent, mobile bottom bar");
  for (const theme of ["light", "dark"] as const) {
    const fails: string[] = [];
    const run = async (label: string, page: any) => {
      const r = await sweepPage(page, `${theme} ${label}`);
      if (r.failures.length) fails.push(...r.failures.slice(0, 3));
      return r.checked;
    };
    // cookie banner (no consent cookie)
    const ctx = await context(browser, { theme, base, consent: false });
    const page = await ctx.newPage();
    await page.goto(base + "/onderdelen", { waitUntil: "load" });
    await page.waitForSelector('[role="dialog"][aria-labelledby="consent-title"]', { timeout: 5000 }).catch(() => undefined);
    const bannerUp = (await page.locator('[role="dialog"][aria-labelledby="consent-title"]').count()) > 0;
    if (!bannerUp) fails.push("the cookie banner did not appear");
    else {
      const bg = await page.evaluate(() => getComputedStyle(document.querySelector('[role="dialog"][aria-labelledby="consent-title"]')!).backgroundColor);
      const m = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(bg)!;
      const l = lum([+m[1], +m[2], +m[3]]);
      if ((theme === "light") !== (l > 0.5)) fails.push(`cookie banner background ${bg} is not ${theme}`);
      await page.locator('[role="dialog"][aria-labelledby="consent-title"] button', { hasText: "Aanpassen" }).click();
      await run("cookie banner (expanded)", page);
    }
    await ctx.close();
    // the rest with consent given
    const ctx2 = await context(browser, { theme, base });
    const p2 = await ctx2.newPage();
    await p2.goto(base + "/onderdelen", { waitUntil: "load" });
    await settle(p2);
    // toggle panel
    await p2.locator("[data-theme-trigger]:visible").first().click();
    await run("toggle panel", p2);
    await p2.keyboard.press("Escape");
    // search
    await p2.evaluate(() => window.dispatchEvent(new Event("wasfix-open-search")));
    await p2.waitForTimeout(200);
    await p2.keyboard.type("bosch");
    await p2.waitForTimeout(900);
    const modalBg = await p2.evaluate(() => { const el = document.querySelector('div[style*="z-index: 9000"] > div') as HTMLElement | null; return el ? getComputedStyle(el).backgroundColor : null; });
    if (!modalBg || /rgba\(0, 0, 0, 0\)|transparent/.test(modalBg)) fails.push(`search modal has no background (${modalBg})`);
    await run("search modal", p2);
    await p2.keyboard.press("Escape");
    // cart drawer with one item
    const add = p2.locator("button", { hasText: "In winkelmand" }).first();
    if (await add.count()) {
      await add.click();
      await p2.waitForSelector("[data-sonner-toast]", { timeout: 4000 }).catch(() => undefined);
      await p2.waitForTimeout(500);
      const toast = await p2.evaluate(() => { const t = document.querySelector("[data-sonner-toast]") as HTMLElement | null; return t ? getComputedStyle(t).backgroundColor : null; });
      const m = toast ? /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(toast) : null;
      if (!m) fails.push("no toast appeared after adding to the cart");
      else if ((theme === "light") !== (lum([+m[1], +m[2], +m[3]]) > 0.5)) fails.push(`the toast is ${toast}: not a ${theme} surface (sonner is not following the tokens)`);
      else {
        // A toast stays up for four seconds: it must not sit over the header, where the theme toggle, the cart and the account buttons are.
        const geo = await p2.evaluate(() => {
          const t = document.querySelector("[data-sonner-toast]")!.getBoundingClientRect();
          const h = document.querySelector("header, nav.nav")!.getBoundingClientRect();
          return { toastTop: Math.round(t.top), headerBottom: Math.round(h.bottom) };
        });
        if (geo.toastTop < geo.headerBottom) fails.push(`the toast starts at ${geo.toastTop}px, inside the header (which ends at ${geo.headerBottom}px) and over its buttons`);
        await run("toast", p2);
      }
    }
    await p2.locator('header button[aria-label^="Winkelmand openen"]').first().click({ timeout: 4000 }).catch(() => undefined);
    await p2.waitForSelector('[role="dialog"]', { timeout: 4000 }).catch(() => undefined);
    if ((await p2.locator('[role="dialog"]').count()) > 0) await run("cart drawer", p2); else fails.push("the cart drawer did not open");
    await p2.keyboard.press("Escape");
    await p2.waitForTimeout(200);
    await ctx2.close();
    // exit-intent: a clean visit of its own (an earlier visit in the same tab may already have used the once-per-session offer)
    const ctxE = await context(browser, { theme, base });
    const pE = await ctxE.newPage();
    await pE.goto(base + "/", { waitUntil: "load" });
    await settle(pE);
    await pE.evaluate(() => document.dispatchEvent(new MouseEvent("mouseleave", { clientY: -5, bubbles: true })));
    await pE.waitForSelector('[role="dialog"][aria-label*="cheatsheet"]', { timeout: 3000 }).catch(() => undefined);
    if ((await pE.locator('[role="dialog"][aria-label*="cheatsheet"]').count()) > 0) {
      await run("exit-intent modal", pE);
      // The e-mail field of the offer must show the keyboard focus (it had an inline `outline: none` and no replacement).
      const ring = await pE.evaluate(() => {
        const field = document.querySelector('[role="dialog"][aria-label*="cheatsheet"] input[type="email"]') as HTMLInputElement | null;
        if (!field) return "the e-mail field was not found";
        field.focus();
        const cs = getComputedStyle(field);
        return cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 ? "" : `no focus ring (outline ${cs.outlineStyle} ${cs.outlineWidth})`;
      });
      if (ring) fails.push(`exit-intent modal e-mail field: ${ring}`);
    } else note(`exit-intent modal did not open in ${theme} (feature flag off?)`);
    await ctxE.close();
    // the cookie banner on a phone: every button shows its whole label (it used to clip "Mijn keuze opslaan")
    const ctxB = await context(browser, { theme, base, width: 375, consent: false });
    const pB = await ctxB.newPage();
    await pB.goto(base + "/onderdelen", { waitUntil: "load" });
    await pB.waitForSelector('[role="dialog"][aria-labelledby="consent-title"]', { timeout: 5000 }).catch(() => undefined);
    await pB.locator('[role="dialog"][aria-labelledby="consent-title"] button', { hasText: "Aanpassen" }).click({ timeout: 4000 }).catch(() => undefined);
    const clipped: string[] = await pB.evaluate(() => [...document.querySelectorAll('[role="dialog"][aria-labelledby="consent-title"] button')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => (b.textContent || "").trim()));
    if ((await pB.locator('[role="dialog"][aria-labelledby="consent-title"]').count()) === 0) fails.push("the cookie banner did not appear at 375 px");
    else if (clipped.length) fails.push(`cookie banner buttons clip their label at 375 px: ${clipped.join(", ")}`);
    await ctxB.close();
    // bottom bar open panel, at 375
    const ctx3 = await context(browser, { theme, base, width: 375 });
    const p3 = await ctx3.newPage();
    await p3.goto(base + "/onderdelen", { waitUntil: "load" });
    await settle(p3);
    await p3.locator('nav[aria-label="Mobiele navigatie"] [data-theme-trigger]').click();
    await run("bottom bar + theme panel (375)", p3);
    await ctx3.close();
    // The bottom bar on a redesign page wears that page's palette. It sits outside the page's scope, so wasfix-design.css writes the
    // six colours out once per palette; they must equal the scope's own variables, and the bar must really paint with them.
    const ctx4 = await context(browser, { theme, base, width: 375 });
    const p4 = await ctx4.newPage();
    await p4.goto(base + "/diagnose", { waitUntil: "load" });
    await settle(p4);
    const bar = await p4.evaluate(String.raw`(() => {
      const norm = (v) => { const probe = document.createElement("i"); probe.style.color = v.trim(); document.body.append(probe); const c = getComputedStyle(probe).color; probe.remove(); return c; };
      const rgb = (c) => (/(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(c) || []).slice(1, 4).join(",");
      const scope = document.querySelector(".wasfix-design");
      const bar = document.querySelector('nav[aria-label="Mobiele navigatie"]');
      if (!scope || !bar) return { missing: true };
      const sv = (n) => getComputedStyle(scope).getPropertyValue(n);
      const bv = (n) => getComputedStyle(bar).getPropertyValue(n);
      const pairs = [["--mbn-bg", "--nav-bg"], ["--mbn-border", "--line"], ["--mbn-fg", "--text-2"], ["--mbn-active", "--acc"], ["--mbn-badge-bg", "--acc-solid"], ["--mbn-badge-fg", "--on-acc"]];
      const off = pairs.filter(([b, s]) => rgb(norm(bv(b))) !== rgb(norm(sv(s)))).map(([b, s]) => b + " " + rgb(norm(bv(b))) + " (page: " + s + " " + rgb(norm(sv(s))) + ")");
      return { off, used: rgb(getComputedStyle(bar).backgroundColor) === rgb(norm(bv("--mbn-bg"))) };
    })()`);
    if (bar.missing) fails.push("the bottom bar or the redesign scope is missing on /diagnose at 375 px");
    else if (bar.off.length || !bar.used) fails.push(`the bottom bar on /diagnose does not wear the page's palette: ${bar.off.join("; ") || "its background is not --mbn-bg"}`);
    await run("bottom bar on a redesign page (375)", p4);
    await ctx4.close();
    check(fails.length === 0, `${theme}: the cookie banner, toggle panel, search, cart drawer, exit-intent modal and bottom bar are legible (and the banner and search are surfaces of this theme), the toast clears the header, the banner buttons fit at 375 px`, `${theme} overlays: ${fails.join(" | ")}`);
  }
  // The home page's washing machine: the label of a hovered part must lie inside the drawing (it used to hang 124 to 180 units
  // outside the viewBox, and the browser cut it off).
  const mctx = await context(browser, { theme: "light", base });
  const mp = await mctx.newPage();
  await mp.goto(base + "/", { waitUntil: "load" });
  await settle(mp);
  const hot = mp.locator(".machine-wrap svg g[style*='cursor']");
  const n = await hot.count();
  const outside: string[] = [];
  for (let i = 0; i < n; i++) {
    await hot.nth(i).scrollIntoViewIfNeeded();
    const box = await hot.nth(i).locator("circle").first().boundingBox();
    if (!box) continue;
    await mp.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await mp.waitForTimeout(80);
    const r = await mp.evaluate(() => {
      const svg = document.querySelector(".machine-wrap svg")!.getBoundingClientRect();
      const tag = document.querySelector('.machine-wrap svg g[pointer-events="none"] rect')?.getBoundingClientRect();
      return tag ? { left: tag.left - svg.left, right: svg.right - tag.right, top: tag.top - svg.top, bottom: svg.bottom - tag.bottom } : null;
    });
    if (!r) outside.push(`part ${i + 1}: no label`);
    else if (Math.min(r.left, r.right, r.top, r.bottom) < -0.5) outside.push(`part ${i + 1}: label ${JSON.stringify(r)}`);
  }
  check(n >= 8 && outside.length === 0, `the home page machine: the label of each of its ${n} parts lies inside the drawing`, `machine labels outside the drawing (${n} parts found): ${outside.join("; ")}`);
  await mctx.close();
}

/**
 * k  Two ways the browser can hand the app something it did not expect, both of which took every page down before this check:
 *  - the stored theme is not one of light, dark, system. next-themes copies the raw string onto <html> with classList.add(), which throws
 *    on whitespace (" dark"); the throw sat in an effect, so the global error page answered on every page and again after every
 *    reload, until the visitor cleared site data. layout.tsx now removes such a value before the provider reads it;
 *  - web storage refuses to answer (site data blocked, some private windows): any unguarded getItem threw inside an effect. The exit-intent
 *    offer, mounted on the home page and the part list, was one.
 * The pages must show their own content in both cases (no "Er is iets misgegaan", an h1, light for a junk value) and raise no uncaught error.
 */
async function robustnessChecks(browser: any, base: string) {
  const junk = [" dark", "dark light", "a b", "banana", "DARK", "", "null"];
  const junkPaths = ["/", "/onderdelen"];
  const blockedPaths = ["/", "/onderdelen", "/diagnose", "/foutcodes", "/blog", "/prijzen", "/contact", "/checkout"];
  note(`k  ${junk.length} junk values of the stored theme on ${junkPaths.length} pages, and blocked web storage on ${blockedPaths.length} pages`);
  const bad: string[] = [];
  const state = (page: any) => page.evaluate(() => ({ crashed: /Er is iets misgegaan/.test(document.body?.innerText ?? ""), h1: document.querySelectorAll("h1").length, dark: document.documentElement.classList.contains("dark") }));
  const watch = (page: any, label: string) => {
    const seen: string[] = [];
    page.on("pageerror", (e: any) => seen.push(`pageerror: ${String(e).slice(0, 160)}`));
    page.on("console", (m: any) => { if (m.type() === "error" && /WasFix global error/.test(m.text())) seen.push(`console.error: ${m.text().slice(0, 160)}`); });
    return () => seen.map((x) => `${label}: ${x}`);
  };

  for (const value of junk) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light", reducedMotion: "reduce" });
    await relaxUpgradeInsecure(ctx, base);
    await ctx.addCookies([consentCookie(base)]);
    await ctx.addInitScript((v: string) => { try { localStorage.setItem("theme", v); } catch { /* no storage */ } }, value);
    for (const path of junkPaths) {
      const page = await ctx.newPage();
      const label = `theme ${JSON.stringify(value)} on ${path}`;
      const errors = watch(page, label);
      await page.goto(base + path, { waitUntil: "load" });
      await page.waitForTimeout(600);
      const st = await state(page);
      const stored = await page.evaluate(() => localStorage.getItem("theme"));
      if (st.crashed) bad.push(`${label}: the global error page ("Er is iets misgegaan") instead of the page`);
      else if (st.h1 === 0) bad.push(`${label}: no h1`);
      if (st.dark) bad.push(`${label}: the page is dark although the stored value is junk (light is the default)`);
      if (stored !== null) bad.push(`${label}: the junk value is still stored (${JSON.stringify(stored)})`);
      bad.push(...errors());
      await page.close();
    }
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light", reducedMotion: "reduce" });
  await relaxUpgradeInsecure(ctx, base);
  await ctx.addCookies([consentCookie(base)]);
  await ctx.addInitScript(() => {
    for (const key of ["localStorage", "sessionStorage"]) {
      Object.defineProperty(window, key, { configurable: true, get() { throw new DOMException("The operation is insecure.", "SecurityError"); } });
    }
  });
  for (const path of blockedPaths) {
    const page = await ctx.newPage();
    const label = `blocked storage on ${path}`;
    const errors = watch(page, label);
    await page.goto(base + path, { waitUntil: "load" });
    await page.waitForTimeout(600);
    const st = await state(page);
    if (st.crashed) bad.push(`${label}: the global error page ("Er is iets misgegaan") instead of the page`);
    else if (st.h1 === 0) bad.push(`${label}: no h1`);
    if (st.dark) bad.push(`${label}: dark without any stored choice`);
    bad.push(...errors());
    await page.close();
  }
  await ctx.close();
  const list = (xs: string[]) => (xs.length ? `\n      ${xs.slice(0, 12).join("\n      ")}${xs.length > 12 ? `\n      ... and ${xs.length - 12} more` : ""}` : "");
  check(bad.length === 0, `a junk stored theme (${junk.length} values) leaves the pages and the light default intact, and blocked web storage does not take ${blockedPaths.length} pages down`, `robustness:${list(bad)}`);
}

// ───────────────────────────── documents ─────────────────────────────
async function documentChecks(browser: any, base: string) {
  note("f  documents print light: invoice, credit note, packing slip, pick list, work-order invoice under emulated print media with .dark set");
  if (!process.env.DATABASE_URL) { skipOrFail("documents: DATABASE_URL is not set (they need an order to open)"); return; }
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const tag = `qa-theme-${Date.now()}`;
  const created: { orderId?: string; userId?: string; partId?: string; workOrderId?: string; profileId?: string } = {};
  try {
    const user = await prisma.user.create({ data: { email: `${tag}@qa-theme.test`, name: "QA Thema" } });
    created.userId = user.id;
    const part = await prisma.part.create({ data: { sku: `QA-THEME-${Date.now()}`, name: "Thema-testonderdeel", brand: "QA", category: "OTHER", priceEur: 12.1, stock: 50 } });
    created.partId = part.id;
    const token = `qa-theme-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const order = await prisma.order.create({
      data: {
        userId: user.id, email: `${tag}@qa-theme.test`, status: "PAID", paymentMethod: "STRIPE", subtotalEur: 24.2, shippingEur: 0, totalEur: 24.2, vatRate: 0.21, vatEur: 4.2, accessToken: token,
        shippingAddress: JSON.stringify({ name: "Piet Jansen", street: "Teststraat", houseNumber: "1", postalCode: "1011 AB", city: "Amsterdam" }), paidAt: new Date(),
        items: { create: [{ partId: part.id, quantity: 2, unitPrice: 12.1 }] },
      },
    });
    created.orderId = order.id;
    const seller = { name: "WasFix QA B.V.", street: "Teststraat 1", postalCode: "1011 AB", city: "Amsterdam", country: "NL", kvk: "90000001", vatNumber: "NL900000010B01", iban: "NL02ABNA0123456789" };
    const lines = [{ sku: part.sku, name: part.name, quantity: 2, unitPriceEur: 12.1, lineTotalEur: 24.2 }];
    const invoice = await prisma.invoice.create({ data: { number: `QA-THEME-${Date.now()}`, year: 2999, orderId: order.id, subtotalEur: 20, vatRate: 0.21, vatEur: 4.2, totalEur: 24.2, sellerJson: JSON.stringify(seller), buyerJson: JSON.stringify({ name: "Piet Jansen", city: "Amsterdam" }), linesJson: JSON.stringify(lines) } });
    const note1 = await prisma.creditNote.create({ data: { number: `QA-THEME-CN-${Date.now()}`, year: 2999, invoiceId: invoice.id, reason: "QA", subtotalEur: 10, vatRate: 0.21, vatEur: 2.1, totalEur: 12.1, sellerJson: JSON.stringify(seller), buyerJson: JSON.stringify({ name: "Piet Jansen" }), linesJson: JSON.stringify([{ ...lines[0], quantity: 1, lineTotalEur: 12.1 }]) } });

    const docs: Array<{ name: string; url: string }> = [
      { name: "invoice", url: `${base}/bestelling/${order.id}/factuur?t=${token}` },
      { name: "credit note", url: `${base}/bestelling/${order.id}/creditnota/${encodeURIComponent(note1.number)}?t=${token}` },
    ];
    if (DEMO) {
      docs.push({ name: "packing slip", url: `${DEMO}/admin/bestellingen/${order.id}/pakbon` }, { name: "pick list", url: `${DEMO}/admin/bestellingen/pick` });
      const owner = await prisma.user.findFirst({ where: { email: { in: ["jdahoe@hotmail.nl", "demo@wasfixpro.nl"] } } });
      if (owner) {
        const hadProfile = await prisma.monteurProfile.findUnique({ where: { userId: owner.id } });
        if (!hadProfile) created.profileId = (await prisma.monteurProfile.create({ data: { userId: owner.id, companyName: "QA Monteur", kvkNumber: "90000002", vatNumber: "NL900000020B01", street: "Werkstraat 2", postalCode: "1011 AB", city: "Amsterdam" } })).id;
        const wo = await prisma.workOrder.create({ data: { ownerId: owner.id, reference: `QA-THEME-${Date.now()}`, problem: "QA", priceEur: 60 } });
        created.workOrderId = wo.id;
        docs.push({ name: "work-order invoice", url: `${DEMO}/monteur/werkorders/${wo.id}/factuur` });
      } else note("SKIPPED work-order invoice: no demo owner row in the database");
    } else note("SKIPPED packing slip, pick list and work-order invoice: QA_DEMO_URL is not set (they need a server started with DEMO_MODE=true)");

    for (const d of docs) {
      const bad: string[] = [];
      for (const theme of ["dark", "light"]) {
        const origin = new URL(d.url).origin;
        const ctx = await context(browser, { theme, base: origin });
        const page = await ctx.newPage();
        await page.emulateMedia({ media: "print" });
        const resp = await page.goto(d.url, { waitUntil: "load" });
        if (!resp || resp.status() !== 200) { bad.push(`${theme}: status ${resp?.status()}`); await ctx.close(); continue; }
        const st = await page.evaluate(() => {
          const body = getComputedStyle(document.body);
          const doc = document.querySelector("article") ?? document.body;
          const h = document.querySelector("h1");
          return { dark: document.documentElement.classList.contains("dark"), scheme: getComputedStyle(document.documentElement).colorScheme, body: body.backgroundColor, article: getComputedStyle(doc).backgroundColor, ink: h ? getComputedStyle(h).color : null };
        });
        const white = (c: string) => { const m = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(c); return !!m && lum([+m[1], +m[2], +m[3]]) > 0.9; };
        const dark = (c: string | null) => { const m = c ? /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(c) : null; return !!m && lum([+m[1], +m[2], +m[3]]) < 0.2; };
        if (theme === "dark" && !st.dark) bad.push("the test did not set .dark");
        if (!white(st.body) || !white(st.article) || !dark(st.ink) || st.scheme !== "light") bad.push(`${theme}+print: body ${st.body}, document ${st.article}, heading ${st.ink}, color-scheme ${st.scheme}`);
        const r = await sweepPage(page, `${d.name} ${theme}+print`, { print: true });
        if (r.failures.length) bad.push(...r.failures.slice(0, 3));
        await ctx.close();
      }
      check(bad.length === 0, `${d.name}: prints white with dark ink and AA contrast with .dark set (and with light)`, `${d.name}: ${bad.join(" | ")}`);
    }
  } finally {
    const del = async (f: () => Promise<unknown>) => { try { await f(); } catch { /* already gone */ } };
    if (created.workOrderId) { await del(() => prisma.monteurInvoice.deleteMany({ where: { workOrderId: created.workOrderId } })); await del(() => prisma.workOrder.delete({ where: { id: created.workOrderId } })); }
    if (created.profileId) await del(() => prisma.monteurProfile.delete({ where: { id: created.profileId } }));
    if (created.orderId) { await del(() => prisma.creditNote.deleteMany({ where: { invoice: { orderId: created.orderId } } })); await del(() => prisma.invoice.deleteMany({ where: { orderId: created.orderId } })); await del(() => prisma.orderItem.deleteMany({ where: { orderId: created.orderId } })); await del(() => prisma.order.delete({ where: { id: created.orderId } })); }
    if (created.partId) await del(() => prisma.part.delete({ where: { id: created.partId } }));
    if (created.userId) await del(() => prisma.user.delete({ where: { id: created.userId } }));
    await prisma.$disconnect();
  }
}

// ───────────────────────────── dashboard + admin ─────────────────────────────
async function demoChecks(browser: any) {
  note("g  the toggle on a dashboard-layout page and an admin page (DEMO_MODE server)");
  if (!DEMO) { note("SKIPPED dashboard and admin: QA_DEMO_URL is not set (they need a server started with DEMO_MODE=true)"); return; }
  const targets = [{ name: "dashboard", path: "/dashboard" }, { name: "admin", path: "/admin" }, { name: "admin orders", path: "/admin/bestellingen" }, { name: "monteur", path: "/monteur/dashboard" }];
  const bad: string[] = [];
  const errors: string[] = [];
  const contrast: string[] = [];
  for (const t of targets) {
    for (const theme of ["light", "dark"] as const) {
      const ctx = await context(browser, { theme, base: DEMO });
      const page = await ctx.newPage();
      const col = collect(page);
      const resp = await page.goto(DEMO + t.path, { waitUntil: "load" });
      await settle(page);
      if (!resp || resp.status() !== 200) { bad.push(`${t.name}: status ${resp?.status()}`); await ctx.close(); continue; }
      if ((await page.locator('header [data-theme-toggle="menu"]:visible').count()) === 0) bad.push(`${t.name}: no toggle in the header`);
      if (theme === "light") {
        await chooseByKeyboard(page, "dark");
        if (!(await isDark(page))) bad.push(`${t.name}: Donker did not apply`);
        await page.goto(DEMO + t.path, { waitUntil: "domcontentloaded" });
        if (!(await isDark(page))) bad.push(`${t.name}: Donker did not survive a reload`);
        await settle(page);
        await chooseByMouse(page, "light");
        if (await isDark(page)) bad.push(`${t.name}: Licht did not apply`);
      } else {
        await page.waitForTimeout(600);
        const r = await sweepPage(page, `${t.name} dark`);
        if (r.failures.length) contrast.push(...r.failures.slice(0, 3));
        console.log(`   ${t.name.padEnd(16)} dark   1280px  ${String(r.checked).padStart(4)} text elements, ${r.failures.length} fail, ${r.bounded} proven by stops, ${r.pixel} measured on pixels`);
      }
      errors.push(...col.errors.map((e) => `${t.name}: ${e}`));
      await ctx.close();
    }
    const lctx = await context(browser, { theme: "light", base: DEMO });
    const lp = await lctx.newPage();
    await lp.goto(DEMO + t.path, { waitUntil: "load" });
    await lp.waitForTimeout(600);
    const r = await sweepPage(lp, `${t.name} light`);
    if (r.failures.length) contrast.push(...r.failures.slice(0, 3));
    console.log(`   ${t.name.padEnd(16)} light  1280px  ${String(r.checked).padStart(4)} text elements, ${r.failures.length} fail, ${r.bounded} proven by stops, ${r.pixel} measured on pixels`);
    await lctx.close();
    // On a phone these pages have no bottom bar (MobileBottomNav.tsx): the toggle must be in the header's menu.
    const mctx = await context(browser, { theme: "light", base: DEMO, width: 375 });
    const mp = await mctx.newPage();
    await mp.goto(DEMO + t.path, { waitUntil: "load" });
    await settle(mp);
    const bar = await mp.locator('nav[aria-label="Mobiele navigatie"]').count();
    const burger = mp.locator('header button[aria-label="Menu openen"]');
    if (bar === 0) {
      if ((await burger.count()) === 0) bad.push(`${t.name} (375): no bottom bar and no menu button`);
      else {
        await burger.click();
        if ((await mp.locator('header [data-theme-toggle="segmented"]:visible').count()) === 0) bad.push(`${t.name} (375): no toggle in the header menu, and no bottom bar`);
      }
    }
    await mctx.close();
  }
  // The private pages on a phone, in dark: nothing may stick out sideways. (The import panel of /admin/onderdelen listed its CSV
  // columns in one unbreakable <code> that ended at x=553 on a 375 px screen; the page itself never scrolled, so only the element shows it.)
  const phonePages = ["/dashboard", "/dashboard/api-keys", "/admin", "/admin/bestellingen", "/admin/onderdelen", "/admin/economie", "/admin/retouren", "/admin/aanvragen", "/monteur/dashboard", "/monteur/werkorders", "/monteur/onderdelen", "/monteur/instellingen"];
  const sideways: string[] = [];
  {
    const ctx = await context(browser, { theme: "dark", base: DEMO, width: 375 });
    const page = await ctx.newPage();
    for (const path of phonePages) {
      const resp = await page.goto(DEMO + path, { waitUntil: "load" });
      await settle(page);
      if (!resp || resp.status() !== 200) { sideways.push(`${path}: status ${resp?.status()}`); continue; }
      await waitStable(page, 250);
      const o = await page.evaluate(OVERFLOW_JS);
      const why: string[] = [];
      if (o.scroll > o.vw + 1) why.push(`scrollWidth ${o.scroll} > ${o.vw}`);
      if (o.offenders.length) why.push(`overflowing ${o.offenders.join(", ")}`);
      if (why.length) sideways.push(`${path}: ${why.join("; ")}`);
    }
    await ctx.close();
  }
  check(bad.length === 0, "dashboard, admin, admin orders and monteur pages: toggle in the header (the menu on a phone), keyboard Donker, reload, Licht", `dashboard/admin toggle: ${bad.join("; ")}`);
  check(sideways.length === 0, `${phonePages.length} dashboard, admin and monteur pages do not stick out sideways at 375 px in dark`, `sideways at 375 px in dark: ${sideways.join("; ")}`);
  check(errors.length === 0, "no console or page errors on those pages in either theme", `errors: ${errors.slice(0, 4).join("; ")}`);
  check(contrast.length === 0, "contrast: those pages pass the sweep in both themes", `contrast: ${contrast.join(" | ")}`);
}

// ───────────────────────────── the stand-alone error page ─────────────────────────────
async function globalErrorChecks(browser: any, base: string) {
  note("h  global-error.tsx (renders outside the layout, stylesheet and provider) honours the stored choice, client-rendered and server-rendered");
  let esbuild: { build: (o: unknown) => Promise<{ outputFiles: Array<{ text: string }> }> };
  try { esbuild = (await import("esbuild")) as never; } catch { skipOrFail("global-error: esbuild is not installed"); return; }
  const shared = { resolveDir: ROOT, loader: "tsx" as const };
  const common = { bundle: true, write: false, jsx: "automatic" as const, tsconfig: path.join(ROOT, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' } };
  const error = `const error = Object.assign(new Error("boom"), { digest: "qa123" });`;
  // Client-rendered: React builds the document in the browser (a script rendered there never runs; the effect applies the choice).
  const client = await esbuild.build({
    stdin: { ...shared, contents: `import React from "react"; import { createRoot } from "react-dom/client"; import GlobalError from "./src/app/global-error";
        ${error}
        createRoot(document as unknown as HTMLElement).render(React.createElement(GlobalError, { error, reset: () => undefined }));` },
    ...common, format: "iife", platform: "browser",
  });
  // Server-rendered: the document as a string, loaded into the page WITHOUT any React in it. Only the inline script can apply the choice.
  const server = await esbuild.build({
    stdin: { ...shared, contents: `import React from "react"; import { renderToString } from "react-dom/server"; import GlobalError from "./src/app/global-error";
        ${error}
        export const html = renderToString(React.createElement(GlobalError, { error, reset: () => undefined }));` },
    ...common, format: "cjs", platform: "node",
  });
  const mod: { exports: { html?: string } } = { exports: {} };
  new Function("module", "exports", "require", server.outputFiles[0].text)(mod, mod.exports, createRequire(`${ROOT}/`));
  const html = mod.exports.html ?? "";
  check(/<script>try\{var s=window\.localStorage\.getItem\("theme"\)/.test(html), "the server-rendered error document carries the inline theme script", `the server-rendered error document has no inline theme script (${html.slice(0, 160)})`);
  const clientCode = client.outputFiles[0].text;
  const cases: Array<{ name: string; stored: string | null; os: "light" | "dark"; dark: boolean }> = [
    { name: "nothing stored, OS dark", stored: null, os: "dark", dark: false },
    { name: "stored light, OS dark", stored: "light", os: "dark", dark: false },
    { name: "stored dark, OS light", stored: "dark", os: "light", dark: true },
    { name: "stored system, OS dark", stored: "system", os: "dark", dark: true },
    { name: "stored system, OS light", stored: "system", os: "light", dark: false },
  ];
  for (const mode of ["client", "server"] as const) {
    const bad: string[] = [];
    for (const c of cases) {
      const ctx = await browser.newContext({ colorScheme: c.os });
      const page = await ctx.newPage();
      await page.goto(`${base}/robots.txt`);
      await page.evaluate((s: string | null) => { if (s) localStorage.setItem("theme", s); else localStorage.removeItem("theme"); }, c.stored);
      if (mode === "client") await page.addScriptTag({ content: clientCode });
      else await page.setContent(html);
      await page.waitForSelector("button", { timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(250);
      const st = await page.evaluate(() => ({ dark: document.documentElement.classList.contains("dark"), scheme: getComputedStyle(document.documentElement).colorScheme, bg: getComputedStyle(document.body).backgroundColor, text: document.body.textContent ?? "" }));
      const want = hex(parseColour(c.dark ? STANDALONE_PALETTE.dark.background : STANDALONE_PALETTE.light.background));
      const m = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(st.bg);
      const got = m ? hex([+m[1], +m[2], +m[3]]) : st.bg;
      if (st.dark !== c.dark || got !== want || !/Er is iets misgegaan/.test(st.text) || !/qa123/.test(st.text)) bad.push(`${c.name}: dark=${st.dark} (want ${c.dark}), background ${got} (want ${want}), text ok ${/Er is iets misgegaan/.test(st.text)}`);
      await ctx.close();
    }
    check(bad.length === 0, `the error page (${mode}-rendered) is light by default, follows a stored Donker, and follows the OS only for a stored Systeem`, `global-error (${mode}-rendered): ${bad.join("; ")}`);
  }
}

async function main() {
  staticChecks();
  await tailwindVariantCheck();
  if (!BASE) {
    skipOrFail("browser checks a-i: QA_BASE_URL is not set (a production server)");
  } else {
    const pw = loadPlaywright();
    if (!pw) {
      skipOrFail("browser checks: Playwright is not installed");
    } else {
      const started = Date.now();
      await browserChecks(pw);
      console.log(`   browser checks took ${Math.round((Date.now() - started) / 1000)} s`);
    }
  }
  process.exit(finish());
}
main().catch((e) => { console.error(e); process.exit(1); });
