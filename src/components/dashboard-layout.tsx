import Link from "next/link";
import { SiteHeader } from "./site-header";
import { Home, MessageCircle, Package, Wrench, User, Settings, Shield, Users, ClipboardList, Building2, KeyRound, ShoppingCart, Gift } from "lucide-react";
import { getCurrentUser, hasProAccess } from "@/lib/auth";

const NAV = [
  { href: "/dashboard", label: "Overzicht", icon: Home },
  { href: "/dashboard/diagnoses", label: "Diagnoses", icon: MessageCircle },
  { href: "/dashboard/bestellingen", label: "Bestellingen", icon: Package },
  { href: "/dashboard/wasmachines", label: "Mijn wasmachines", icon: Wrench },
  { href: "/dashboard/profiel", label: "Profiel", icon: User },
];

const PRO_NAV = [
  { href: "/monteur/dashboard", label: "Monteur dashboard", icon: Settings },
  { href: "/monteur/klanten", label: "Klanten", icon: Users },
  { href: "/monteur/werkorders", label: "Werkorders", icon: ClipboardList },
  { href: "/monteur/onderdelen", label: "Onderdelen (monteurkorting)", icon: ShoppingCart },
  { href: "/dashboard/api-keys", label: "API keys", icon: KeyRound },
  { href: "/monteur/instellingen", label: "Bedrijfsgegevens", icon: Building2 },
];

// Only offered while the programme is switched on (it is off by default, see src/lib/referrals.ts).
const REFERRAL_NAV = { href: "/dashboard/referrals", label: "Vrienden verwijzen", icon: Gift };

const ADMIN_NAV = [
  { href: "/admin", label: "Admin", icon: Shield },
];

/**
 * `plan` is optional: without it the layout asks for the current user itself
 * (memoised per request, so this costs nothing extra). The monteur links are
 * shown for what the account PAYS for (hasProAccess), not for a role flag: a
 * self-serve Monteur Pro or Bedrijf buyer keeps role CONSUMER and used to see no
 * link to the product they bought.
 */
export async function DashboardLayout({ children, role = "CONSUMER", plan }: { children: React.ReactNode; role?: string; plan?: string }) {
  const entitledPlan = plan ?? (await getCurrentUser().catch(() => null))?.plan ?? "FREE";
  const showPro = hasProAccess({ plan: entitledPlan, role });
  const showReferral = process.env.NEXT_PUBLIC_FEATURE_REFERRAL === "true";
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="flex-1 container py-8">
        {/* minmax(0,1fr) and min-w-0: a grid track is as wide as its widest content unless told it may shrink, so one wide table pushed the whole page past a 375px screen. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="space-y-1 lg:sticky lg:top-20 lg:self-start">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
            {showReferral && (
              <Link
                href={REFERRAL_NAV.href}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors"
              >
                <REFERRAL_NAV.icon className="h-4 w-4" />
                {REFERRAL_NAV.label}
              </Link>
            )}
            {showPro && (
              <>
                <div className="h-px bg-border my-2" />
                {PRO_NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors"
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                ))}
              </>
            )}
            {role === "ADMIN" && (
              <>
                {ADMIN_NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors"
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                ))}
              </>
            )}
          </aside>
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
