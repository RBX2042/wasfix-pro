import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import Link from "next/link";
import { formatEur, formatDate } from "@/lib/utils";
import { Landmark, FileText } from "lucide-react";
import { confirmBankTransferPaid } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin: bestellingen" };

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "secondary" | "default"> = {
  PENDING: "warning",
  OPENSTAAND: "warning",
  PAID: "success",
  SHIPPED: "default",
  DELIVERED: "success",
  CANCELLED: "danger",
};

export default async function AdminOrdersPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const hasDb = isDatabaseConfigured();
  const orders = hasDb
    ? await prisma.order
        .findMany({
          orderBy: [{ status: "asc" }, { createdAt: "desc" }],
          take: 100,
          include: { items: true },
        })
        .catch(() => [])
    : [];

  const openInvoices = orders.filter((o) => o.status === "OPENSTAAND" && o.paymentMethod === "BANK_TRANSFER");
  const overdue = openInvoices.filter((o) => o.dueAt && o.dueAt < new Date());

  return (
    <DashboardLayout role={user.role}>
      <h1 className="font-heading text-2xl font-bold mb-1">Bestellingen</h1>
      <p className="text-muted-foreground text-sm mb-6">
        {hasDb
          ? `${openInvoices.length} openstaande factuur${openInvoices.length === 1 ? "" : "en"}${overdue.length > 0 ? ` — ${overdue.length} te laat` : ""}`
          : "Geen database geconfigureerd."}
      </p>

      {!hasDb ? (
        <Card><CardContent className="p-12 text-center text-muted-foreground">Stel DATABASE_URL in om bestellingen te beheren.</CardContent></Card>
      ) : orders.length === 0 ? (
        <Card><CardContent className="p-12 text-center text-muted-foreground">Nog geen bestellingen.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const isOpenInvoice = o.status === "OPENSTAAND" && o.paymentMethod === "BANK_TRANSFER";
            const isOverdue = isOpenInvoice && o.dueAt !== null && o.dueAt < new Date();
            return (
              <Card key={o.id} className={isOverdue ? "border-red-500/40" : ""}>
                <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-mono text-sm font-semibold">#{o.id.slice(0, 8).toUpperCase()}</span>
                      <Badge variant={STATUS_VARIANT[o.status] ?? "secondary"}>{o.status}</Badge>
                      {o.paymentMethod === "BANK_TRANSFER" && (
                        <Badge variant="secondary"><Landmark className="h-3 w-3 mr-1 inline" />Op rekening</Badge>
                      )}
                      {isOverdue && <Badge variant="danger">Te laat</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {o.email} · {o.items.length} {o.items.length === 1 ? "item" : "items"} · {formatEur(o.totalEur)}
                      {o.dueAt && isOpenInvoice ? ` · vervalt ${formatDate(o.dueAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button asChild variant="ghost" size="sm" className="text-xs">
                      <Link href={`/bestelling/${o.id}/factuur`}><FileText className="h-3 w-3" /> Factuur</Link>
                    </Button>
                    {isOpenInvoice && (
                      <form action={confirmBankTransferPaid}>
                        <input type="hidden" name="orderId" value={o.id} />
                        <Button type="submit" size="sm" className="text-xs">Markeer betaald</Button>
                      </form>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </DashboardLayout>
  );
}
