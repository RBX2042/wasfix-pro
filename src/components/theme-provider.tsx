"use client";
import * as React from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useServerInsertedHTML } from "next/navigation";
import { EARLY_THEME_SCRIPT, THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "./theme-colors";

/**
 * Theme provider (decision D22).
 *
 *  - LIGHT is the default. defaultTheme="light" is what next-themes' inline script falls back to when
 *    localStorage has no "theme" entry, whatever the operating system prefers (verified in
 *    node_modules/next-themes: the script reads `localStorage.getItem(key) || defaultTheme` and only
 *    consults prefers-color-scheme when the stored or default value is the string "system"). Without the
 *    prop the library's own default is "system", which would make a visitor with a dark phone see a dark
 *    site on a first visit they never asked for.
 *  - "system" stays selectable (enableSystem): it is the third choice of the toggle, "Systeem".
 *  - The choice lives in localStorage under "theme" (functional, no consent needed: /cookies lists it) and
 *    is written as a class on <html> BEFORE the first paint by next-themes' inline script, so there is no
 *    flash of the wrong theme. The provider is rendered inside <body> by app/layout.tsx. It also puts
 *    EARLY_THEME_SCRIPT into <head> (EarlyThemeScript below): ahead of every frame, and the only theme script that
 *    reaches Next's client-rendered 404 shell.
 *  - disableTransitionOnChange: the switch repaints in one frame instead of fading half the page.
 */
const DEFAULTS: Partial<React.ComponentProps<typeof NextThemesProvider>> = {
  attribute: "class",
  defaultTheme: "light",
  enableSystem: true,
  disableTransitionOnChange: true,
  storageKey: "theme",
};

/**
 * Puts EARLY_THEME_SCRIPT (theme-colors.ts) into <head>, once per document, through useServerInsertedHTML (on the client
 * the hook does nothing). Why <head> and why this way, both measured on a production build in Chromium (D22, 2026-11-19):
 *
 *  - The page-level 404 of a dynamic route (notFound() in /onderdelen/[sku], /blog/[slug], /bestelling/[id] ...) is a
 *    document the server does NOT render through app/layout.tsx. React's server renderer has no error boundaries, so the
 *    notFound() thrown by the page reaches the top of the HTML render and Next 15.5 answers with a "shell":
 *    `<html id="__next_error__"><head>(the 404's metadata)</head><body></body></html>` plus the page's data, and the browser
 *    builds the whole document with React (node_modules/next/dist/server/app-render/app-render.js, getErrorRSCPayload;
 *    client/app-index.js, the `__next_error__` branch). No inline script of the layout runs there (a <script> React creates
 *    in the browser never executes). What Next does carry into that shell is the HTML registered with
 *    useServerInsertedHTML during the failed render (the catch branch flushes the same renderServerInsertedHTML), and this
 *    provider has rendered by then: the page throws below it. Without the script a visitor with Donker stored saw the white
 *    canvas of the shell (its <head> says color-scheme light), on a light and on a dark OS, in every load.
 *  - On a page the server rendered, the layout's two scripts sit in <body>, behind the stylesheet: when it finished loading
 *    Chromium could paint the empty body in the light background before they ran (an empty cream frame in about 1 of 6 loads
 *    with Donker stored). A script in <head> runs before <body> exists, and no frame was seen before that (measured with
 *    Chromium's screencast, not read in its source; b2 checks the class is on <html> before <body> exists).
 *
 * The layout's guard and next-themes' own script still run on server-rendered pages and find the same state. At the commit
 * of the shell React removes every attribute of <html> (react-dom, commitHostSingletonAcquisition) and next-themes puts
 * the class back in its effect, which runs in the same task (measured: no frame in between). What stays: with JavaScript
 * off nothing applies a stored choice, and the shell 404 has no body at all. scripts/qa-theme.ts: S6 runs the script,
 * b2 and b4 check that the stored theme is on <html> before <body> exists and that no frame of the other theme is painted,
 * k the junk values.
 */
function EarlyThemeScript() {
  const sent = React.useRef(false);
  useServerInsertedHTML(() => {
    // Called on every flush of the HTML stream: the script belongs in the first one only (that one goes into <head>).
    if (sent.current) return null;
    sent.current = true;
    return <script dangerouslySetInnerHTML={{ __html: EARLY_THEME_SCRIPT }} />;
  });
  return null;
}

export function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider {...DEFAULTS} {...props}>
      <EarlyThemeScript />
      <ThemeColorSync />
      {children}
    </NextThemesProvider>
  );
}

/**
 * Keeps <meta name="theme-color"> (the colour of the browser bar on a phone) in step with the theme that is
 * actually showing.
 *
 * The limitation this works around: the `viewport` export of app/layout.tsx can only emit one tag per
 * prefers-color-scheme media query, and a class-based switch is invisible to that query. A visitor whose
 * phone is dark but who chose Licht would get the dark bar over a light page. So once the page is hydrated
 * this effect writes the colour of the resolved theme into EVERY theme-color tag (both media variants), which
 * is correct whatever the phone prefers. What it cannot fix: before hydration, and with JavaScript off, the
 * tags still follow the phone's preference, not the stored choice.
 *
 * Client-side navigation: Next re-renders the viewport tags on every route change and puts the server's
 * values (the phone's preference) back, while resolvedTheme does not change, so an effect that only depends
 * on the theme never runs again. An observer on <head> re-applies the colour whenever a theme-color tag is
 * added or its content changes. It only writes when the value differs, so it cannot loop on its own edit.
 */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  React.useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    const color = resolvedTheme === "dark" ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
    const tagsOf = () => Array.from(document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
    const apply = () => {
      for (const tag of tagsOf()) if (tag.getAttribute("content") !== color) tag.setAttribute("content", color);
    };
    if (tagsOf().length === 0) {
      const created = document.createElement("meta");
      created.name = "theme-color";
      document.head.appendChild(created);
    }
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["content", "name"] });
    return () => observer.disconnect();
  }, [resolvedTheme]);
  return null;
}
