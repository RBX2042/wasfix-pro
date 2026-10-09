import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { requestNewsletterSubscription } from "@/lib/newsletter";
import { htmlPage } from "@/lib/html-page";

const Schema = z.object({ email: z.string().email().max(254) });

// Newsletter sign-up with a confirmation step (src/lib/newsletter.ts): the address is stored UNCONFIRMED,
// a mail with a signed link goes out, and only the click on that link subscribes it. The answer is an
// error whenever the address was not stored or no confirmation can be mailed: this route used to thank
// the visitor while the database write had failed (only logged), and subscribed any address typed in.
export async function POST(req: NextRequest) {
  if (!(await rateLimit(`newsletter:${getClientKey(req)}`, 5, 60 * 60 * 1000))) {
    return apiError("Te veel pogingen — probeer over een uur opnieuw.", 429);
  }

  let email = "";
  const contentType = req.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  if (isJson) {
    const body = await req.json().catch(() => null);
    if (!body) return apiError("Ongeldige JSON", 400);
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return apiError("Ongeldig e-mailadres", 400);
    email = parsed.data.email;
  } else {
    const fd = await req.formData().catch(() => null);
    email = String(fd?.get("email") ?? "");
    if (!Schema.safeParse({ email }).success) {
      return htmlPage("Ongeldig e-mailadres", "Dat is geen geldig e-mailadres. Ga terug en probeer het opnieuw.", 400);
    }
  }

  const result = await requestNewsletterSubscription(email, "newsletter");

  let status = 200;
  let message: string;
  if (!result.ok) {
    status = 503;
    message = "Aanmelden lukt nu niet. Er is niets opgeslagen. Probeer het later opnieuw.";
  } else if (result.status === "mail_not_sent" && result.reason === "no_mail") {
    status = 503;
    message = "We konden geen bevestigingsmail versturen, dus je bent nog niet aangemeld. Probeer het later opnieuw.";
  } else if (result.status === "mail_not_sent") {
    message = "We hebben je vandaag al een bevestigingsmail gestuurd. Kijk ook in je spam. Klik op de link erin om je aanmelding te bevestigen.";
  } else if (result.status === "already_subscribed") {
    message = "Dit e-mailadres is al aangemeld voor de nieuwsbrief.";
  } else if (result.status === "demo") {
    message = "Demo: er is niets opgeslagen en er is geen mail verstuurd.";
  } else {
    message = "Bijna klaar: we hebben je een e-mail gestuurd. Klik op de link erin om je aanmelding te bevestigen. Tot die tijd ben je niet aangemeld.";
  }

  if (!isJson) return htmlPage(status === 200 ? "Controleer je e-mail" : "Aanmelden mislukt", message, status);
  if (status !== 200) return apiError(message, status);
  return apiSuccess({ message, confirmed: result.ok && result.status === "already_subscribed", demo: result.ok && result.status === "demo" });
}

export const dynamic = "force-dynamic";
