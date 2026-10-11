import { NextRequest } from "next/server";
import { confirmNewsletterSubscription, readNewsletterToken, verifyNewsletterToken } from "@/lib/newsletter";
import { htmlPage } from "@/lib/html-page";
import { rateLimit, getClientKey } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The link in the confirmation mail. GET only SHOWS a button: mail scanners and link previews open
 * links without anyone reading them, and a GET that subscribed would let them confirm for the
 * person. The POST behind the button is what subscribes.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const email = verifyNewsletterToken(token);
  if (!email) return htmlPage("Link werkt niet meer", "Deze bevestigingslink is ongeldig of verlopen. Meld je opnieuw aan voor de nieuwsbrief, dan krijg je een nieuwe link.", 400);
  return htmlPage(
    "Bevestig je aanmelding",
    "Klik op de knop om je aanmelding voor de WasFix Pro-nieuwsbrief te bevestigen.",
    200,
    `<form method="post" action="/api/newsletter/confirm"><input type="hidden" name="token" value="${esc(token)}"><button type="submit">Ja, meld mij aan</button></form>`,
  );
}

export async function POST(req: NextRequest) {
  if (!(await rateLimit(`newsletter-confirm:${getClientKey(req)}`, 20, 60 * 60 * 1000))) {
    return htmlPage("Te veel pogingen", "Probeer het over een uur opnieuw.", 429);
  }
  const fd = await req.formData().catch(() => null);
  const link = readNewsletterToken(String(fd?.get("token") ?? ""));
  if (!link) return htmlPage("Link werkt niet meer", "Deze bevestigingslink is ongeldig of verlopen. Meld je opnieuw aan voor de nieuwsbrief, dan krijg je een nieuwe link.", 400);
  // The link's issue time goes along: an opt-out made AFTER this mail went out is kept (see confirmNewsletterSubscription).
  const result = await confirmNewsletterSubscription(link.email, link.issuedAt);
  if (!result.ok) {
    return htmlPage("Bevestigen lukt nu niet", "Je aanmelding kon niet worden opgeslagen. Probeer de link over een paar minuten opnieuw.", 503);
  }
  if (result.status === "opted_out_later") {
    return htmlPage(
      "Je afmelding blijft staan",
      "Je hebt je afgemeld voor de nieuwsbrief nadat deze bevestigingsmail is verstuurd. Die afmelding blijft staan; we hebben niets gewijzigd. Wil je de nieuwsbrief toch weer ontvangen, meld je dan opnieuw aan op de website; je krijgt dan een nieuwe bevestigingsmail.",
    );
  }
  return htmlPage("Je bent aangemeld", "Bedankt, je aanmelding voor de WasFix Pro-nieuwsbrief is bevestigd.");
}
