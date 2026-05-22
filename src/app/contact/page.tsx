import { MarketingLayout } from "@/components/marketing-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, Phone, MapPin, Clock } from "lucide-react";

export const metadata = { title: "Contact" };

export default function ContactPage() {
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
              <p className="text-sm">085 - 123 45 67</p>
              <p className="text-xs text-muted-foreground">Ma-vr 9:00-17:00</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center text-primary mb-2">
                <MapPin className="h-5 w-5" />
              </div>
              <h3 className="font-heading font-semibold mb-1">Hoofdkantoor</h3>
              <p className="text-sm">Hoofdstraat 1<br />1234 AB Amsterdam<br />Nederland</p>
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
            <p className="text-sm text-muted-foreground">WasFix Pro B.V.</p>
            <dl className="grid grid-cols-2 gap-3 mt-3 text-sm">
              <div><dt className="text-muted-foreground">KvK</dt><dd className="font-medium">12345678</dd></div>
              <div><dt className="text-muted-foreground">BTW</dt><dd className="font-medium">NL123456789B01</dd></div>
              <div><dt className="text-muted-foreground">IBAN</dt><dd className="font-medium">NL00ABCD0123456789</dd></div>
              <div><dt className="text-muted-foreground">Telefoon</dt><dd className="font-medium">085 - 123 45 67</dd></div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </MarketingLayout>
  );
}
