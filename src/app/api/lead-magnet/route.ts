import { NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { leadMagnetEmail } from "@/lib/emails/templates";

const Schema = z.object({
  email: z.string().email(),
  magnetId: z.enum(["foutcodes-cheatsheet", "onderhoudskalender"]).default("foutcodes-cheatsheet"),
  source: z.string().max(80).optional(),
});

const MAGNET_PDFS: Record<string, string> = {
  // Print-friendly HTML hosted in public/leadmagnets/.
  // User opens in browser → Ctrl+P → Save as PDF. Works in NL+EN.
  "foutcodes-cheatsheet": "https://wasfix.nl/leadmagnets/foutcodes-cheatsheet.html",
  "onderhoudskalender": "https://wasfix.nl/leadmagnets/foutcodes-cheatsheet.html", // TODO: generate calendar
};

export async function POST(req: NextRequest) {
  if (!rateLimit(`leadmagnet:${getClientKey(req)}`, 10, 60 * 60 * 1000)) {
    return apiError("Te veel aanvragen — probeer over een uur opnieuw.", 429);
  }

  const body = await req.json().catch(() => null);
  if (!body) return apiError("Ongeldige JSON", 400);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("Ongeldig e-mailadres", 400);

  const { email, magnetId, source } = parsed.data;
  const pdfUrl = MAGNET_PDFS[magnetId] ?? MAGNET_PDFS["foutcodes-cheatsheet"];

  logger.info("[lead-magnet] requested", { email, magnetId, source });

  // Send the magnet via Resend (graceful if not configured)
  try {
    const { getResend, FROM } = await import("@/lib/email").then((m) => ({
      getResend: (m as unknown as { getResend?: () => unknown }).getResend ?? (() => null),
      FROM: process.env.RESEND_FROM_EMAIL ?? "WasFix Pro <noreply@wasfix.nl>",
    }));
    const resend = getResend() as { emails: { send: (opts: Record<string, string>) => Promise<unknown> } } | null;

    if (resend) {
      const { subject, html } = leadMagnetEmail(pdfUrl);
      await resend.emails.send({ from: FROM, to: email, subject, html });
    }

    // Also subscribe to newsletter audience
    const apiKey = process.env.RESEND_API_KEY;
    const audienceId = process.env.RESEND_AUDIENCE_ID;
    if (apiKey && audienceId) {
      await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email, unsubscribed: false }),
      }).catch(() => {});
    }
  } catch (err) {
    logger.warn("[lead-magnet] email send failed", err);
  }

  return apiSuccess({
    message: "Check je inbox — je cheatsheet is onderweg.",
    pdfUrl, // Also return URL directly for instant access
  });
}
