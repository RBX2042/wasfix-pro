import { MarketingLayout } from "@/components/marketing-layout";
import { COMPANY, realOrNull, PENDING_REGISTRATION } from "@/lib/plans";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, Phone, MapPin, Clock } from "lucide-react";

export const metadata = { title: "Contact" };

export default function ContactPage() {
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
            We helpen je graag verder. Reageert meestal binnen 1 werkdag.
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
              <a href="mailto:support@wasfix.nl" className="text-primary hover:underline text-sm">support@wasfix.nl</a>
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
                  Nog geen telefoonlijn. Mail ons — we reageren op werkdagen.
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
                  Bezoekadres {PENDING_REGISTRATION}. Post kan naar {COMPANY.email}.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center text-primary mb-2">
                <Clock className="h-5 w-5" />
              </div>
              <h3 className="font-heading font-semibold mb-1">Openingstijden</h3>
              <p className="text-sm">Ma-vr 9:00 - 17:00<br />Za 10:00 - 14:00<br />Zo gesloten</p>
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
