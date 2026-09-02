import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ReferralWidget } from "@/components/ReferralWidget";
import { referralCodeFor } from "@/lib/referrals";

export const metadata = { title: "Refereer vrienden — verdien €5 · WasFix Pro" };
export const dynamic = "force-dynamic";

export default async function ReferralsPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/inloggen?next=/dashboard/referrals");

  const referralCode = await referralCodeFor(user.id);

  return (
    <DashboardLayout role={user.role}>
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-2xl font-bold">Refereer vrienden</h1>
          <p className="text-muted-foreground text-sm">Verdien €5 voor elke vriend die betalend lid wordt.</p>
        </div>

        <ReferralWidget userCode={referralCode} />

        {/* How it works */}
        <div className="border rounded-lg p-6">
          <h2 className="font-heading text-lg font-semibold mb-4">Hoe het werkt</h2>
          <ol className="space-y-3 text-sm text-muted-foreground leading-relaxed list-decimal pl-5">
            <li><strong className="text-foreground">Deel je link.</strong> Met WhatsApp/email/LinkedIn of gewoon kopiëren-en-plakken.</li>
            <li><strong className="text-foreground">Vriend signt up.</strong> De link onthoudt 30 dagen wie hem heeft uitgenodigd via een cookie.</li>
            <li><strong className="text-foreground">Vriend betaalt eerste maand.</strong> Dat moment activeert de credit voor jou.</li>
            <li><strong className="text-foreground">Je krijgt €5 op je account.</strong> Verzilverbaar tegen onderdelen of abonnement-maanden.</li>
          </ol>
        </div>

        {/* Terms */}
        <div className="border rounded-lg p-6 bg-muted/30">
          <h2 className="font-heading text-base font-semibold mb-3">Voorwaarden</h2>
          <ul className="space-y-2 text-sm text-muted-foreground leading-relaxed list-disc pl-5">
            <li>Credit activeert pas wanneer de uitgenodigde persoon zijn eerste <strong>volledige</strong> betaalde maand voltooit (geen restitutie).</li>
            <li>Geen contante uitbetaling — credit is alleen verzilverbaar binnen WasFix Pro.</li>
            <li>Max €500 per kalenderjaar.</li>
            <li>24-maanden attributie-window: de cookie is geldig 30 dagen vanaf eerste klik. Een vriend die later upgrade telt nog 24 maanden mee voor jouw credit.</li>
            <li>Geen zelf-refereren of fake-accounts — geautomatiseerde detectie. Sancties: verlies van alle credits + ban.</li>
            <li>Programma kan met 30 dagen aankondiging eindigen.</li>
          </ul>
        </div>

        {/* FAQ */}
        <div className="border rounded-lg p-6">
          <h2 className="font-heading text-lg font-semibold mb-4">Veelgestelde vragen</h2>
          <div className="space-y-3">
            {[
              { q: "Wanneer zie ik mijn eerste credit?", a: "Direct na de eerste betaalde maand van je vriend — meestal 30-35 dagen na hun signup. Je krijgt een e-mailnotificatie." },
              { q: "Hoe gebruik ik mijn credit?", a: "Automatisch — credit wordt afgetrokken bij je volgende order of abonnementsfactuur. Zie 'Credits' in je dashboard." },
              { q: "Kan ik mijn link aanpassen?", a: "Voor Particulier/Monteur Pro is dit een vaste code. Bedrijf/Enterprise klanten kunnen een vanity-URL aanvragen via support." },
            ].map((f, i) => (
              <details key={i} className="border rounded-md p-4 text-sm">
                <summary className="font-medium cursor-pointer">{f.q}</summary>
                <p className="text-muted-foreground mt-2 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
