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
import { Calendar, MapPin, ChevronRight, ClipboardList, Wrench } from "lucide-react";
import { NewWorkOrderForm } from "./new-work-order-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Werkorders — Monteur" };

const STATUS_VARIANT: Record<string, "danger" | "warning" | "success" | "default" | "secondary"> = {
  NEW: "danger",
  PRE_DIAGNOSIS: "warning",
  SCHEDULED: "default",
  ON_THE_WAY: "default",
  IN_PROGRESS: "warning",
  WAITING_FOR_PART: "warning",
  COMPLETED: "success",
  INVOICED: "success",
  PAID: "success",
  WARRANTY: "secondary",
  CANCELLED: "secondary",
};

export default async function WerkordersPage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
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
  const { customerId } = await searchParams;

  const [workOrders, customers] = await Promise.all([
    prisma.workOrder.findMany({
      where: { companyId: company.id },
      include: { customer: true, machine: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.customer.findMany({
      where: { companyId: company.id },
      include: { machines: { select: { id: true, brand: true, model: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const activeCount = workOrders.filter((w) => !["COMPLETED", "INVOICED", "PAID", "WARRANTY", "CANCELLED"].includes(w.status)).length;

  return (
    <DashboardLayout role={user.role}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold">Werkorders</h1>
          <p className="text-muted-foreground text-sm">{activeCount} actieve werkorders</p>
        </div>
        <NewWorkOrderForm customers={customers} defaultCustomerId={customerId} />
      </div>

      {workOrders.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <ClipboardList className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nog geen werkorders. Maak je eerste werkorder aan.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {workOrders.map((w) => (
            <Link key={w.id} href={`/monteur/werkorders/${w.id}`}>
              <Card className={w.status === "NEW" ? "border-red-500/40" : ""}>
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-mono font-bold text-sm">{w.number}</span>
                        <Badge variant={STATUS_VARIANT[w.status] ?? "secondary"}>
                          {WORK_ORDER_STATUS_LABELS[w.status as WorkOrderStatus] ?? w.status}
                        </Badge>
                      </div>
                      <h3 className="font-heading font-semibold">{w.customer.name}</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        {w.machine ? `${w.machine.brand} ${w.machine.model} — ` : ""}{w.complaint}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        {w.scheduledAt && (
                          <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {new Date(w.scheduledAt).toLocaleString("nl-NL")}</span>
                        )}
                        {w.customer.addressLine && (
                          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {w.customer.addressLine}{w.customer.city ? `, ${w.customer.city}` : ""}</span>
                        )}
                      </div>
                    </div>
                    <Button variant="outline" size="sm">Open <ChevronRight className="h-3 w-3" /></Button>
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
