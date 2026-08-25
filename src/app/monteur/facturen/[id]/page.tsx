import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { hasMonteurAccess, getOrCreateCompanyForUser } from "@/lib/company";
import { Card, CardContent } from "@/components/ui/card";
import { formatEur, formatDate } from "@/lib/utils";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

export const metadata = { title: "Factuur — Monteur" };

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen");
  if (!hasMonteurAccess(user)) redirect("/monteur/dashboard");

  const company = await getOrCreateCompanyForUser(user);
  const { id } = await params;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { items: true, customer: true, workOrder: true },
  });

  if (!invoice || invoice.companyId !== company.id) notFound();

  return (
    <DashboardLayout role={user.role}>
      <div className="print:hidden flex items-center justify-between mb-6">
        <Link href={invoice.workOrderId ? `/monteur/werkorders/${invoice.workOrderId}` : "/monteur/werkorders"} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Terug naar werkorder
        </Link>
        {/* A print button is the pragmatic MVP for "PDF" until a PDF lib is wired up — browsers render this page to PDF via print. */}
        <PrintButton />
      </div>

      <Card className="print:shadow-none print:border-none">
        <CardContent className="p-8">
          <div className="flex justify-between items-start mb-8">
            <div>
              <h1 className="font-heading text-2xl font-bold">{company.name}</h1>
              {company.addressLine && <p className="text-sm text-muted-foreground">{company.addressLine}, {company.postalCode} {company.city}</p>}
              {company.kvkNumber && <p className="text-sm text-muted-foreground">KvK: {company.kvkNumber}</p>}
              {company.vatNumber && <p className="text-sm text-muted-foreground">BTW: {company.vatNumber}</p>}
            </div>
            <div className="text-right">
              <h2 className="font-heading text-xl font-bold font-mono">{invoice.number}</h2>
              <p className="text-sm text-muted-foreground">{formatDate(invoice.issuedAt)}</p>
            </div>
          </div>

          <div className="mb-8">
            <p className="text-xs uppercase text-muted-foreground mb-1">Factuur aan</p>
            <p className="font-medium">{invoice.customer.name}</p>
            {invoice.customer.addressLine && <p className="text-sm text-muted-foreground">{invoice.customer.addressLine}, {invoice.customer.postalCode} {invoice.customer.city}</p>}
          </div>

          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2">Omschrijving</th>
                <th className="py-2 text-right">Aantal</th>
                <th className="py-2 text-right">Prijs</th>
                <th className="py-2 text-right">BTW</th>
                <th className="py-2 text-right">Totaal</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => (
                <tr key={item.id} className="border-b">
                  <td className="py-2">{item.description}</td>
                  <td className="py-2 text-right">{item.quantity}</td>
                  <td className="py-2 text-right">{formatEur(item.unitPrice)}</td>
                  <td className="py-2 text-right">{Math.round(item.vatRate * 100)}%</td>
                  <td className="py-2 text-right">{formatEur(item.unitPrice * item.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotaal</span><span>{formatEur(invoice.subtotalEur)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">BTW</span><span>{formatEur(invoice.vatEur)}</span></div>
              <div className="flex justify-between font-bold pt-2 border-t"><span>Totaal</span><span>{formatEur(invoice.totalEur)}</span></div>
            </div>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
