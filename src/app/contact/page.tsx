import { MarketingLayout } from "@/components/marketing-layout";
import { COMPANY, realOrNull, PENDING_REGISTRATION, SUPPORT_RESPONSE_WORKDAYS } from "@/lib/plans";
import { contactEmail, contactEmailText } from "@/lib/contact-email";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, Phone, MapPin, Clock } from "lucide-react";

export const metadata = {
  title: "Contact",
  description: "Contact met WasFix Pro: mail voor vragen over een bestelling, onderdeel of diagnose, en de bedrijfsgegevens zodra de inschrijving rond is.",
  alternates: { canonical: "/contact" },
};

// ?onderwerp=monteur-demo is linked from the homepage monteur block ("Vraag een demo aan").
const SUBJECTS: Record<string, string> = {
  "monteur-demo": "Demo aanvragen voor mijn bedrijf (Monteur Pro)",
};

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ onderwerp?: string }> }) {
  const sp = await searchParams;
  // Own-property check on purpose: ?onderwerp=constructor (or __proto__, toString) found an inherited function on the plain
  // object and handed it to a client component, which made the page answer 500 on every such request.
  const subject = sp.onderwerp && Object.hasOwn(SUBJECTS, sp.onderwerp) ? SUBJECTS[sp.onderwerp] : undefined;
  // COMPANY_EMAIL only (decision D15): without it the card says "volgt na inschrijving" instead of a made-up address.
  const email = contactEmail();
  const mailto = email ? `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}` : null;
  // Never print a placeholder as if it were a real registration detail.
  const phone = realOrNull(COMPANY.phone);
  const street = realOrNull(COMPANY.street);
  const postalCode = realOrNull(COMPANY.postalCode);

  return (
    <MarketingLayout>
      <section className="border-b bg-muted/30">
        <div className="container py-12">
          <h1 className="font-heading text-3xl md:text-4xl font-bold">Contact</h1>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            We helpen je graag verder. We reageren binnen {SUPPORT_RESPONSE_WORKDAYS} werkdagen.
          </p>
        </div>
      </section>

      <div className="container py-8 max-w-3xl">
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <Card>
            <CardContent className="p-5">
              <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center text-primary mb-2">
                <Mail className="h-5 w-5" />
              </div>
              <h3 className="font-heading font-semibold mb-1">E-mail</h3>
              {mailto ? (
                <a href={mailto} className="text-primary hover:underline text-sm inline-flex items-center min-h-11 break-all">{email}</a>
              ) : (
                <p className="text-sm text-muted-foreground">{contactEmailText()}</p>
              )}
              {subject && <p className="text-xs text-muted-foreground">Onderwerp: {subject}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center text-primary mb-2">
                <Phone className="h-5 w-5" />
              </div>
              <h3 className="font-heading font-semibold mb-1">Telefoon</h3>
              {phone ? (
                <>
                  <p className="text-sm">{phone}</p>
                  <p className="text-xs text-muted-foreground">Ma-vr 9:00-17:00</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nog geen telefoonlijn. Mail ons.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center text-primary mb-2">
                <MapPin className="h-5 w-5" />
              </div>
              <h3 className="font-heading font-semibold mb-1">Hoofdkantoor</h3>
              {street && postalCode ? (
                <p className="text-sm">{street}<br />{postalCode} {COMPANY.city}<br />{COMPANY.country}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Bezoekadres {PENDING_REGISTRATION}. Mail ons voor een postadres: {contactEmailText()}.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center text-primary mb-2">
                <Clock className="h-5 w-5" />
              </div>
              <h3 className="font-heading font-semibold mb-1">Reactietijd</h3>
              <p className="text-sm text-muted-foreground">
                We beantwoorden mail binnen {SUPPORT_RESPONSE_WORKDAYS} werkdagen. Over een bestelling? Vermeld je bestelnummer.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-xl font-semibold mb-1">Bedrijfsgegevens</h2>
            <p className="text-sm text-muted-foreground">{COMPANY.name}</p>
            <dl className="grid grid-cols-2 gap-3 mt-3 text-sm">
              {([
                ["KvK", realOrNull(COMPANY.kvk)],
                ["BTW", realOrNull(COMPANY.vatNumber)],
                ["IBAN", realOrNull(COMPANY.iban)],
                ["Telefoon", phone],
              ] as const).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className={value ? "font-medium" : "text-muted-foreground"}>{value ?? PENDING_REGISTRATION}</dd>
                </div>
              ))}
            </dl>
            {COMPANY.isPlaceholder && (
              <p className="text-xs text-muted-foreground mt-4">
                WasFix Pro is nog in oprichting. Zodra de inschrijving bij de Kamer van Koophandel rond
                is, staan het KvK-, btw- en rekeningnummer hier — we tonen liever niets dan een nummer
                dat niet klopt.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </MarketingLayout>
  );
}
