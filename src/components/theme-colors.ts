/**
 * The <meta name="theme-color"> of each theme: the colour a phone paints its address bar and status bar
 * with. Plain module (no "use client") because app/layout.tsx, a server component, reads it for the
 * `viewport` export and theme-provider.tsx, a client component, reads it to keep the tag in step with the
 * CHOSEN theme.
 *
 * Each value is the page background of its theme (hsl(var(--background)) in globals.css, written out as hex
 * because a meta tag cannot read a CSS variable). scripts/qa-theme.ts compares them with the rendered
 * background, so changing one without the other fails there. The pages on the redesign palette (the home page,
 * the legal pages ...) have a slightly different background of their own; the browser bar is one colour per
 * theme and is a few shades off on those pages.
 */
export const THEME_COLOR_LIGHT = "#f4f1eb";
export const THEME_COLOR_DARK = "#121212";

/**
 * Runs in <body> BEFORE next-themes' own inline script (app/layout.tsx puts it just above the provider): drops a stored
 * theme that is not one of the three values this app writes. next-themes puts the stored string on <html> with
 * classList.add(), which throws on a value with whitespace (" dark", "dark light"); the throw happens in an effect, so
 * the error boundary answers "Er is iets misgegaan" on EVERY page, and it does again on every load, because the bad
 * value is read again each time. A hand-edited or corrupted entry is the only way in (the app writes light, dark or
 * system), but the failure is total and permanent for that browser, and the repair is one line. Plain string, no "use
 * client": the server component layout inlines it. Storage may be blocked: the whole thing is in a try.
 */
export const THEME_STORAGE_KEY = "theme";
export const STORED_THEME_GUARD_SCRIPT = `try{var k=${JSON.stringify(THEME_STORAGE_KEY)},v=localStorage.getItem(k);if(v!==null&&v!=="light"&&v!=="dark"&&v!=="system")localStorage.removeItem(k)}catch(e){}`;

/**
 * The palette of the pages that render OUTSIDE the app: app/global-error.tsx replaces the whole document
 * (root layout, stylesheet and theme provider included), so it cannot use the tokens of globals.css and carries
 * these values itself. Each one is the value of the token named next to it, in that theme; scripts/qa-theme.ts
 * checks that they still are, and that every text colour reaches 4.5:1 on its background.
 */
export const STANDALONE_PALETTE = {
  light: { background: THEME_COLOR_LIGHT /* --background */, foreground: "#0d0d0d" /* --foreground */, muted: "#595959" /* --muted-foreground */, button: "#1b6a6a" /* --primary */, buttonText: "#fbfaf8" /* --primary-foreground */ },
  dark: { background: THEME_COLOR_DARK /* --background */, foreground: "#f8f5f2" /* --foreground */, muted: "#a6a6a6" /* --muted-foreground */, button: "#40bfbf" /* --primary */, buttonText: "#0d0d0d" /* --primary-foreground */ },
} as const;
