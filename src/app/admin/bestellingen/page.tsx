import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ORDER_STATUS_LABEL, holdsStock, isOrderStatus, orderRef, type OrderStatus } from "@/lib/order-status";
import { carrierLabel, trackingUrl } from "@/lib/emails/tracking";
import { FileText, Landmark, Printer, Search } from "lucide-react";
import { AdminShell } from "../_lib/page-shell";
import { AdminNav } from "../_lib/admin-nav";
import { dateNl, dateTimeNl, eur, parseShippingAddress, stripeDashboardUrl } from "../_lib/format";
import { ORDER_VIEWS, VIEW_LABEL, isOrderView, listOrders, orderCounts, type OrderRow, type OrderView } from "../_lib/orders-query";
import { CancelForm, DeliverForm, MarkPaidForm, RefundForm, ShipForm, TrackingForm } from "./order-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin: bestellingen" };

const STATUS_VARIANT: Record<OrderStatus, "success" | "warning" | "danger" | "secondary" | "default"> = {
  PENDING: "secondary",
  OPENSTAAND: "warning",
  PAID: "success",
  SHIPPED: "default",
  DELIVERED: "success",
  CANCELLED: "danger",
};

type SP = { view?: string; q?: string; page?: string };

function href(view: OrderView, q: string, page: number) {
  const p = new URLSearchParams();
  if (view !== "te-verzenden") p.set("view", view);
  if (q) p.set("q", q);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return `/admin/bestellingen${s ? `?${s}` : ""}`;
}

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const sp = await searchParams;
  const view: OrderView = isOrderView(sp.view) ? sp.view : "te-verzenden";
  const q = (sp.q ?? "").trim().slice(0, 200);
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  if (!isDatabaseConfigured()) {
    return (
      <DashboardLayout role={user.role}>
      <AdminShell>
        <AdminNav current="/admin/bestellingen" />
        <Card><CardContent className="p-12 text-center text-muted-foreground">Stel DATABASE_URL in om bestellingen te beheren.</CardContent></Card>
      </AdminShell>
    </DashboardLayout>
    );
  }

  const now = new Date();
  const [counts, listing] = await Promise.all([orderCounts(now), listOrders({ view, q, page })]);

  return (
    <DashboardLayout role={user.role}>
      <AdminShell>
      <AdminNav current="/admin/bestellingen" />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-bold">Bestellingen</h1>
          <p className="text-sm text-muted-foreground">
            {counts["te-verzenden"]} te verzenden · {counts["te-betalen"]} wachten op betaling
            {counts.overdue > 0 && <span className="text-red-600 font-medium"> ({counts.overdue} te laat)</span>}
            {counts.shipLate > 0 && <span className="text-amber-600 font-medium"> · {counts.shipLate} betaald en al meer dan 2 dagen niet verzonden</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link href="/admin/bestellingen/pick"><Printer className="h-4 w-4" /> Pick-lijst</Link></Button>
        </div>
      </div>

      <form method="get" action="/admin/bestellingen" role="search" className="mb-4 flex gap-2">
        <input type="hidden" name="view" value={view} />
        <label className="sr-only" htmlFor="q">Zoeken</label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Bankregel (2026-00002 EUR 34,45), bestelnr, e-mail, naam"
          className="w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm"
        />
        <Button type="submit" size="sm"><Search className="h-4 w-4" /> Zoek</Button>
        {q && <Button asChild variant="ghost" size="sm"><Link href={href(view, "", 1)}>Wis</Link></Button>}
      </form>

      <div className="mb-5 flex flex-wrap gap-1.5" role="tablist" aria-label="Weergave">
        {ORDER_VIEWS.map((v) => (
          <Link
            key={v}
            href={href(v, "", 1)}
            role="tab"
            aria-selected={!q && v === view}
            className={`rounded-full border px-3 py-1 text-sm ${!q && v === view ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}
          >
            {VIEW_LABEL[v]} <span className="tabular-nums opacity-80">({counts[v]})</span>
          </Link>
        ))}
      </div>

      {q && (
        <p className="mb-3 text-sm text-muted-foreground">
          {listing.mode === "search-loose"
            ? `Geen bestelling past op alles wat je invulde. Dit zijn bestellingen die op minstens één onderdeel passen (klopt het bedrag of het kenmerk wel?): ${listing.total}.`
            : `${listing.total} resultaat${listing.total === 1 ? "" : "en"} in alle bestellingen.`}
        </p>
      )}

      {listing.rows.length === 0 ? (
        <Card><CardContent className="p-12 text-center text-muted-foreground">{q ? "Niets gevonden." : view === "te-verzenden" ? "Geen betaalde bestellingen die nog verzonden moeten worden." : "Geen bestellingen in deze weergave."}</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {listing.rows.map((o) => <OrderCard key={o.id} order={o} now={now} />)}
        </div>
      )}

      {listing.pages > 1 && (
        <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Paginering">
          {listing.page > 1 ? <Link className="underline" href={href(view, q, listing.page - 1)}>← Vorige</Link> : <span />}
          <span className="text-muted-foreground">Pagina {listing.page} van {listing.pages}</span>
          {listing.page < listing.pages ? <Link className="underline" href={href(view, q, listing.page + 1)}>Volgende →</Link> : <span />}
        </nav>
      )}
    </AdminShell>
    </DashboardLayout>
  );
}

function OrderCard({ order: o, now }: { order: OrderRow; now: Date }) {
  const status: OrderStatus = isOrderStatus(o.status) ? o.status : "PENDING";
  const addr = parseShippingAddress(o.shippingAddress);
  const bank = o.paymentMethod === "BANK_TRANSFER";
  const overdue = status === "OPENSTAAND" && bank && o.dueAt !== null && o.dueAt < now;
  const daysLate = overdue && o.dueAt ? Math.max(1, Math.floor((now.getTime() - o.dueAt.getTime()) / 86_400_000)) : 0;
  const remaining = Math.round((o.totalEur - o.refundedEur) * 100) / 100;
  const credited = o.invoice?.creditNotes ?? [];
  const track = o.trackingCode ? trackingUrl(o.carrier, o.trackingCode, addr.postalCode) : null;
  const stripeUrl = stripeDashboardUrl(o.stripePaymentIntentId);

  const cancelConsequences: string[] = [];
  if (holdsStock(status)) cancelConsequences.push("De onderdelen gaan terug op voorraad.");
  else cancelConsequences.push("Er was nog geen voorraad gereserveerd.");
  if (o.invoice) cancelConsequences.push("De factuur blijft staan; er wordt een creditnota uitgegeven (CN-nummer, zelfde transactie).");
  if (status === "PAID") {
    cancelConsequences.push(
      o.paymentMethod === "STRIPE"
        ? `${eur(remaining)} wordt via Stripe teruggestort${o.stripePaymentIntentId ? "" : " (niet automatisch mogelijk: geen Stripe-betaling vastgelegd, betaal zelf terug in het Stripe-dashboard)"}.`
        : `Jij betaalt ${eur(remaining)} per bank terug; dit systeem verstuurt geen geld.`,
    );
  }
  cancelConsequences.push("De klant krijgt een e-mail.");

  const refundHow =
    o.paymentMethod === "STRIPE" && o.stripePaymentIntentId
      ? "Het bedrag wordt via Stripe teruggestort en er wordt een creditnota uitgegeven."
      : "Er wordt een creditnota uitgegeven. Betaal het bedrag zelf per bank terug; dit systeem verstuurt geen geld.";

  return (
    <Card className={overdue ? "border-red-500/50" : ""} data-order={o.id}>
      <CardContent className="p-4 space-y-3 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold">#{orderRef(o.id)}</span>
              {o.invoice && <span className="font-mono text-sm" title="Factuurnummer: dit staat op het bankafschrift">Factuur {o.invoice.number}</span>}
              <Badge variant={STATUS_VARIANT[status]}>{ORDER_STATUS_LABEL[status]}</Badge>
              {bank ? <Badge variant="secondary"><Landmark className="h-3 w-3 mr-1 inline" />Op rekening</Badge> : <Badge variant="outline">Stripe (kaart/iDEAL)</Badge>}
              {overdue && <Badge variant="danger">{daysLate} dag{daysLate === 1 ? "" : "en"} te laat</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              Besteld {dateTimeNl(o.createdAt)}
              {o.paidAt && ` · betaald ${dateNl(o.paidAt)}`}
              {o.shippedAt && ` · verzonden ${dateNl(o.shippedAt)}`}
              {o.deliveredAt && ` · afgeleverd ${dateNl(o.deliveredAt)}`}
              {o.cancelledAt && ` · geannuleerd ${dateNl(o.cancelledAt)}`}
              {status === "OPENSTAAND" && o.dueAt && ` · vervalt ${dateNl(o.dueAt)}`}
            </p>
          </div>
          <div className="text-right">
            <p className="font-heading text-xl font-bold tabular-nums">{eur(o.totalEur)}</p>
            {o.refundedEur > 0 && <p className="text-xs text-muted-foreground">waarvan terugbetaald {eur(o.refundedEur)}</p>}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="min-w-0 text-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Verzenden naar</p>
            <address className="not-italic break-words">
              <p className="font-medium">{addr.name || "(naam onbekend)"}</p>
              {addr.street && <p>{addr.street}</p>}
              <p>{[addr.postalCode, addr.city].filter(Boolean).join(" ")}</p>
              <p>{addr.country}</p>
            </address>
            <p className="mt-1 break-words"><a className="underline" href={`mailto:${o.email}`}>{o.email}</a>{o.phone && <> · <a className="underline" href={`tel:${o.phone}`}>{o.phone}</a></>}</p>
            {o.customerNote && <p className="mt-2 rounded-md bg-amber-50 dark:bg-amber-950/30 p-2 text-sm break-words"><span className="font-medium">Opmerking klant:</span> {o.customerNote}</p>}
            {o.vatNumber && <p className="mt-1 text-xs text-muted-foreground">Btw-nummer klant: {o.vatNumber}</p>}
          </div>

          <div className="min-w-0 text-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Inhoud ({o.items.reduce((s, i) => s + i.quantity, 0)} stuks)</p>
            <ul className="space-y-1">
              {o.items.map((i) => (
                <li key={i.id} className="flex items-baseline gap-2 min-w-0">
                  <span className="tabular-nums font-semibold w-8 shrink-0">{i.quantity}×</span>
                  <span className="font-mono text-xs shrink-0">{i.part.sku}</span>
                  <span className="truncate text-muted-foreground">{i.part.name}</span>
                  {status === "PAID" && i.part.stock < 0 && <Badge variant="danger">voorraad {i.part.stock}</Badge>}
                </li>
              ))}
            </ul>
            <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-4 text-xs text-muted-foreground tabular-nums">
              <dt>Subtotaal</dt><dd className="text-right">{eur(o.subtotalEur)}</dd>
              {o.discountEur > 0 && <><dt>Korting</dt><dd className="text-right">-{eur(o.discountEur)}</dd></>}
              <dt>Verzending</dt><dd className="text-right">{eur(o.shippingEur)}</dd>
              <dt>Waarvan btw</dt><dd className="text-right">{eur(o.vatEur)}</dd>
            </dl>
          </div>
        </div>

        {(o.trackingCode || stripeUrl || credited.length > 0) && (
          <div className="text-xs text-muted-foreground space-y-0.5 break-words">
            {o.trackingCode && (
              <p>
                {carrierLabel(o.carrier)}: <span className="font-mono">{o.trackingCode}</span>
                {track && <> · <a className="underline" href={track} target="_blank" rel="noreferrer noopener">volg zending</a></>}
              </p>
            )}
            {stripeUrl && <p>Stripe-betaling: <a className="underline" href={stripeUrl} target="_blank" rel="noreferrer noopener">{o.stripePaymentIntentId}</a></p>}
            {credited.length > 0 && <p>Creditnota&rsquo;s: {credited.map((c) => `${c.number} (${eur(c.totalEur)})`).join(", ")}</p>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {o.invoice && <Button asChild variant="ghost" size="sm" className="text-xs"><Link href={`/bestelling/${o.id}/factuur`}><FileText className="h-3 w-3" /> Factuur</Link></Button>}
          {(status === "PAID" || status === "SHIPPED" || status === "DELIVERED") && (
            <Button asChild variant="ghost" size="sm" className="text-xs"><Link href={`/admin/bestellingen/${o.id}/pakbon`}><Printer className="h-3 w-3" /> Pakbon</Link></Button>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {status === "OPENSTAAND" && bank && <MarkPaidForm orderId={o.id} totalLabel={eur(o.totalEur)} />}
          {status === "CANCELLED" && bank && credited.length === 0 && <MarkPaidForm orderId={o.id} totalLabel={eur(o.totalEur)} late />}
          {status === "CANCELLED" && bank && credited.length > 0 && (
            <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
              Deze bestelling is geannuleerd en de factuur is gecrediteerd ({credited.map((c) => c.number).join(", ")}). Komt er toch nog een betaling binnen, dan kan de bestelling niet worden hersteld: betaal het bedrag terug of laat de klant opnieuw bestellen.
            </p>
          )}
          {status === "PAID" && <ShipForm orderId={o.id} />}
          {status === "SHIPPED" && <DeliverForm orderId={o.id} />}
          {(status === "SHIPPED" || status === "DELIVERED") && <TrackingForm orderId={o.id} carrier={o.carrier} trackingCode={o.trackingCode} />}
          {(status === "PENDING" || status === "OPENSTAAND" || status === "PAID") && <CancelForm orderId={o.id} consequences={cancelConsequences} />}
          {(status === "PAID" || status === "SHIPPED" || status === "DELIVERED") && o.invoice && remaining > 0 && (
            <RefundForm
              orderId={o.id}
              remainingEur={remaining}
              expectedRefundedEur={o.refundedEur}
              idempotencyKey={randomUUID()}
              items={o.items.map((i) => ({ partId: i.partId, sku: i.part.sku, quantity: i.quantity }))}
              how={refundHow}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
