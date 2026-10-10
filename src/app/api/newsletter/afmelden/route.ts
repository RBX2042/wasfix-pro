import { NextRequest, NextResponse } from "next/server";
import { unsubscribeFromNewsletter, verifyNewsletterUnsubscribeToken, UNSUBSCRIBE_RATE_LIMIT } from "@/lib/newsletter";
import { htmlPage } from "@/lib/html-page";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { supportHint } from "@/lib/support-hint";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const INVALID = { title: "Afmeldlink werkt niet", message: `Deze afmeldlink is niet geldig. Gebruik de afmeldlink onderaan een nieuwsbrief, of ${supportHint(env.COMPANY_EMAIL)}; dan melden we je af.` };
const DONE = { title: "Je bent afgemeld", message: "Dit e-mailadres ontvangt geen nieuwsbrieven meer van WasFix Pro. De afmelding gaat direct in; je hoeft verder niets te doen." };
/** Same title, but the Resend contact could not be flagged just now: say what is true (stored, in force, followed up), not more. */
const DONE_SYNC_PENDING = { title: "Je bent afgemeld", message: "Je afmelding is opgeslagen en gaat direct in. Het doorgeven aan ons verzendsysteem lukte zojuist niet; dat werken we bij, zodat je geen nieuwsbrief meer van WasFix Pro krijgt. Je hoeft verder niets te doen." };
const NOT_STORED = { title: "Afmelden lukt nu niet", message: `We konden je afmelding niet opslaan. Probeer de link over een paar minuten opnieuw, of ${supportHint(env.COMPANY_EMAIL)}.` };

/** The short answer for a mail client's one-click POST (RFC 8058): no page, just a status and a line of text. */
const plain = (text: string, status: number) => new NextResponse(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/**
 * The opt-out link in every mail. GET only SHOWS a button, for the same reason as the confirmation link: mail
 * scanners and link previews open links without anyone reading them, and a GET that unsubscribed would let a
 * scanner opt people out. The POST behind the button is what unsubscribes. The token is what authorises it: it is
 * signed for one address and only ever travels in mail to that address, so knowing an address is not enough.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!verifyNewsletterUnsubscribeToken(token)) return htmlPage(INVALID.title, INVALID.message, 400);
  return htmlPage(
    "Afmelden voor de nieuwsbrief",
    "Klik op de knop om je af te melden voor de WasFix Pro-nieuwsbrief. Je ontvangt dan geen nieuwsbrieven meer; de afmelding gaat direct in.",
    200,
    `<form method="post" action="/api/newsletter/afmelden"><input type="hidden" name="token" value="${esc(token)}"><button type="submit">Ja, meld mij af</button></form>`,
  );
}

/**
 * Two callers: the button on the GET page (form field `token`) and a mail client's RFC 8058 one-click POST to the
 * URL from the List-Unsubscribe header (`?token=` in the URL, body `List-Unsubscribe=One-Click`). Both end in the
 * same place: unsubscribedAt in our table, then the Resend audience (best effort, see src/lib/newsletter.ts). An
 * address we do not know gets the same answer as one we do, so the route cannot be used to find out who is on the list.
 */
export async function POST(req: NextRequest) {
  const tokenInUrl = req.nextUrl.searchParams.get("token");
  // The body (a small form) is read before anything is counted, because what counts depends on the token: only a token
  // that does NOT verify counts against the caller's address (the guard against guessing), while a valid one counts
  // against the address it was signed for, never against the caller: one-click POSTs come from the mail provider's
  // servers, shared by all its readers, and a 429 there would be a refused opt-out (UNSUBSCRIBE_RATE_LIMIT).
  const fd = await req.formData().catch(() => null);
  const oneClick = String(fd?.get("List-Unsubscribe") ?? "") === "One-Click";
  // The SHAPE of an error answer follows the caller: a line of text for a one-click POST (its body says so, or it hit
  // the URL from the List-Unsubscribe header, which carries the token: a bodiless POST to that URL is a mail client's,
  // not a person's), a page for the button, whose form posts to the bare path.
  const asText = oneClick || tokenInUrl !== null;
  const tooMany = () => (asText ? plain("Te veel pogingen; probeer het over een uur opnieuw.", 429) : htmlPage("Te veel pogingen", "Probeer het over een uur opnieuw.", 429));
  const token = String(fd?.get("token") ?? tokenInUrl ?? "");
  const email = verifyNewsletterUnsubscribeToken(token);
  if (!email) {
    const { max, windowMs } = UNSUBSCRIBE_RATE_LIMIT.perCaller;
    if (!(await rateLimit(`newsletter-afmelden:${getClientKey(req)}`, max, windowMs))) return tooMany();
    return asText ? plain("Ongeldige afmeldlink.", 400) : htmlPage(INVALID.title, INVALID.message, 400);
  }
  const { max, windowMs } = UNSUBSCRIBE_RATE_LIMIT.perAddress;
  if (!(await rateLimit(`newsletter-afmelden-adres:${email}`, max, windowMs))) return tooMany();

  const result = await unsubscribeFromNewsletter(email);
  // One shape per caller for EVERY answer (asText, not only the 400/429 above): a bodiless POST to the header URL is a
  // mail client's too, and gets a line of text for its 200 and 503 as well.
  if (!result.ok) return asText ? plain("Afmelden lukt nu niet; probeer het later opnieuw.", 503) : htmlPage(NOT_STORED.title, NOT_STORED.message, 503);
  // "failed" means our table holds the opt-out but the Resend contact is still flagged subscribed until the owner acts on
  // the notice; the page must not claim more than that. "not_in_audience" and "not_configured" leave nothing to flag.
  const synced = result.resend !== "failed";
  if (asText) return plain(synced ? "Afgemeld: dit e-mailadres ontvangt geen nieuwsbrieven meer van WasFix Pro." : "Afgemeld: je afmelding is opgeslagen en gaat direct in; ons verzendsysteem wordt nog bijgewerkt.", 200);
  const done = synced ? DONE : DONE_SYNC_PENDING;
  return htmlPage(done.title, done.message);
}
