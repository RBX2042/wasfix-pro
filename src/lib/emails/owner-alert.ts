/**
 * The owner-facing mail used by src/lib/notify.ts.
 * The message already carries no customer details (notify.ts scrubs them), so
 * this only formats it.
 */
import { esc } from "./layout";

export type OwnerAlertLevel = "info" | "warn" | "error";

const TAG: Record<OwnerAlertLevel, string> = { info: "", warn: "Let op: ", error: "FOUT: " };
const COLOR: Record<OwnerAlertLevel, string> = { info: "#1a6b6b", warn: "#b45309", error: "#b91c1c" };

export function ownerAlertEmail(input: { title: string; lines: string[]; url?: string; level: OwnerAlertLevel }): { subject: string; html: string } {
  const subject = `[WasFix] ${TAG[input.level]}${input.title}`.slice(0, 200);
  const lines = input.lines.map((l) => `<p style="margin: 4px 0; font-size: 14px;">${esc(l)}</p>`).join("");
  const link = input.url
    ? `<p style="margin-top: 20px;"><a href="${esc(input.url)}" style="display:inline-block; background:${COLOR[input.level]}; color:#fff; padding:10px 20px; border-radius:6px; text-decoration:none;">Openen in beheer</a></p>`
    : "";
  return {
    subject,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px;">
        <h2 style="color: ${COLOR[input.level]}; margin: 0 0 12px 0;">${esc(input.title)}</h2>
        ${lines}
        ${link}
        <p style="margin-top: 28px; font-size: 12px; color: #888;">Automatisch bericht van de webshop. Klantgegevens staan hier bewust niet in; open de link om ze te zien.</p>
      </div>
    `,
  };
}
