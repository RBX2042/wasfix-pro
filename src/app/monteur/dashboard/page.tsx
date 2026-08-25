import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { hasMonteurAccess, getOrCreateCompanyForUser } from "@/lib/company";
import { WORK_ORDER_STATUS_LABELS, type WorkOrderStatus } from "@/lib/work-order";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Wrench, TrendingUp, Users, Calendar, ArrowRight, Code } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata = { title: "Monteur dashboard" };

const TERMINAL_STATUSES = ["COMPLETED", "INVOICED", "PAID", "WARRANTY", "CANCELLED"];

export default async function MonteurDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen");

  if (!hasMonteurAccess(user)) {
    return (
      <DashboardLayout role={user.role}>
        <Card>
          <CardContent className="p-12 text-center">
            <Wrench className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
            <h2 className="font-heading text-xl font-bold mb-2">Monteur Pro vereist</h2>
            <p className="text-muted-foreground mb-4">Deze functies zijn beschikbaar voor Monteur Pro abonnees.</p>
            <Button asChild><Link href="/prijzen">Bekijk Monteur Pro</Link></Button>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  const company = await getOrCreateCompanyForUser(user);

  const [partsTotal, myDiagnosesCount, customerCount, recentWorkOrders, activeWorkOrderCount] = await Promise.all([
    prisma.part.aggregate({ _sum: { stock: true } }),
    prisma.diagnosis.count({ where: { userId: user.id } }),
    prisma.customer.count({ where: { companyId: company.id } }),
    prisma.workOrder.findMany({
      where: { companyId: company.id },
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { customer: true, machine: true },
    }),
    prisma.workOrder.count({ where: { companyId: company.id, status: { notIn: TERMINAL_STATUSES } } }),
  ]);

  return (
    <DashboardLayout role={user.role}>
      <div className="mb-6">
        <Badge variant="accent" className="mb-2">{company.name}</Badge>
        <h1 className="font-heading text-2xl font-bold">Monteur Dashboard</h1>
        <p className="text-muted-foreground text-sm">Beheer klanten, werkorders en bestellingen</p>
      </div>

      <div className="grid md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><Users className="h-4 w-4" /> Klanten</div>
            <p className="font-heading text-2xl font-bold">{customerCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><Calendar className="h-4 w-4" /> Actieve werkorders</div>
            <p className="font-heading text-2xl font-bold">{activeWorkOrderCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><Wrench className="h-4 w-4" /> Voorraad</div>
            <p className="font-heading text-2xl font-bold">{partsTotal._sum.stock ?? 0}</p>
            <p className="text-xs text-muted-foreground">items in catalogus</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><TrendingUp className="h-4 w-4" /> Jouw AI diagnoses</div>
            <p className="font-heading text-2xl font-bold">{myDiagnosesCount}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-heading text-lg font-semibold">Recente werkorders</h2>
              <Link href="/monteur/werkorders" className="text-sm text-primary hover:underline">Alles →</Link>
            </div>
            <div className="space-y-3">
              {recentWorkOrders.length === 0 && <p className="text-sm text-muted-foreground">Nog geen werkorders</p>}
              {recentWorkOrders.map((wo) => (
                <Link key={wo.id} href={`/monteur/werkorders/${wo.id}`} className="flex items-center justify-between p-3 rounded-md border hover:border-primary transition-colors">
                  <div>
                    <p className="font-medium text-sm">{wo.number} · {wo.customer.name}</p>
                    <p className="text-xs text-muted-foreground">{wo.machine ? `${wo.machine.brand} ${wo.machine.model}` : wo.complaint}</p>
                  </div>
                  <Badge variant={wo.status === "NEW" ? "danger" : wo.status === "SCHEDULED" ? "warning" : "secondary"}>
                    {WORK_ORDER_STATUS_LABELS[wo.status as WorkOrderStatus] ?? wo.status}
                  </Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-heading text-lg font-semibold">Klanten</h2>
              <Link href="/monteur/klanten" className="text-sm text-primary hover:underline">Alles →</Link>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Beheer je klantenbestand, apparaten en servicehistorie.
            </p>
            <Button asChild variant="outline">
              <Link href="/monteur/klanten">Naar klanten <ArrowRight className="h-3 w-3" /></Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-md bg-primary/10 flex items-center justify-center text-primary"><Code className="h-6 w-6" /></div>
            <div className="flex-1">
              <h3 className="font-heading font-bold text-lg mb-1">API toegang</h3>
              <p className="text-sm text-muted-foreground mb-3">
                Integreer WasFix Pro AI diagnose in je eigen systeem.
              </p>
              <code className="block bg-muted text-xs p-3 rounded-md mb-3 overflow-x-auto">
                curl -X POST https://wasfix.nl/api/v1/diagnose \<br/>
                &nbsp;&nbsp;-H {`"Authorization: Bearer YOUR_API_KEY"`} \<br/>
                &nbsp;&nbsp;-d {`'{"brand":"Bosch","model":"WAU28","symptoms":"Foutcode E18"}'`}
              </code>
              <Button variant="outline" asChild><Link href="/api-info">API documentatie <ArrowRight className="h-3 w-3" /></Link></Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
