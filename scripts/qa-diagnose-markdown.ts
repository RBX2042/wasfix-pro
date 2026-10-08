/**
 * SafeMarkdown, rendered for real (react-dom/server) and inspected.
 *
 * Its own script because react-dom/server refuses to load under the
 * `react-server` condition that scripts/qa-diagnose.ts needs for the server-only
 * libraries; qa-diagnose.ts runs this one as a child process and reports its result.
 *
 * Usage: npx tsx scripts/qa-diagnose-markdown.ts
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SafeMarkdown } from "../src/components/diagnose/SafeMarkdown";

let failed = 0;
const lines: string[] = [];
const check = (cond: boolean, ok: string, bad: string) => {
  if (!cond) failed++;
  lines.push(cond ? `PASS ${ok}` : `FAIL ${bad}`);
};
const md = (text: string) => renderToStaticMarkup(React.createElement(SafeMarkdown, { text }));
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

check(
  JSON.stringify(hrefs(md("[ok](/gidsen/filter-reinigen)"))) === JSON.stringify(["/gidsen/filter-reinigen"]) &&
    JSON.stringify(hrefs(md("[ext](https://example.com/x)"))) === JSON.stringify(["https://example.com/x"]),
  "a site path and an https link become links",
  `links: ${md("[ok](/gidsen/filter-reinigen) [ext](https://example.com/x)")}`,
);
const hostile = ["[x](/\\evil.example.com)", "[x](//evil.example.com)", "[x](javascript:alert(1))", "[x](data:text/html,hi)", "[x](/ok\\evil.example.com)", "[x](http://plain.example.com)"];
check(hostile.every((t) => hrefs(md(t)).length === 0), "'/\\host', '//host', javascript:, data:, a backslash anywhere and plain http are NOT links", `rendered as links: ${hostile.filter((t) => hrefs(md(t)).length > 0).join(" ")}`);
check(!md("<img src=x onerror=alert(1)> **vet**").includes("<img"), "markup from the model is escaped", `unescaped: ${md("<img src=x onerror=alert(1)> **vet**")}`);
check(md("**vet**").includes("<strong>vet</strong>"), "bold renders as <strong>", "bold not rendered");
check((md("- een\n- twee").match(/<li>/g) ?? []).length === 2, "a list renders as <li> elements", `list: ${md("- een\n- twee")}`);

console.log(lines.join("\n"));
process.exit(failed ? 1 : 0);
