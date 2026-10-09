import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { env } from "@/lib/env";
import { ATTRIBUTION_DAYS, MAX_REWARD_PER_YEAR_EUR, REFERRAL_ENABLED, REWARD_EUR, REWARD_SHARE_OF_MARGIN, referralCodeFor, referralStats } from "@/lib/referrals";
import { ReferralPanel } from "./referral-panel";

export const metadata = { title: "Vrienden verwijzen · WasFix Pro", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Behind NEXT_PUBLIC_FEATURE_REFERRAL (default off): there is no automatic
 * payout, so the programme is not offered unless the owner turns it on knowing
 * that credit is settled by hand. Every figure below is read from the same
 * constants src/lib/referrals.ts enforces, so this text cannot promise more
 * than the code books.
 */
export default async function ReferralsPage() {
  if (!REFERRAL_ENABLED) notFound();

  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/inloggen?next=/dashboard/referrals");

  const code = await referralCodeFor(user.id);
  const stats = await referralStats(code, env.APP_URL);
  const euro = (n: number) => `€${n.toLocaleString("nl-NL")}`;

  return (
    <DashboardLayout role={user.role}>
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-2xl font-bold">Vrienden verwijzen</h1>
          <p className="text-muted-foreground text-sm">
            Deel je link. Betaalt een vriend zijn eerste bestelling, dan schrijven we je tegoed bij (maximaal {euro(REWARD_EUR)}).
          </p>
        </div>

        <ReferralPanel
          link={stats.link}
          code={code}
          stats={{ clicks: stats.clicks, signups: stats.signups, conversions: stats.conversions, earningsEur: stats.earningsEur }}
        />

        <div className="border rounded-lg p-6">
          <h2 className="font-heading text-lg font-semibold mb-4">Hoe het werkt</h2>
          <ol className="space-y-3 text-sm text-muted-foreground leading-relaxed list-decimal pl-5">
            <li><strong className="text-foreground">Deel je link.</strong> Via WhatsApp, e-mail of kopiëren en plakken.</li>
            <li><strong className="text-foreground">Je vriend bezoekt de site.</strong> Alleen als hij cookies voor verwijzingen accepteert, onthouden we {ATTRIBUTION_DAYS} dagen dat hij via jou kwam.</li>
            <li><strong className="text-foreground">Zijn eerste bestelling wordt betaald.</strong> Pas dan telt het. Een aangemaakte of nog niet betaalde bestelling, een factuur of een proefabonnement geeft niets.</li>
            <li><strong className="text-foreground">Wij schrijven je tegoed bij.</strong> Het staat hierboven bij &ldquo;Tegoed&rdquo;. Daarna kun je het laten verrekenen, zie onder.</li>
          </ol>
        </div>

        <div className="border rounded-lg p-6 bg-muted/30">
          <h2 className="font-heading text-base font-semibold mb-3">Voorwaarden en verrekening</h2>
          <ul className="space-y-2 text-sm text-muted-foreground leading-relaxed list-disc pl-5">
            <li>
              <strong className="text-foreground">Verrekening gebeurt handmatig.</strong> Er is nog geen tegoed dat vanzelf op je account of bij het afrekenen verschijnt: &ldquo;Tegoed&rdquo; hierboven is een teller. Wil je het inwisselen, neem dan{" "}
              <Link href="/contact" className="underline">contact op</Link>; wij verrekenen het dan handmatig met een volgende bestelling of een abonnementsfactuur. Geen contante uitbetaling.
            </li>
            <li>Per vriend maximaal {euro(REWARD_EUR)}, en nooit meer dan {Math.round(REWARD_SHARE_OF_MARGIN * 100)}% van wat WasFix aan zijn bestelling overhoudt (marge op de onderdelen, na korting, zonder btw en zonder verzendkosten). Is die marge niet vast te stellen of te klein, dan is het tegoed {euro(0)}.</li>
            <li>Alleen de eerste betaalde bestelling van een nieuwe klant telt, één keer per persoon.</li>
            <li>Maximaal {euro(MAX_REWARD_PER_YEAR_EUR)} tegoed per kalenderjaar.</li>
            <li>Geen tegoed voor jezelf: een bestelling met je eigen account of e-mailadres telt niet, en een klik op je eigen link terwijl je bent ingelogd evenmin.</li>
            <li>Het programma kan worden aangepast of stopgezet; tegoed dat al is bijgeschreven blijft staan.</li>
          </ul>
        </div>
      </div>
    </DashboardLayout>
  );
}
