import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { hasMonteurAccess, getOrCreateCompanyForUser } from "@/lib/company";
import { WORK_ORDER_STATUS_LABELS, type WorkOrderStatus } from "@/lib/work-order";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatEur } from "@/lib/utils";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Phone, Mail, MapPin, Wrench } from "lucide-react";
import { WorkOrderActions } from "./work-order-actions";
import { AddItemForm } from "./add-item-form";
import { SignaturePad } from "./signature-pad";
import { GenerateInvoiceButton } from "./generate-invoice-button";

export const dynamic = "force-dynamic";

export const metadata = { title: "Werkorder — Monteur" };

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen");
  if (!hasMonteurAccess(user)) redirect("/monteur/dashboard");

  const company = await getOrCreateCompanyForUser(user);
  const { id } = await params;

  const workOrder = await prisma.workOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      machine: true,
      items: { include: { part: true } },
      technician: { select: { name: true, email: true } },
      invoice: true,
    },
  });

  if (!workOrder || workOrder.companyId !== company.id) notFound();

  const itemsTotal = workOrder.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const total = itemsTotal + workOrder.calloutFeeEur;
  const status = workOrder.status as WorkOrderStatus;
  const canShowSignature = !["NEW", "PRE_DIAGNOSIS", "SCHEDULED", "ON_THE_WAY"].includes(status);

  return (
    <DashboardLayout role={user.role}>
      <Link href="/monteur/werkorders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3 w-3" /> Terug naar werkorders
      </Link>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="font-heading text-2xl font-bold font-mono">{workOrder.number}</h1>
        <Badge>{WORK_ORDER_STATUS_LABELS[status] ?? workOrder.status}</Badge>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardContent className="p-5">
              <h2 className="font-heading font-semibold mb-2">Klacht</h2>
              <p className="text-sm text-muted-foreground">{workOrder.complaint}</p>
              {workOrder.aiDiagnosis && (
                <>
                  <h3 className="font-heading font-semibold mt-4 mb-1 text-sm">AI pre-diagnose</h3>
                  <p className="text-sm text-muted-foreground">{workOrder.aiDiagnosis}</p>
                </>
              )}
            </CardContent>
          </Card>

          <WorkOrderActions workOrderId={workOrder.id} status={status} technicianNote={workOrder.technicianNote} />

          <Card>
            <CardContent className="p-5">
              <h2 className="font-heading font-semibold mb-3">Onderdelen & werkzaamheden</h2>
              {workOrder.items.length === 0 ? (
                <p className="text-sm text-muted-foreground mb-3">Nog geen regels toegevoegd.</p>
              ) : (
                <div className="space-y-2 mb-3">
                  {workOrder.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                      <span>{item.quantity}× {item.description}</span>
                      <span className="font-medium">{formatEur(item.unitPrice * item.quantity)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-muted-foreground">Voorrijkosten</span>
                <span>{formatEur(workOrder.calloutFeeEur)}</span>
              </div>
              <div className="flex items-center justify-between font-semibold pt-2 border-t">
                <span>Totaal</span>
                <span>{formatEur(total)}</span>
              </div>
              <AddItemForm workOrderId={workOrder.id} />
            </CardContent>
          </Card>

          {canShowSignature && (
            <SignaturePad workOrderId={workOrder.id} existingSignatureUrl={workOrder.signatureUrl} />
          )}

          {status === "COMPLETED" && !workOrder.invoice && (
            <Card>
              <CardContent className="p-5 flex items-center justify-between">
                <div>
                  <h2 className="font-heading font-semibold">Klaar om te factureren</h2>
                  <p className="text-sm text-muted-foreground">Genereert een factuur van {formatEur(total)} op basis van de regels hierboven.</p>
                </div>
                <GenerateInvoiceButton workOrderId={workOrder.id} />
              </CardContent>
            </Card>
          )}

          {workOrder.invoice && (
            <Card>
              <CardContent className="p-5 flex items-center justify-between">
                <div>
                  <h2 className="font-heading font-semibold">Factuur {workOrder.invoice.number}</h2>
                  <p className="text-sm text-muted-foreground">{formatEur(workOrder.invoice.totalEur)} — {WORK_ORDER_STATUS_LABELS[status] ?? status}</p>
                </div>
                <Link href={`/monteur/facturen/${workOrder.invoice.id}`} className="text-sm text-primary hover:underline">Bekijk factuur →</Link>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="p-5">
              <h2 className="font-heading font-semibold mb-3">Klant</h2>
              <p className="font-medium mb-2">
                <Link href={`/monteur/klanten/${workOrder.customerId}`} className="hover:text-primary">{workOrder.customer.name}</Link>
              </p>
              <div className="space-y-1 text-sm text-muted-foreground">
                {workOrder.customer.email && <p className="flex items-center gap-2"><Mail className="h-3 w-3" /> {workOrder.customer.email}</p>}
                {workOrder.customer.phone && <p className="flex items-center gap-2"><Phone className="h-3 w-3" /> {workOrder.customer.phone}</p>}
                {workOrder.customer.addressLine && (
                  <p className="flex items-center gap-2"><MapPin className="h-3 w-3" /> {workOrder.customer.addressLine}{workOrder.customer.city ? `, ${workOrder.customer.city}` : ""}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {workOrder.machine && (
            <Card>
              <CardContent className="p-5">
                <h2 className="font-heading font-semibold mb-2 flex items-center gap-2"><Wrench className="h-4 w-4" /> Apparaat</h2>
                <p className="text-sm">{workOrder.machine.brand} {workOrder.machine.model}</p>
                {workOrder.machine.serialNumber && <p className="text-xs text-muted-foreground">SN: {workOrder.machine.serialNumber}</p>}
              </CardContent>
            </Card>
          )}

          {workOrder.technician && (
            <Card>
              <CardContent className="p-5">
                <h2 className="font-heading font-semibold mb-2">Toegewezen monteur</h2>
                <p className="text-sm">{workOrder.technician.name ?? workOrder.technician.email}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
