import { MarketingLayout } from "@/components/marketing-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatEur, formatDate } from "@/lib/utils";
import { COMPANY, realOrNull } from "@/lib/plans";
import { getInvoiceForOrder } from "@/lib/invoicing";
import { CheckCircle2, Truck, Package, Mail, ArrowRight, FileText, Landmark } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export const dynamic = "force-dynamic";


const STATUS_LABEL: Record<string, { label: string; variant: any }> = {
  PENDING: { label: "In afwachting", variant: "warning" },
  OPENSTAAND: { label: "Openstaand — wacht op betaling", variant: "warning" },
  PAID: { label: "Betaald", variant: "success" },
  SHIPPED: { label: "Verzonden", variant: "default" },
  DELIVERED: { label: "Geleverd", variant: "success" },
  CANCELLED: { label: "Geannuleerd", variant: "danger" },
};

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const isSuccess = sp.success === "1";

  // Try to load the order from DB. If DB unreachable or order is a demo id,
  // render a generic confirmation so the customer flow completes successfully.
  type OrderWithItems = Awaited<ReturnType<typeof prisma.order.findUnique>> & {
    items: Array<{ id: string; quantity: number; unitPrice: number; part: { id: string; sku: string; name: string; imageUrl: string | null } }>;
  };
  // The order carries the buyer's name, address and e-mail. Order ids travel
  // through Stripe redirects, confirmation mails and browser history, so the
  // page must verify who is asking — the invoice route and /api/orders/[id]
  // already did, this one did not.
  let order: OrderWithItems | null = null;
  try {
    if (!id.startsWith("demo-")) {
      const found = await prisma.order.findUnique({
        where: { id },
        include: { items: { include: { part: true } } },
      });
      if (found) {
        const user = await getCurrentUser().catch(() => null);
        const mayView = user && (found.userId === user.id || user.role === "ADMIN");
        order = mayView ? found : null;
        if (!mayView) notFound();
      }
    }
  } catch {
    order = null;
  }

  if (!order) {
    // Demo confirmation: no order data, but show success message
    if (isSuccess || id.startsWith("demo-")) {
      return (
        <MarketingLayout>
          <div className="container py-12 max-w-3xl">
            <div className="rounded-lg border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 p-6 mb-8 flex items-start gap-4">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <h2 className="font-heading text-xl font-bold text-emerald-900 dark:text-emerald-100">Bedankt voor je bestelling!</h2>
                <p className="text-sm text-emerald-800 dark:text-emerald-200 mt-1">
                  Bestelnummer: <strong className="font-mono">{id.toUpperCase()}</strong>
                  <br />
                  We sturen je binnen 1 werkdag een bevestigingsmail met track &amp; trace.
                </p>
              </div>
            </div>
            <Card className="mb-6">
              <CardContent className="p-6 text-center">
                <Package className="h-12 w-12 text-primary mx-auto mb-3" />
                <h2 className="font-heading text-lg font-semibold mb-2">Wat gebeurt er nu?</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  {/* Geen "morgen in huis": er is geen vervoerderskoppeling en
                      geen cut-off, en de voorwaarden noemen de levertijd een
                      indicatie. Beloof hier niets wat we niet kunnen waarmaken. */}
                  Je ontvangt direct een e-mailbevestiging. We verzenden op werkdagen en sturen je een track &amp; trace zodra het pakket is aangemeld. Bij vragen mail je support@wasfix.nl.
                </p>
              </CardContent>
            </Card>
            <div className="mt-8 flex flex-wrap gap-3 justify-center">
              <Button asChild>
                <Link href="/diagnose">Nieuwe diagnose <ArrowRight className="h-4 w-4" /></Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/onderdelen">Verder winkelen</Link>
              </Button>
            </div>
          </div>
        </MarketingLayout>
      );
    }
    notFound();
  }

  const address = JSON.parse(order.shippingAddress);
  const status = STATUS_LABEL[order.status] ?? STATUS_LABEL.PENDING;
  const awaitingBankTransfer = order.status === "OPENSTAAND" && order.paymentMethod === "BANK_TRANSFER";
  const invoice = awaitingBankTransfer ? await getInvoiceForOrder(order.id) : null;

  return (
    <MarketingLayout>
      <div className="container py-12 max-w-3xl">
        {awaitingBankTransfer && (
          <div className="rounded-lg border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30 p-6 mb-8 flex items-start gap-4">
            <Landmark className="h-8 w-8 text-amber-500 shrink-0 mt-0.5" />
            <div className="w-full">
              <h2 className="font-heading text-xl font-bold text-amber-900 dark:text-amber-100">Bedankt! Maak het bedrag over om te versturen</h2>
              <p className="text-sm text-amber-800 dark:text-amber-200 mt-1 mb-4">
                We versturen je onderdelen zodra de betaling binnen is. Je ontvangt hiervan een bevestiging per e-mail.
              </p>
              <div className="bg-white dark:bg-black/20 rounded-md p-4 text-sm space-y-1.5">
                <div className="flex justify-between"><span className="text-muted-foreground">Factuurnummer</span><span className="font-mono font-semibold">{invoice?.number ?? "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Te betalen</span><span className="font-semibold">{formatEur(order.totalEur)}</span></div>
                {/* A placeholder IBAN is worse than none: the customer would
                    try to pay it. Checkout refuses to create these orders in
                    production, so this only shows on a real configuration. */}
                {realOrNull(COMPANY.iban) ? (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">IBAN</span><span className="font-mono font-semibold">{COMPANY.iban}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Ten name van</span><span>{COMPANY.name}</span></div>
                  </>
                ) : (
                  <div className="flex justify-between"><span className="text-muted-foreground">Betaalgegevens</span><span>volgen per e-mail</span></div>
                )}
                <div className="flex justify-between"><span className="text-muted-foreground">Omschrijving</span><span className="font-mono font-semibold">{invoice?.number ?? "—"}</span></div>
                {order.dueAt && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Betalen voor</span><span>{formatDate(order.dueAt)}</span></div>
                )}
              </div>
            </div>
          </div>
        )}

        {isSuccess && !awaitingBankTransfer && (
          <div className="rounded-lg border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 p-6 mb-8 flex items-start gap-4">
            <CheckCircle2 className="h-8 w-8 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-heading text-xl font-bold text-emerald-900 dark:text-emerald-100">Bedankt voor je bestelling!</h2>
              <p className="text-sm text-emerald-800 dark:text-emerald-200 mt-1">
                We hebben een bevestiging gestuurd naar <strong>{order.email}</strong>. We verzenden op werkdagen en melden je het pakket zodra het onderweg is.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-start justify-between mb-6">
          <div>
            <Badge variant={status.variant}>{status.label}</Badge>
            <h1 className="font-heading text-2xl font-bold mt-2">Bestelling #{order.id.slice(0, 8).toUpperCase()}</h1>
            <p className="text-sm text-muted-foreground mt-1">{formatDate(order.createdAt)}</p>
          </div>
        </div>

        <Card className="mb-6">
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-semibold mb-4 flex items-center gap-2">
              <Package className="h-4 w-4" /> Onderdelen
            </h2>
            <div className="space-y-3">
              {order.items.map((it) => (
                <div key={it.id} className="flex items-center gap-4">
                  {it.part.imageUrl && (
                    <Image src={it.part.imageUrl} alt={it.part.name} width={56} height={56} className="h-14 w-14 rounded border object-cover bg-muted" />
                  )}
                  <div className="flex-1">
                    <Link href={`/onderdelen/${it.part.sku}`} className="font-medium hover:text-primary text-sm">
                      {it.part.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{it.part.sku} · {it.quantity}x {formatEur(it.unitPrice)}</p>
                  </div>
                  <span className="font-semibold">{formatEur(it.unitPrice * it.quantity)}</span>
                </div>
              ))}
            </div>

            <div className="border-t mt-5 pt-4 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotaal</span><span>{formatEur(order.subtotalEur)}</span></div>
              {order.discountEur > 0 && (
                <div className="flex justify-between text-emerald-600"><span>Korting</span><span>-{formatEur(order.discountEur)}</span></div>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground">Verzending</span><span>{order.shippingEur === 0 ? "Gratis" : formatEur(order.shippingEur)}</span></div>
              {order.vatEur > 0 && (
                <>
                  <div className="flex justify-between border-t pt-2 mt-2"><span className="text-muted-foreground">Bedrag excl. btw</span><span>{formatEur(order.totalEur - order.vatEur)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Btw {Math.round(order.vatRate * 100)}%</span><span>{formatEur(order.vatEur)}</span></div>
                </>
              )}
              <div className="flex justify-between font-bold text-base border-t pt-2 mt-2"><span>Totaal</span><span>{formatEur(order.totalEur)}</span></div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-semibold mb-4 flex items-center gap-2">
              <Truck className="h-4 w-4" /> Verzendgegevens
            </h2>
            <div className="text-sm space-y-1">
              <p className="font-medium">{address.name}</p>
              <p>{address.street} {address.houseNumber}</p>
              <p>{address.postalCode} {address.city}</p>
              <p className="text-muted-foreground">{address.country ?? "NL"}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-semibold mb-4 flex items-center gap-2">
              <Mail className="h-4 w-4" /> Contact
            </h2>
            <p className="text-sm text-muted-foreground">
              Vragen over je bestelling? Stuur een mail naar <a href="mailto:support@wasfix.nl" className="text-primary underline">support@wasfix.nl</a> met vermelding van bestelnummer.
            </p>
          </CardContent>
        </Card>

        <div className="mt-8 flex flex-wrap gap-3">
          {["PAID", "SHIPPED", "DELIVERED", "OPENSTAAND"].includes(order.status) && (
            <Button asChild variant="outline">
              <Link href={`/bestelling/${order.id}/factuur`}><FileText className="h-4 w-4" /> Bekijk factuur</Link>
            </Button>
          )}
          <Button asChild>
            <Link href="/diagnose">Nieuwe diagnose <ArrowRight className="h-4 w-4" /></Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/onderdelen">Verder winkelen</Link>
          </Button>
        </div>
      </div>
    </MarketingLayout>
  );
}
