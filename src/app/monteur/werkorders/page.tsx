import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser, hasProAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Calendar, MapPin, ClipboardList } from "lucide-react";
import { formatEur } from "@/lib/utils";
import { setWorkOrderStatus } from "../_lib/actions";
import { DeleteWorkOrderButton, EditWorkOrderButton, NewWorkOrderButton, type WorkOrderRow } from "./workorder-forms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Werkorders — Monteur" };

const STATUS_VARIANT: Record<string, "danger" | "warning" | "default" | "success" | "secondary"> = {
  OPEN: "danger",
  WACHT_OP_ONDERDEEL: "warning",
  GEPLAND: "default",
  VOLTOOID: "success",
  GEANNULEERD: "secondary",
};

/** Next sensible status, so the list offers one-click progress. */
const NEXT_STATUS: Record<string, string> = {
  OPEN: "GEPLAND",
  GEPLAND: "WACHT_OP_ONDERDEEL",
  WACHT_OP_ONDERDEEL: "VOLTOOID",
  VOLTOOID: "OPEN",
  GEANNULEERD: "OPEN",
};

export default async function WerkordersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen?next=/monteur/werkorders");

  if (!hasProAccess(user)) {
    return (
      <DashboardLayout role={user.role}>
        <Card>
          <CardContent className="p-12 text-center">
            <ClipboardList className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
            <h2 className="font-heading text-xl font-bold mb-2">Monteur Pro vereist</h2>
            <p className="text-muted-foreground mb-4">Werkorders zijn beschikbaar voor Monteur Pro abonnees.</p>
            <Button asChild><Link href="/prijzen">Bekijk Monteur Pro</Link></Button>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  const hasDb = isDatabaseConfigured();
  let orders: Array<WorkOrderRow & { customer: { name: string; city: string | null } | null }> = [];
  let customers: Array<{ id: string; name: string }> = [];

  if (hasDb) {
    const [rows, customerRows] = await Promise.all([
      prisma.workOrder
        .findMany({
          where: { ownerId: user.id },
          orderBy: [{ status: "asc" }, { createdAt: "desc" }],
          include: { customer: { select: { name: true, city: true } } },
        })
        .catch(() => []),
      prisma.customer.findMany({ where: { ownerId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }).catch(() => []),
    ]);
    orders = rows.map((o) => ({ ...o, scheduledAt: o.scheduledAt ? o.scheduledAt.toISOString() : null }));
    customers = customerRows;
  }

  const active = orders.filter((o) => o.status !== "VOLTOOID" && o.status !== "GEANNULEERD");

  return (
    <DashboardLayout role={user.role}>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">Werkorders</h1>
          <p className="text-muted-foreground text-sm">
            {hasDb ? `${active.length} actieve ${active.length === 1 ? "werkorder" : "werkorders"} van ${orders.length} totaal` : "Werkorders vereisen een database"}
          </p>
        </div>
        {hasDb && <NewWorkOrderButton customers={customers} />}
      </div>

      {!hasDb ? (
        <Card>
          <CardContent className="p-12 text-center">
            <ClipboardList className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">
              Stel <code className="bg-muted px-1 rounded text-xs">DATABASE_URL</code> in om werkorders op te slaan. Zie BLOCKED.md.
            </p>
          </CardContent>
        </Card>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <ClipboardList className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground mb-4">Nog geen werkorders. Maak er een aan zodra je een klus inplant.</p>
            <NewWorkOrderButton customers={customers} />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {orders.map((w) => (
            <Card key={w.id} className={w.urgent && w.status !== "VOLTOOID" ? "border-red-500/40" : ""}>
              <CardContent className="p-5">
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-mono font-bold text-sm">{w.reference}</span>
                      <Badge variant={STATUS_VARIANT[w.status] ?? "secondary"}>{w.status.replace(/_/g, " ")}</Badge>
                      {w.urgent && w.status !== "VOLTOOID" && <Badge variant="danger">Urgent</Badge>}
                      {w.errorCode && <Badge variant="outline">{w.errorCode}</Badge>}
                    </div>
                    <h3 className="font-heading font-semibold">{w.customer?.name ?? "Geen klant gekoppeld"}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {[w.machine, w.problem].filter(Boolean).join(" — ")}
                    </p>
                    <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-muted-foreground">
                      {w.scheduledAt && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" /> {new Date(w.scheduledAt).toLocaleDateString("nl-NL")}
                        </span>
                      )}
                      {w.customer?.city && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {w.customer.city}</span>}
                      {w.priceEur != null && <span className="font-medium text-foreground">{formatEur(w.priceEur)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <form action={setWorkOrderStatus}>
                      <input type="hidden" name="id" value={w.id} />
                      <input type="hidden" name="status" value={NEXT_STATUS[w.status] ?? "OPEN"} />
                      <Button type="submit" variant="ghost" size="sm" className="text-xs">
                        → {(NEXT_STATUS[w.status] ?? "OPEN").replace(/_/g, " ")}
                      </Button>
                    </form>
                    <EditWorkOrderButton order={w} customers={customers} />
                    <DeleteWorkOrderButton id={w.id} reference={w.reference} />
                  </div>
                </div>
                {w.notes && <p className="text-xs text-muted-foreground mt-3 border-t pt-2">{w.notes}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
