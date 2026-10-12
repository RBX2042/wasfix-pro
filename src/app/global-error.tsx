"use client";

import * as React from "react";
import { reportClientError } from "@/lib/report-client-error";
import { STANDALONE_PALETTE as P } from "@/components/theme-colors";

// Replaces the whole document when the root layout itself fails, so it cannot use
// the site shell. Same rules as error.tsx: calm text and a code for the visitor,
// the cause goes to the owner (server errors via src/instrumentation.ts, browser
// errors via reportClientError).
//
// Theme (decision D22). This page renders OUTSIDE the root layout: no stylesheet, no ThemeProvider. So it
// carries its own two palettes (the values of the app's tokens, see STANDALONE_PALETTE) and applies the
// visitor's choice itself, from the same localStorage key the provider writes: "light" and "dark" are taken
// as they are, "system" follows prefers-color-scheme, and no stored choice means LIGHT, exactly like the
// rest of the site. Two paths, because the document can be built in two places: when the error happens in
// the browser React renders it on the client, and a <script> rendered on the client never runs, so an effect
// applies the choice (a short light flash is possible there); when React renders it on the server the
// document is part of the HTML response, and the inline script below runs before the first paint, so a
// visitor who chose Donker does not see a light page first. Both do the same thing; scripts/qa-theme.ts (part h)
// runs each of them in a browser with the same five cases.
const CSS = `
  :root { color-scheme: light; --bg: ${P.light.background}; --fg: ${P.light.foreground}; --muted: ${P.light.muted}; --button: ${P.light.button}; --button-text: ${P.light.buttonText}; }
  html.dark { color-scheme: dark; --bg: ${P.dark.background}; --fg: ${P.dark.foreground}; --muted: ${P.dark.muted}; --button: ${P.dark.button}; --button-text: ${P.dark.buttonText}; }
  body { margin: 0; padding: 2rem; text-align: center; font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); }
  h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
  p { margin: 0 0 1rem; color: var(--muted); }
  p.code { font-size: 0.75rem; }
  button { background: var(--button); color: var(--button-text); padding: 0.5rem 1rem; border: none; border-radius: 0.375rem; cursor: pointer; font: inherit; min-height: 44px; }
  button:focus-visible { outline: 2px solid var(--button); outline-offset: 2px; }
`;

// The inline-script form of applyStoredTheme below (CSP allows inline scripts: src/lib/csp.ts, script-src).
const THEME_SCRIPT = `try{var s=window.localStorage.getItem("theme");var d=s==="dark"||(s==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var h=document.documentElement;h.classList.toggle("dark",d);h.style.colorScheme=d?"dark":"light"}catch(e){}`;

function applyStoredTheme() {
  try {
    const stored = window.localStorage.getItem("theme");
    const dark = stored === "dark" || (stored === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch {
    // storage blocked: stay on the light default
  }
}

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error("[WasFix global error]", error);
    reportClientError(error);
  }, [error]);

  React.useEffect(() => {
    applyStoredTheme();
  }, []);

  return (
    <html lang="nl" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <style>{CSS}</style>
        <h1>Er is iets misgegaan</h1>
        <p>De pagina kon niet geladen worden. Probeer het opnieuw; blijft het misgaan, neem dan contact met ons op.</p>
        {error.digest && <p className="code">Foutcode: {error.digest}</p>}
        <button onClick={reset}>Opnieuw proberen</button>
      </body>
    </html>
  );
}
