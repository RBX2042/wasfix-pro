import { NextRequest } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { requestNewsletterSubscription } from "@/lib/newsletter";

// Only the magnets that exist. "onderhoudskalender" used to be accepted too and
// silently served the foutcode cheatsheet (its file was a TODO), so it is gone
// until it exists.
const Schema = z.object({
  email: z.string().email().max(254),
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
 *
 * The address is also offered the newsletter, with a confirmation step like
 * /api/newsletter (src/lib/newsletter.ts): it is stored UNCONFIRMED and a mail
 * with a link is sent; only the click subscribes. The download does not depend
 * on that. What the route does NOT do any more is answer "success" when the
 * address could not be stored (rehearsal R2-18): that is an error, and the
 * visitor can try again.
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

  const result = await requestNewsletterSubscription(email, `lead-magnet:${magnetId}`);
  if (!result.ok) {
    return apiError("Aanmelden lukt nu niet. Er is niets opgeslagen. Probeer het later opnieuw.", 503);
  }

  const newsletter =
    result.status === "mail_sent"
      ? "We hebben je ook een e-mail gestuurd om je aanmelding voor de nieuwsbrief te bevestigen; zonder die bevestiging sturen we je geen nieuwsbrief."
      : result.status === "already_subscribed"
        ? "Je was al aangemeld voor de nieuwsbrief."
        : result.status === "demo"
          ? "Demo: er is niets opgeslagen."
          : "De bevestigingsmail voor de nieuwsbrief kon niet worden verstuurd; je bent dus niet aangemeld voor de nieuwsbrief.";

  return apiSuccess({
    message: `Bedankt! Je cheatsheet staat hieronder klaar. ${newsletter}`,
    url,
    // Kept for older callers of this endpoint.
    pdfUrl: url,
    newsletter: result.status,
  });
}
