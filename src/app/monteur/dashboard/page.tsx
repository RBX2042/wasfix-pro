import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hasProAccess } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { parts as staticPartList } from "@/lib/static-db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import Link from "next/link";
import { formatEur } from "@/lib/utils";
import { Wrench, TrendingUp, Users, Calendar, ArrowRight, Code } from "lucide-react";

export const dynamic = "force-dynamic";


export const metadata = { title: "Monteur dashboard" };

export default async function MonteurDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen");

  // Allow access for TECHNICIAN, MONTEUR_PRO, BEDRIJF, ADMIN
  const hasAccess = hasProAccess(user);

  if (!hasAccess) {
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

  // Live numbers when a DB is connected; static catalog otherwise.
  const hasDb = isDatabaseConfigured();
  let stockTotal = staticPartList.reduce((sum, p) => sum + p.stock, 0);
  let totalDiagnoses = 0;
  let recentOrders: Array<{ id: string; totalEur: number; items: Array<{ id: string }> }> = [];
  let customerCount = 0;
  let customersThisMonth = 0;
  let activeWorkOrders = 0;
  let workOrdersThisWeek = 0;
  let openWorkOrders: Array<{
    id: string;
    reference: string;
    status: string;
    urgent: boolean;
    machine: string | null;
    problem: string;
    customer: { name: string } | null;
  }> = [];

  if (hasDb) {
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const weekAhead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const activeStatuses = ["OPEN", "GEPLAND", "WACHT_OP_ONDERDEEL"];
    try {
      const [partsTotal, orders, diagCount, custTotal, custRecent, woActive, woWeek, woList] = await Promise.all([
        prisma.part.aggregate({ _sum: { stock: true } }),
        prisma.order.findMany({ take: 8, orderBy: { createdAt: "desc" }, include: { items: true } }),
        prisma.diagnosis.count(),
        prisma.customer.count({ where: { ownerId: user.id } }),
        prisma.customer.count({ where: { ownerId: user.id, createdAt: { gte: monthAgo } } }),
        prisma.workOrder.count({ where: { ownerId: user.id, status: { in: activeStatuses } } }),
        prisma.workOrder.count({
          where: { ownerId: user.id, status: { in: activeStatuses }, scheduledAt: { gte: new Date(), lte: weekAhead } },
        }),
        prisma.workOrder.findMany({
          where: { ownerId: user.id, status: { in: activeStatuses } },
          orderBy: [{ urgent: "desc" }, { createdAt: "desc" }],
          take: 3,
          include: { customer: { select: { name: true } } },
        }),
      ]);
      stockTotal = partsTotal._sum.stock ?? stockTotal;
      recentOrders = orders;
      totalDiagnoses = diagCount;
      customerCount = custTotal;
      customersThisMonth = custRecent;
      activeWorkOrders = woActive;
      workOrdersThisWeek = woWeek;
      openWorkOrders = woList;
    } catch {
      // DB unreachable — keep static numbers
    }
  }
  const partsTotal = { _sum: { stock: stockTotal } };

  return (
    <DashboardLayout role={user.role}>
      <div className="mb-6">
        <Badge variant="accent" className="mb-2">Monteur Pro</Badge>
        <h1 className="font-heading text-2xl font-bold">Monteur Dashboard</h1>
        <p className="text-muted-foreground text-sm">Beheer klanten, werkorders en bestellingen</p>
      </div>

      <div className="grid md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><Users className="h-4 w-4" /> Klanten</div>
            <p className="font-heading text-2xl font-bold">{customerCount}</p>
            <p className="text-xs text-muted-foreground">
              {customersThisMonth > 0 ? `+${customersThisMonth} deze maand` : hasDb ? "Nog geen nieuwe" : "Database vereist"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><Calendar className="h-4 w-4" /> Werkorders</div>
            <p className="font-heading text-2xl font-bold">{activeWorkOrders}</p>
            <p className="text-xs text-muted-foreground">
              {workOrdersThisWeek > 0 ? `${workOrdersThisWeek} deze week gepland` : hasDb ? "Niets gepland" : "Database vereist"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><Wrench className="h-4 w-4" /> Voorraad</div>
            <p className="font-heading text-2xl font-bold">{partsTotal._sum.stock ?? 0}</p>
            <p className="text-xs text-muted-foreground">items</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1"><TrendingUp className="h-4 w-4" /> Diagnoses</div>
            <p className="font-heading text-2xl font-bold">{totalDiagnoses}</p>
            <p className="text-xs text-muted-foreground">platform totaal</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-heading text-lg font-semibold">Werkorders</h2>
              <Link href="/monteur/werkorders" className="text-sm text-primary hover:underline">Alles →</Link>
            </div>
            <div className="space-y-3">
              {openWorkOrders.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {hasDb ? (
                    <>Geen openstaande werkorders. <Link href="/monteur/werkorders" className="text-primary hover:underline">Maak er een aan →</Link></>
                  ) : (
                    "Werkorders vereisen een database (DATABASE_URL)."
                  )}
                </p>
              )}
              {openWorkOrders.map((wo) => (
                <div key={wo.id} className="flex items-center justify-between gap-3 p-3 rounded-md border">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{wo.reference} · {wo.customer?.name ?? "Geen klant"}</p>
                    <p className="text-xs text-muted-foreground truncate">{wo.machine ?? wo.problem}</p>
                  </div>
                  <Badge variant={wo.urgent ? "danger" : wo.status === "GEPLAND" ? "warning" : "secondary"} className="shrink-0">
                    {wo.status.replace(/_/g, " ")}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-heading text-lg font-semibold">Recente onderdelen orders</h2>
              <Link href="/monteur/onderdelen" className="text-sm text-primary hover:underline">Bulk bestellen →</Link>
            </div>
            <div className="space-y-3">
              {recentOrders.length === 0 && <p className="text-sm text-muted-foreground">Nog geen orders</p>}
              {recentOrders.slice(0, 4).map((o) => (
                <div key={o.id} className="flex items-center justify-between p-3 rounded-md border">
                  <div>
                    <p className="font-medium text-sm">#{o.id.slice(0, 8).toUpperCase()}</p>
                    <p className="text-xs text-muted-foreground">{o.items.length} onderdelen</p>
                  </div>
                  <span className="font-bold">{formatEur(o.totalEur)}</span>
                </div>
              ))}
            </div>
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
                Integreer WasFix Pro AI diagnose in je eigen systeem. 1000 calls/maand inbegrepen.
              </p>
              <code className="block bg-muted text-xs p-3 rounded-md mb-3 overflow-x-auto">
                curl -X POST https://api.wasfix.nl/v1/diagnose \<br/>
                &nbsp;&nbsp;-H {`"Authorization: Bearer YOUR_API_KEY"`} \<br/>
                &nbsp;&nbsp;-d {`'{"brand":"Bosch","model":"WAU28","symptom":"Foutcode E18"}'`}
              </code>
              <Button variant="outline">API documentatie <ArrowRight className="h-3 w-3" /></Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
