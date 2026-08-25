import Link from "next/link";
import { SiteHeader } from "./site-header";
import { Home, MessageCircle, Package, Wrench, User, Settings, Shield, Users, ClipboardList, CalendarDays } from "lucide-react";

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
  { href: "/monteur/planning", label: "Planning", icon: CalendarDays },
];

const ADMIN_NAV = [
  { href: "/admin", label: "Admin", icon: Shield },
];

export function DashboardLayout({ children, role = "CONSUMER" }: { children: React.ReactNode; role?: string }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="flex-1 container py-8">
        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
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
            {(role === "TECHNICIAN" || role === "BUSINESS" || role === "ADMIN") && (
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
          <main>{children}</main>
        </div>
      </div>
    </div>
  );
}
