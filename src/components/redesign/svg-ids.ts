import * as React from "react";

/**
 * Ids for the <defs> of an inline SVG that is rendered more than once on a page.
 *
 * A gradient, pattern or clip path is found through `url(#id)`, and an id is global to the document. The washing machine
 * of the home page is drawn twice (the hero and the diagnosis demo), and with literal ids every gradient existed twice:
 * invalid HTML, and `url(#cabFill)` of the second drawing resolved to the FIRST drawing's gradient, which is the wrong
 * one as soon as the two differ. Each mounted drawing now gets its own prefix from React's useId (the same value on the
 * server and in the browser, so hydration agrees).
 *
 * `svgSafeId` makes the prefix safe inside `url(#...)` and a CSS selector whatever format a React version uses (18 wrote
 * `:r1:`, 19.1 `«r1»`, 19.2 `_r_1_`): it starts with the letters "svg", and every character outside [A-Za-z0-9_] becomes
 * `-<hex code>-`. The mapping is one-to-one (a `-` of the input is escaped too), so two different React ids can never
 * become the same prefix. scripts/qa-theme.ts tests it (S5, which also refuses a literal id in a <defs> of src/) and checks
 * the rendered pages for duplicate ids and for url(#...) references that leave their drawing (part n).
 */
export function svgSafeId(raw: string): string {
  return `svg${raw.replace(/[^A-Za-z0-9_]/g, (c) => `-${c.charCodeAt(0).toString(16)}-`)}`;
}

/** `ref("cabFill")` is the id for the element, `url("cabFill")` the paint reference to it, for one mounted drawing. */
export function useSvgIds() {
  const prefix = svgSafeId(React.useId());
  return React.useMemo(() => {
    const ref = (name: string) => `${prefix}${name}`;
    return { ref, url: (name: string) => `url(#${ref(name)})` };
  }, [prefix]);
}
