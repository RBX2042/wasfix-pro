import Link from "next/link";
import { restockedFromNotes } from "@/lib/invoicing";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ORDER_STATUS_LABEL, isOrderStatus, orderRef } from "@/lib/order-status";
import { AdminShell } from "../_lib/page-shell";
import { AdminNav } from "../_lib/admin-nav";
import { dateNl, dateTimeNl, eur, stripeDashboardUrl } from "../_lib/format";
import { RETURN_WINDOW_DAYS, RMA_LABEL, RMA_OPEN, realReturnAddress } from "../_lib/rma";
import { ApproveForm, CloseForm, LinkForm, ReceivedForm, RefundRmaForm, RejectForm } from "./rma-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin: retouren" };

const REASON: Record<string, string> = {
  DEFECT: "Defect of beschadigd",
  WRONG_PART: "Verkeerd onderdeel geleverd",
  WRONG_ORDER: "Verkeerd besteld",
  WITHDRAWAL: "Bedenktijd (herroeping)",
  OTHER: "Anders",
};
const VARIANT: Record<string, "success" | "warning" | "danger" | "secondary" | "default"> = {
  RECEIVED: "warning",
  APPROVED: "default",
  RETURN_RECEIVED: "default",
  REFUNDED: "success",
  REJECTED: "danger",
};

