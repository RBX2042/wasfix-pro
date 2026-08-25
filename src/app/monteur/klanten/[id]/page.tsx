import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { hasMonteurAccess, getOrCreateCompanyForUser } from "@/lib/company";
import { WORK_ORDER_STATUS_LABELS, type WorkOrderStatus } from "@/lib/work-order";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Mail, Phone, MapPin, Wrench, ArrowLeft, ChevronRight, Plus } from "lucide-react";
import { NewMachineForm } from "./new-machine-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Klant — Monteur" };

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen");
  if (!hasMonteurAccess(user)) redirect("/monteur/dashboard");

  const company = await getOrCreateCompanyForUser(user);
  const { id } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      machines: true,
      workOrders: { orderBy: { createdAt: "desc" }, include: { machine: true } },
    },
  });

  if (!customer || customer.companyId !== company.id) notFound();

  return (
    <DashboardLayout role={user.role}>
      <Link href="/monteur/klanten" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3 w-3" /> Terug naar klanten
      </Link>

      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold">{customer.name}</h1>
        <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
          {customer.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {customer.email}</span>}
          {customer.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {customer.phone}</span>}
          {customer.addressLine && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {customer.addressLine}{customer.city ? `, ${customer.city}` : ""}
            </span>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading font-semibold flex items-center gap-2"><Wrench className="h-4 w-4" /> Apparaten</h2>
            <NewMachineForm customerId={customer.id} />
          </div>
          {customer.machines.length === 0 ? (
            <Card><CardContent className="p-5 text-sm text-muted-foreground">Nog geen apparaten geregistreerd.</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {customer.machines.map((m) => (
                <Card key={m.id}>
                  <CardContent className="p-4">
                    <p className="font-medium">{m.brand} {m.model}</p>
                    {m.serialNumber && <p className="text-xs text-muted-foreground">SN: {m.serialNumber}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading font-semibold">Werkorders</h2>
            <Button asChild size="sm">
              <Link href={`/monteur/werkorders?customerId=${customer.id}`}><Plus className="h-4 w-4" /> Nieuwe werkorder</Link>
            </Button>
          </div>
          {customer.workOrders.length === 0 ? (
            <Card><CardContent className="p-5 text-sm text-muted-foreground">Nog geen werkorders voor deze klant.</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {customer.workOrders.map((w) => (
                <Link key={w.id} href={`/monteur/werkorders/${w.id}`}>
                  <Card className="hover:border-primary transition-colors">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-sm font-bold">{w.number}</span>
                          <Badge>{WORK_ORDER_STATUS_LABELS[w.status as WorkOrderStatus] ?? w.status}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{w.machine ? `${w.machine.brand} ${w.machine.model} — ` : ""}{w.complaint}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
