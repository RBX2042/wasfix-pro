import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser, hasProAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Mail, Phone, Wrench, Users, MapPin } from "lucide-react";
import { DeleteCustomerButton, EditCustomerButton, NewCustomerButton, type CustomerRow } from "./customer-forms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Klanten — Monteur" };

export default async function MonteurKlantenPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen?next=/monteur/klanten");

  if (!hasProAccess(user)) {
    return (
      <DashboardLayout role={user.role}>
        <Card>
          <CardContent className="p-12 text-center">
            <Users className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
            <h2 className="font-heading text-xl font-bold mb-2">Monteur Pro vereist</h2>
            <p className="text-muted-foreground mb-4">Klantbeheer is beschikbaar voor Monteur Pro abonnees.</p>
            <Button asChild><Link href="/prijzen">Bekijk Monteur Pro</Link></Button>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  const hasDb = isDatabaseConfigured();
  let customers: Array<CustomerRow & { _count: { workOrders: number } }> = [];
  if (hasDb) {
    customers = await prisma.customer
      .findMany({
        where: { ownerId: user.id },
        orderBy: { name: "asc" },
        include: { _count: { select: { workOrders: true } } },
      })
      .catch(() => []);
  }

  return (
    <DashboardLayout role={user.role}>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">Klanten</h1>
          <p className="text-muted-foreground text-sm">
            {hasDb ? `${customers.length} ${customers.length === 1 ? "klant" : "klanten"} in jouw beheer` : "Klantbeheer vereist een database"}
          </p>
        </div>
        {hasDb && <NewCustomerButton />}
      </div>

      {!hasDb ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Users className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">
              Stel <code className="bg-muted px-1 rounded text-xs">DATABASE_URL</code> in om klanten op te slaan. Zie BLOCKED.md.
            </p>
          </CardContent>
        </Card>
      ) : customers.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Users className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground mb-4">Nog geen klanten. Voeg je eerste klant toe om werkorders te kunnen koppelen.</p>
            <NewCustomerButton />
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {customers.map((c) => (
            <Card key={c.id} className="hover:border-primary transition-colors">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3 gap-2">
                  <div className="min-w-0">
                    <h3 className="font-heading font-semibold truncate">{c.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {c._count.workOrders} {c._count.workOrders === 1 ? "werkorder" : "werkorders"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {c._count.workOrders > 0 && <Badge variant="success">Actief</Badge>}
                    <EditCustomerButton customer={c} />
                    <DeleteCustomerButton id={c.id} name={c.name} />
                  </div>
                </div>
                <div className="space-y-1 text-sm">
                  {c.email && <p className="flex items-center gap-2 text-muted-foreground"><Mail className="h-3 w-3 shrink-0" /> <a href={`mailto:${c.email}`} className="hover:text-foreground truncate">{c.email}</a></p>}
                  {c.phone && <p className="flex items-center gap-2 text-muted-foreground"><Phone className="h-3 w-3 shrink-0" /> <a href={`tel:${c.phone}`} className="hover:text-foreground">{c.phone}</a></p>}
                  {(c.street || c.city) && <p className="flex items-center gap-2 text-muted-foreground"><MapPin className="h-3 w-3 shrink-0" /> <span className="truncate">{[c.street, c.postalCode, c.city].filter(Boolean).join(", ")}</span></p>}
                  {c.machine && <p className="flex items-center gap-2 text-muted-foreground"><Wrench className="h-3 w-3 shrink-0" /> <span className="truncate">{c.machine}</span></p>}
                </div>
                {c.notes && <p className="text-xs text-muted-foreground mt-3 border-t pt-2 line-clamp-2">{c.notes}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
