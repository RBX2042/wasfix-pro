import { NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";

// Only the magnets that exist. "onderhoudskalender" used to be accepted too and
// silently served the foutcode cheatsheet (its file was a TODO), so it is gone
// until it exists.
const Schema = z.object({
  email: z.string().email(),
  magnetId: z.enum(["foutcodes-cheatsheet"]).default("foutcodes-cheatsheet"),
  source: z.string().max(80).optional(),
});

// Print-friendly HTML in public/leadmagnets/: open it, Ctrl+P, save as PDF.
// (public/leadmagnets/wasfix-25-foutcodes-cheatsheet.pdf is the same HTML under
// a .pdf name - not a PDF - so it is deliberately not linked.)
const MAGNET_URLS: Record<string, string> = {
  "foutcodes-cheatsheet": "/leadmagnets/foutcodes-cheatsheet.html",
};

/**
 * Sign-up for the cheatsheet. The download link is handed back in the response
 * and shown on the spot; NO e-mail with the file is sent. The route used to
 * promise "Check je inbox", but its mail step imported getResend/FROM from
 * lib/email, which does not export them, so the send was dead code even with a
 * Resend key - and the modal told people a PDF was on its way.
 */
export async function POST(req: NextRequest) {
  if (!(await rateLimit(`leadmagnet:${getClientKey(req)}`, 10, 60 * 60 * 1000))) {
    return apiError("Te veel aanvragen — probeer over een uur opnieuw.", 429);
  }

  const body = await req.json().catch(() => null);
  if (!body) return apiError("Ongeldige JSON", 400);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("Ongeldig e-mailadres", 400);

  const { email, magnetId, source } = parsed.data;
  const url = MAGNET_URLS[magnetId];

  // The address itself is not logged: this log line is the only record we have
  // of the request and personal data does not belong in it.
  logger.info("[lead-magnet] requested", { magnetId, source });

  if (isDatabaseConfigured()) {
    await prisma.newsletterSubscriber
      .upsert({ where: { email }, update: {}, create: { email, source: `lead-magnet:${magnetId}` } })
      .catch((err) => logger.warn("[lead-magnet] persist failed", err));
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (apiKey && audienceId) {
    await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, unsubscribed: false }),
    })
      .then((res) => {
        if (!res.ok) logger.warn("[lead-magnet] Resend audience add failed", { status: res.status });
      })
      .catch((err) => logger.warn("[lead-magnet] Resend audience add error", err));
  }

  return apiSuccess({
    message: "Bedankt! Je cheatsheet staat hieronder klaar.",
    url,
    // Kept for older callers of this endpoint.
    pdfUrl: url,
  });
}