export default async function AdminReturnsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");
  const view = (await searchParams).view === "afgerond" ? "afgerond" : (await searchParams).view === "alles" ? "alles" : "open";

  if (!isDatabaseConfigured()) {
    return (
      <DashboardLayout role={user.role}>
      <AdminShell>
        <AdminNav current="/admin/retouren" />
        <Card><CardContent className="p-12 text-center text-muted-foreground">Stel DATABASE_URL in om retouren te beheren.</CardContent></Card>
      </AdminShell>
    </DashboardLayout>
    );
  }

  const open = [...RMA_OPEN];
  const where = view === "open" ? { status: { in: open } } : view === "afgerond" ? { status: { notIn: open } } : {};
  const [openCount, doneCount, rmas] = await Promise.all([
    prisma.rmaRequest.count({ where: { status: { in: open } } }),
    prisma.rmaRequest.count({ where: { status: { notIn: open } } }),
    prisma.rmaRequest.findMany({
      where,
      orderBy: { createdAt: view === "open" ? "asc" : "desc" },
      take: 50,
      include: {
        order: {
          select: {
            id: true, status: true, paymentMethod: true, totalEur: true, refundedEur: true, deliveredAt: true, shippedAt: true, paidAt: true,
            stripePaymentIntentId: true,
            invoice: { select: { number: true, creditNotes: { select: { linesJson: true } } } },
            items: { select: { partId: true, quantity: true, part: { select: { sku: true, name: true } } } },
          },
        },
      },
    }),
  ]);
  const hasAddress = realReturnAddress() !== null;
  const tabs = [
    { key: "open", label: `Open (${openCount})` },
    { key: "afgerond", label: `Afgerond (${doneCount})` },
    { key: "alles", label: "Alles" },
  ];

  return (
    <DashboardLayout role={user.role}>
      <AdminShell>
      <AdminNav current="/admin/retouren" />
      <h1 className="font-heading text-2xl font-bold mb-1">Retouren</h1>
      <p className="text-sm text-muted-foreground mb-4">Goedkeuren stuurt de klant het retouradres; terugbetalen boekt een creditnota en mailt de klant.</p>
      <div className="mb-5 flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <Link key={t.key} href={`/admin/retouren${t.key === "open" ? "" : `?view=${t.key}`}`} className={`rounded-full border px-3 py-1 text-sm ${view === t.key ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {rmas.length === 0 ? (
        <Card><CardContent className="p-12 text-center text-muted-foreground">Geen retouren in deze weergave.</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {rmas.map((r) => {
            const o = r.order;
            const oStatus = o && isOrderStatus(o.status) ? o.status : null;
            const base = o ? (o.deliveredAt ?? o.shippedAt) : null;
            const until = base ? new Date(base.getTime() + RETURN_WINDOW_DAYS * 86_400_000) : null;
            const late = until !== null && until < r.createdAt;
            const remaining = o ? Math.round((o.totalEur - o.refundedEur) * 100) / 100 : 0;
            const stripeUrl = stripeDashboardUrl(o?.stripePaymentIntentId);
            const refundable = !!o && (o.status === "PAID" || o.status === "SHIPPED" || o.status === "DELIVERED") && remaining > 0;
            const how = o?.paymentMethod === "STRIPE" && o.stripePaymentIntentId ? "Het bedrag wordt via Stripe teruggestort." : "Je betaalt het bedrag zelf per bank terug; dit systeem verstuurt geen geld.";
            return (
              <Card key={r.id} data-rma={r.rmaNumber}>
                <CardContent className="p-4 space-y-3 min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{r.rmaNumber}</span>
                        <Badge variant={VARIANT[r.status] ?? "secondary"}>{RMA_LABEL[r.status] ?? r.status}</Badge>
                        {!o && <Badge variant="danger">NIET GEKOPPELD</Badge>}
                        {late && <Badge variant="warning">buiten de retourtermijn</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">Aangevraagd {dateTimeNl(r.createdAt)}{r.resolvedAt && ` · afgehandeld ${dateNl(r.resolvedAt)}`}{r.refundEur != null && ` · terugbetaald ${eur(r.refundEur)}`}</p>
                    </div>
                    <p className="text-sm font-medium">{REASON[r.reason] ?? r.reason}</p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="min-w-0 text-sm break-words">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Klant</p>
                      <p className="font-medium">{r.name}</p>
                      <a className="underline" href={`mailto:${r.email}`}>{r.email}</a>
                      <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/40 p-2">{r.notes}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Ingevuld bestelnummer: <span className="font-mono">{r.orderId}</span></p>
                    </div>
                    <div className="min-w-0 text-sm">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Bestelling</p>
                      {o && oStatus ? (
                        <>
                          <div>
                            <Link className="underline font-mono" href={`/admin/bestellingen?q=${orderRef(o.id)}`}>#{orderRef(o.id)}</Link>
                            {o.invoice && <span className="font-mono"> · factuur {o.invoice.number}</span>}
                            {" "}<Badge variant="outline">{ORDER_STATUS_LABEL[oStatus]}</Badge>
                          </div>
                          <p className="text-muted-foreground">{eur(o.totalEur)}{o.refundedEur > 0 && `, al terugbetaald ${eur(o.refundedEur)}`}</p>
                          <p className="text-muted-foreground">
                            {o.deliveredAt ? `Afgeleverd ${dateNl(o.deliveredAt)}` : o.shippedAt ? `Verzonden ${dateNl(o.shippedAt)} (aflevering niet bevestigd)` : "Nog niet verzonden"}
                            {until && ` · retourtermijn tot ${dateNl(until)}`}
                          </p>
                          <ul className="mt-1 space-y-0.5">
                            {o.items.map((i) => <li key={i.partId} className="truncate"><span className="tabular-nums">{i.quantity}×</span> <span className="font-mono text-xs">{i.part.sku}</span> <span className="text-muted-foreground">{i.part.name}</span></li>)}
                          </ul>
                          {stripeUrl && <p className="mt-1 text-xs">Stripe: <a className="underline" href={stripeUrl} target="_blank" rel="noreferrer noopener">{o.stripePaymentIntentId}</a></p>}
                        </>
                      ) : (
                        <p className="text-amber-700 dark:text-amber-400">Het bestelnummer of e-mailadres klopte niet met een bestelling. Controleer het zelf en koppel handmatig; terugbetalen kan pas na koppelen.</p>
                      )}
                    </div>
                  </div>

                  {r.adminNote && <p className="text-xs text-muted-foreground">Notitie: {r.adminNote}</p>}

                  <div className="grid gap-3 md:grid-cols-2">
                    {r.status === "RECEIVED" && <ApproveForm id={r.id} weBearCosts={r.reason === "DEFECT" || r.reason === "WRONG_PART"} hasAddress={hasAddress} />}
                    {(r.status === "RECEIVED" || r.status === "APPROVED" || r.status === "RETURN_RECEIVED") && <RejectForm id={r.id} />}
                    {r.status === "APPROVED" && <ReceivedForm id={r.id} />}
                    {(r.status === "APPROVED" || r.status === "RETURN_RECEIVED") && o && refundable && (
                      <RefundRmaForm
                        id={r.id}
                        remainingEur={remaining}
                        expectedRefundedEur={o.refundedEur}
                        items={o.items.map((i) => ({ partId: i.partId, sku: i.part.sku, quantity: Math.max(0, i.quantity - (restockedFromNotes(o.invoice?.creditNotes ?? []).get(i.partId) ?? 0)) }))}
                        canRestock={o.status === "SHIPPED" || o.status === "DELIVERED"}
                        how={how}
                      />
                    )}
                    {(r.status === "APPROVED" || r.status === "RETURN_RECEIVED") && o && !refundable && (
                      <p className="text-sm text-muted-foreground">Bij deze bestelling valt niets meer terug te betalen (status {oStatus ? ORDER_STATUS_LABEL[oStatus] : o.status}, al terugbetaald {eur(o.refundedEur)}).</p>
                    )}
                    {(r.status === "APPROVED" || r.status === "RETURN_RECEIVED") && o && o.refundedEur > 0 && !refundable && <CloseForm id={r.id} refundedEur={eur(o.refundedEur)} />}
                    {r.status === "REFUNDED" && r.refundEur == null && (
                      <p className="text-sm text-amber-700 dark:text-amber-400">Deze retour staat op Terugbetaald, maar hier is geen terugbetaling geboekt (waarschijnlijk met de losse knoppen onder Aanvragen gezet). Controleer of er een creditnota bij de bestelling staat.</p>
                    )}
                    {!o && r.status !== "REFUNDED" && r.status !== "REJECTED" && <LinkForm id={r.id} />}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </AdminShell>
    </DashboardLayout>
  );
}
