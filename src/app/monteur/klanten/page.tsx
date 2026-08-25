import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { hasMonteurAccess, getOrCreateCompanyForUser } from "@/lib/company";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Phone, Mail, Wrench, Users } from "lucide-react";
import { NewCustomerForm } from "./new-customer-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Klanten — Monteur" };

export default async function MonteurKlantenPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen");

  if (!hasMonteurAccess(user)) {
    return (
      <DashboardLayout role={user.role}>
        <Card>
          <CardContent className="p-12 text-center">
            <Wrench className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
            <h2 className="font-heading text-xl font-bold mb-2">Monteur Pro vereist</h2>
            <p className="text-muted-foreground mb-4">Deze functie is beschikbaar voor Monteur Pro abonnees.</p>
            <Button asChild><Link href="/prijzen">Bekijk Monteur Pro</Link></Button>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  const company = await getOrCreateCompanyForUser(user);
  const customers = await prisma.customer.findMany({
    where: { companyId: company.id },
    include: { machines: true, _count: { select: { workOrders: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <DashboardLayout role={user.role}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold">Klanten</h1>
          <p className="text-muted-foreground text-sm">{customers.length} klanten bij {company.name}</p>
        </div>
        <NewCustomerForm />
      </div>

      {customers.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Users className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nog geen klanten. Voeg je eerste klant toe om te starten.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {customers.map((c) => (
            <Link key={c.id} href={`/monteur/klanten/${c.id}`}>
              <Card className="hover:border-primary transition-colors h-full">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-heading font-semibold">{c.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {c._count.workOrders} werkorder{c._count.workOrders === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1 text-sm">
                    {c.email && (
                      <p className="flex items-center gap-2 text-muted-foreground"><Mail className="h-3 w-3" /> {c.email}</p>
                    )}
                    {c.phone && (
                      <p className="flex items-center gap-2 text-muted-foreground"><Phone className="h-3 w-3" /> {c.phone}</p>
                    )}
                    {c.machines.length > 0 && (
                      <p className="flex items-center gap-2 text-muted-foreground">
                        <Wrench className="h-3 w-3" /> {c.machines.map((m) => `${m.brand} ${m.model}`).join(", ")}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
