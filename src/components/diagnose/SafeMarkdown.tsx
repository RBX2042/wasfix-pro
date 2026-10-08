import * as React from "react";
import Link from "next/link";

/**
 * The small slice of Markdown the diagnosis answers use: paragraphs, "- " lists,
 * **bold** and [label](link). Everything else is printed as plain text. It builds
 * React elements, never HTML strings, so model output (which is untrusted) cannot
 * inject markup, and a link is only rendered when it is a path on this site (one
 * slash, no second slash and no backslash, which browsers read as a slash) or
 * an https URL: a javascript: or data: URL stays as the text the model wrote.
 */

// A link target is either a path on this site ("/" and then neither another "/" nor a backslash, and no
// backslash anywhere) or an https URL. Anything else is not a link and is printed as the text it is.
const SAFE_HREF = String.raw`(?:\/(?![/\\])[^)\s\\]*|https:\/\/[^)\s]+)`;
const LINK = new RegExp(String.raw`^\[([^\]\n]+)\]\((${SAFE_HREF})\)$`);
const TOKEN = new RegExp(String.raw`(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(${SAFE_HREF}\))`, "g");

function inline(text: string, keyBase: string): React.ReactNode[] {
  return text.split(TOKEN).filter((part) => part !== "").map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={key}>{part.slice(2, -2)}</strong>;
    // Only a part that passes the strict pattern becomes a link. (Splitting on TOKEN leaves the text between
    // tokens in the list too, and "[x](data:...)" is such text: it must not be re-read with a looser pattern.)
    const link = part.match(LINK);
    if (link) {
      const [, label, href] = link;
      if (href.startsWith("/")) return <Link key={key} href={href} style={{ color: "var(--acc-2)", textDecoration: "underline" }}>{label}</Link>;
      return <a key={key} href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--acc-2)", textDecoration: "underline" }}>{label}</a>;
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

export function SafeMarkdown({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim() !== "");
        if (lines.length === 0) return null;
        const bullets = lines.filter((l) => /^\s*[-*]\s+/.test(l));
        // A block that is a list, possibly with a lead-in line above it.
        if (bullets.length > 0 && bullets.length >= lines.length - 1) {
          const lead = lines.length > bullets.length ? lines[0] : null;
          return (
            <div key={bi} style={{ marginTop: bi ? 10 : 0 }}>
              {lead && <p style={{ margin: 0 }}>{inline(lead, `b${bi}l`)}</p>}
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {bullets.map((l, li) => <li key={li}>{inline(l.replace(/^\s*[-*]\s+/, ""), `b${bi}i${li}`)}</li>)}
              </ul>
            </div>
          );
        }
        return (
          <p key={bi} style={{ margin: bi ? "10px 0 0" : 0, overflowWrap: "anywhere" }}>
            {lines.map((l, li) => (
              <React.Fragment key={li}>
                {li > 0 && <br />}
                {inline(l, `b${bi}p${li}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}
