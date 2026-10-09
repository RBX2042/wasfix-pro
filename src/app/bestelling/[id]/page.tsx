import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, FileText, Landmark, Loader2, Mail, Package, Truck, Undo2, XCircle, ArrowRight } from "lucide-react";
import { MarketingLayout } from "@/components/marketing-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatEur, formatDate } from "@/lib/utils";
import { env } from "@/lib/env";
import { realOrNull } from "@/lib/plans";
import { getCreditNotesForOrder, getInvoiceForOrder } from "@/lib/invoicing";
import { ORDER_STATUS_LABEL, isOrderStatus, orderRef, type OrderStatus } from "@/lib/order-status";
import { carrierLabel, trackingUrl } from "@/lib/emails/tracking";
import { loadOrderForViewer, tokenFromParam } from "../_lib/access";
import { OrderEffects } from "./order-effects";
import { CopyButton } from "./copy-button";

export const dynamic = "force-dynamic";

// The address carries the credential for guests: keep it out of search results
// and out of Referer headers (also set as headers in src/middleware.ts).
export const metadata: Metadata = {
  title: "Bestelling",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

type SearchParams = { success?: string; t?: string | string[]; m?: string };

const BADGE: Record<OrderStatus, "warning" | "success" | "default" | "danger"> = {
  PENDING: "warning",
  OPENSTAAND: "warning",
  PAID: "success",
  SHIPPED: "default",
  DELIVERED: "success",
  CANCELLED: "danger",
};

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const fresh = sp.success === "1";
  const token = tokenFromParam(sp.t);

  // A local development order without a database: there is nothing stored to show.
  // In production this id format simply does not exist, so it is a plain 404.
  if (id.startsWith("demo-")) {
    if (env.IS_PRODUCTION) notFound();
    return <DemoOrder id={id} />;
  }

  const access = await loadOrderForViewer(id, token);
  if (!access) notFound();
  const { order, via } = access;

  const status: OrderStatus = isOrderStatus(order.status) ? order.status : "PENDING";
  const address = safeAddress(order.shippingAddress);
  const awaitingTransfer = status === "OPENSTAAND" && order.paymentMethod === "BANK_TRANSFER";
  const awaitingCard = status === "PENDING" && order.paymentMethod === "STRIPE";

  const invoice = status === "CANCELLED" || awaitingTransfer || ["PAID", "SHIPPED", "DELIVERED"].includes(status) ? await getInvoiceForOrder(order.id) : null;
  // Every credit note of the order, not only after a cancellation: a refund of a shipped order issues one too.
  const creditNotes = invoice ? await getCreditNotesForOrder(order.id) : [];

  // Carry the token into the links on this page, so the invoice opens for the same guest.
  const tokenQs = via === "token" && token ? `?t=${encodeURIComponent(token)}` : "";
  const invoiceHref = `/bestelling/${order.id}/factuur${tokenQs}`;
  const creditHref = (number: string) => `/bestelling/${order.id}/creditnota/${encodeURIComponent(number)}${tokenQs}`;
  // The return form, prefilled with the order number. The viewer is allowed to see this order (token, owner or
  // admin), so the order's own token goes along as the proof the form needs.
  const canReturn = status === "SHIPPED" || status === "DELIVERED";
  const returnHref = canReturn ? `/retour/start?order=${orderRef(order.id)}${order.accessToken ? `&t=${encodeURIComponent(order.accessToken)}` : ""}` : null;

  const iban = realOrNull(invoice?.seller.iban);
  const reference = invoice?.number ?? null;
  const dueAt = order.dueAt;
  const mailSent = fresh && sp.m === "1";
  const trackUrl = order.trackingCode ? trackingUrl(order.carrier, order.trackingCode, address.postalCode) : null;

  return (
    <MarketingLayout>
      <div className="container py-8 md:py-12 max-w-3xl">
        <OrderEffects orderId={order.id} fresh={fresh} clearCartOnce={status !== "CANCELLED"} waitingForPayment={awaitingCard && fresh} />

        <Headline status={status} fresh={fresh} awaitingTransfer={awaitingTransfer} awaitingCard={awaitingCard} />

        {awaitingTransfer && (
          <section aria-labelledby="pay-heading" className="rounded-lg border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30 p-4 sm:p-6 mb-8">
            <div className="flex items-start gap-3 mb-4">
              <Landmark className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0">
                <h2 id="pay-heading" className="font-heading text-lg font-bold text-amber-900 dark:text-amber-100">
                  Maak {formatEur(order.totalEur)} over om je bestelling te laten verzenden
                </h2>
                <p className="text-sm text-amber-900/90 dark:text-amber-200 mt-1">
                  Je onderdelen zijn voor je gereserveerd, maar we verzenden pas als je betaling bij ons binnen is. Een overboeking staat er meestal binnen 1 tot 2 werkdagen.
                </p>
              </div>
            </div>
            <dl className="bg-white dark:bg-black/20 rounded-md p-3 sm:p-4 text-sm space-y-2.5">
              <PayRow label="Te betalen" value={formatEur(order.totalEur)} strong />
              {iban ? (
                <>
                  <PayRow label="IBAN" value={iban} mono copy="IBAN" />
                  <PayRow label="Ten name van" value={invoice?.seller.name ?? ""} />
                </>
              ) : (
                <PayRow label="Betaalgegevens" value="De betaalgegevens staan nog niet op deze pagina. Neem contact met ons op." />
              )}
              <PayRow label="Betalingskenmerk" value={reference ?? "—"} mono strong nowrap copy={reference ? "betalingskenmerk" : undefined} />
              {dueAt && <PayRow label="Betaal uiterlijk" value={formatDate(dueAt)} />}
              {reference && <PayRow label="Factuurnummer" value={reference} mono />}
            </dl>
            <p className="text-xs text-muted-foreground mt-3">
              Vermeld het betalingskenmerk als omschrijving, anders kunnen we je betaling niet koppelen.
              {mailSent
                ? ` We hebben deze gegevens ook naar ${order.email} gestuurd.`
                : fresh
                  ? " De e-mail met deze gegevens is niet verstuurd of we weten het niet zeker: bewaar daarom deze pagina. De gegevens staan hier altijd."
                  : ""}
            </p>
          </section>
        )}

        {status === "CANCELLED" && (
          <div className="rounded-lg border bg-red-50 dark:bg-red-950/20 p-4 mb-6 text-sm flex items-start gap-3">
            <XCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" aria-hidden />
            <p>
              Deze bestelling is geannuleerd.
              {creditNotes.length > 0
                ? ` Voor de factuur ${invoice?.number} is een creditfactuur uitgegeven (${creditNotes.map((c) => c.number).join(", ")}).`
                : ""}{" "}
              Heb je al betaald? Dan krijg je het bedrag terug; mail ons als je daar nog niets van hebt gehoord.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div className="min-w-0">
            <Badge variant={BADGE[status]}>{ORDER_STATUS_LABEL[status]}</Badge>
            <p className="font-heading text-xl font-bold mt-2">Bestelling #{orderRef(order.id)}</p>
            <p className="text-sm text-muted-foreground mt-1">Geplaatst op {formatDate(order.createdAt)}</p>
          </div>
        </div>

        {(status === "SHIPPED" || status === "DELIVERED") && order.trackingCode && (
          <Card className="mb-6">
            <CardContent className="p-4 sm:p-6 text-sm">
              <h2 className="font-heading text-lg font-semibold mb-2 flex items-center gap-2"><Truck className="h-4 w-4" aria-hidden /> Verzending</h2>
              <p>
                {carrierLabel(order.carrier)}: <span className="font-mono">{order.trackingCode}</span>
              </p>
              {trackUrl && (
                <p className="mt-1">
                  <a href={trackUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">Volg je pakket</a>
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="mb-6">
          <CardContent className="p-4 sm:p-6">
            <h2 className="font-heading text-lg font-semibold mb-4 flex items-center gap-2">
              <Package className="h-4 w-4" aria-hidden /> Onderdelen
            </h2>
            <div className="space-y-3">
              {order.items.map((it) => (
                <div key={it.id} className="flex items-center gap-3 sm:gap-4">
                  {it.part.imageUrl && (
                    <Image src={it.part.imageUrl} alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded border object-cover bg-muted" />
                  )}
                  <div className="flex-1 min-w-0">
                    <Link href={`/onderdelen/${it.part.sku}`} className="font-medium hover:text-primary text-sm break-words">
                      {it.part.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{it.part.sku} · {it.quantity}x {formatEur(it.unitPrice)}</p>
                  </div>
                  <span className="font-semibold whitespace-nowrap">{formatEur(it.unitPrice * it.quantity)}</span>
                </div>
              ))}
            </div>

            <div className="border-t mt-5 pt-4 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotaal</span><span>{formatEur(order.subtotalEur)}</span></div>
              {order.discountEur > 0 && (
                <div className="flex justify-between text-emerald-600"><span>Ledenkorting</span><span>-{formatEur(order.discountEur)}</span></div>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground">Verzending</span><span>{order.shippingEur === 0 ? "Gratis" : formatEur(order.shippingEur)}</span></div>
              <div className="flex justify-between font-bold text-base border-t pt-2 mt-2"><span>Totaal (incl. btw)</span><span>{formatEur(order.totalEur)}</span></div>
              {order.vatEur > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground"><span>Waarvan btw {Math.round(order.vatRate * 100)}%</span><span>{formatEur(order.vatEur)}</span></div>
              )}
            </div>
          </CardContent>
        </Card>

        {creditNotes.length > 0 && (
          <Card className="mb-6">
            <CardContent className="p-4 sm:p-6 text-sm">
              <h2 className="font-heading text-lg font-semibold mb-2 flex items-center gap-2"><FileText className="h-4 w-4" aria-hidden /> Creditfactuur</h2>
              <ul className="space-y-1.5">
                {creditNotes.map((c) => (
                  <li key={c.number}>
                    <Link href={creditHref(c.number)} className="text-primary underline font-mono">{c.number}</Link>
                    <span className="text-muted-foreground"> · {formatDate(c.issuedAt)} · -{formatEur(c.totalEur)} (incl. btw)</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground mt-2">De factuur zelf blijft ongewijzigd; de creditfactuur corrigeert hem.</p>
            </CardContent>
          </Card>
        )}

        <Card className="mb-6">
          <CardContent className="p-4 sm:p-6">
            <h2 className="font-heading text-lg font-semibold mb-4 flex items-center gap-2">
              <Truck className="h-4 w-4" aria-hidden /> Verzendgegevens
            </h2>
            <div className="text-sm space-y-1 break-words">
              <p className="font-medium">{address.name}</p>
              <p>{address.street} {address.houseNumber}</p>
              <p>{address.postalCode} {address.city}</p>
              {order.phone && <p className="text-muted-foreground pt-1">Telefoon: {order.phone}</p>}
              {order.customerNote && <p className="text-muted-foreground">Opmerking: {order.customerNote}</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-6">
            <h2 className="font-heading text-lg font-semibold mb-4 flex items-center gap-2">
              <Mail className="h-4 w-4" aria-hidden /> Contact
            </h2>
            <p className="text-sm text-muted-foreground">
              Vragen over je bestelling? Mail ons met het bestelnummer <span className="font-mono">{orderRef(order.id)}</span>. Bewaar de link van deze pagina: daarmee kun je je bestelling en factuur altijd terugvinden.
            </p>
          </CardContent>
        </Card>

        <div className="mt-8 flex flex-wrap gap-3">
          {invoice && (
            <Button asChild variant="outline">
              <Link href={invoiceHref}><FileText className="h-4 w-4" /> Bekijk factuur</Link>
            </Button>
          )}
          {returnHref && (
            <Button asChild variant="outline">
              <Link href={returnHref}><Undo2 className="h-4 w-4" /> Retour aanvragen</Link>
            </Button>
          )}
          <Button asChild>
            <Link href="/onderdelen">Verder winkelen <ArrowRight className="h-4 w-4" /></Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/diagnose">Nieuwe diagnose</Link>
          </Button>
        </div>
      </div>
    </MarketingLayout>
  );
}

function Headline({ status, fresh, awaitingTransfer, awaitingCard }: { status: OrderStatus; fresh: boolean; awaitingTransfer: boolean; awaitingCard: boolean }) {
  // The heading is what the state really is, taken from the database: a customer who has
  // just come back from the payment page must not be told "paid" before the webhook has said so.
  let icon = <CheckCircle2 className="h-8 w-8 text-emerald-500 shrink-0" aria-hidden />;
  let title = "Je bestelling";
  let body: string | null = null;

  if (awaitingTransfer) {
    icon = <Landmark className="h-8 w-8 text-amber-500 shrink-0" aria-hidden />;
    title = fresh ? "Bedankt voor je bestelling" : "Je bestelling wacht op je overschrijving";
    body = "Hieronder staat wat je moet overmaken.";
  } else if (awaitingCard) {
    icon = <Loader2 className="h-8 w-8 text-amber-500 shrink-0" aria-hidden />;
    title = fresh ? "We verwerken je betaling" : "Deze bestelling is nog niet betaald";
    body = fresh
      ? "Zodra de betaling is bevestigd staat hier \"Betaald\". Je hoeft niets opnieuw te betalen."
      : "We hebben je betaling nog niet ontvangen. Rond de betaling af via de afrekenpagina, of plaats een nieuwe bestelling.";
  } else if (status === "PAID") {
    title = fresh ? "Bedankt, je betaling is ontvangen" : "Betaald";
    body = "We verzenden op werkdagen en laten je weten zodra het pakket onderweg is.";
  } else if (status === "SHIPPED") {
    title = "Je bestelling is onderweg";
  } else if (status === "DELIVERED") {
    title = "Je bestelling is afgeleverd";
  } else if (status === "CANCELLED") {
    icon = <XCircle className="h-8 w-8 text-red-500 shrink-0" aria-hidden />;
    title = "Geannuleerde bestelling";
  }

  return (
    <div className="flex items-start gap-3 sm:gap-4 mb-6">
      {icon}
      <div className="min-w-0">
        {/* tabIndex -1: the effect moves focus here after a purchase, so screen readers start at the confirmation. */}
        <h1 id="order-heading" tabIndex={-1} className="font-heading text-2xl font-bold outline-none">{title}</h1>
        {body && <p className="text-sm text-muted-foreground mt-1">{body}</p>}
      </div>
    </div>
  );
}

function PayRow({ label, value, mono, strong, nowrap, copy }: { label: string; value: string; mono?: boolean; strong?: boolean; nowrap?: boolean; copy?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className={`min-w-0 text-right break-words flex items-center justify-end gap-2 ${mono ? "font-mono" : ""} ${strong ? "font-semibold" : ""}`}>
        <span className={nowrap ? "whitespace-nowrap" : "min-w-0 break-all"}>{value}</span>
        {copy && <CopyButton value={value} label={copy} />}
      </dd>
    </div>
  );
}

function safeAddress(raw: string): { name?: string; street?: string; houseNumber?: string; postalCode?: string; city?: string } {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function DemoOrder({ id }: { id: string }) {
  return (
    <MarketingLayout>
      <div className="container py-12 max-w-2xl">
        <div className="rounded-lg border-2 border-dashed p-6">
          <h1 id="order-heading" tabIndex={-1} className="font-heading text-xl font-bold mb-2">Demo-bestelling</h1>
          <p className="text-sm text-muted-foreground">
            Dit is een ontwikkelomgeving zonder database. Er is niets besteld, niets afgeschreven en er is geen factuur of e-mail verstuurd. Referentie: <span className="font-mono">{id.toUpperCase()}</span>
          </p>
          <Button asChild className="mt-4"><Link href="/onderdelen">Verder winkelen</Link></Button>
        </div>
      </div>
    </MarketingLayout>
  );
}
