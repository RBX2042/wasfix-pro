"use client";
import * as React from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "./theme-colors";

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
 *    flash of the wrong theme. The provider is rendered inside <body> by app/layout.tsx.
 *  - disableTransitionOnChange: the switch repaints in one frame instead of fading half the page.
 */
const DEFAULTS: Partial<React.ComponentProps<typeof NextThemesProvider>> = {
  attribute: "class",
  defaultTheme: "light",
  enableSystem: true,
  disableTransitionOnChange: true,
  storageKey: "theme",
};

export function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider {...DEFAULTS} {...props}>
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
