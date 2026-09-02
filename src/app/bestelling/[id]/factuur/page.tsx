import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { getInvoiceForOrder, issueInvoiceForOrder, type IssuedInvoice } from "@/lib/invoicing";
import { formatEur, formatDate } from "@/lib/utils";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Factuur", robots: { index: false, follow: false } };

/**
 * Printable invoice with the btw-specification NL law requires. Only the
 * customer who placed the order (or an admin) can open it.
 */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isDatabaseConfigured()) notFound();

  const order = await prisma.order.findUnique({ where: { id } }).catch(() => null);
  if (!order) notFound();

  const user = await getCurrentUser().catch(() => null);
  const isOwner = user && (order.userId === user.id || user.role === "ADMIN");
  if (!isOwner) notFound();

  // Orders paid before invoicing existed still get a number on first view.
  let invoice: IssuedInvoice | null = await getInvoiceForOrder(order.id);
  if (!invoice && ["PAID", "SHIPPED", "DELIVERED"].includes(order.status)) {
    invoice = await issueInvoiceForOrder(order.id);
  }
  if (!invoice) {
    return (
      <div className="mx-auto max-w-2xl p-10 text-center">
        <h1 className="font-heading text-xl font-bold">Nog geen factuur</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Deze bestelling is nog niet betaald. Zodra de betaling binnen is maken we automatisch een factuur aan.
        </p>
        <Link href={`/bestelling/${order.id}`} className="text-primary hover:underline text-sm mt-4 inline-block">
          Terug naar de bestelling
        </Link>
      </div>
    );
  }

  const { seller, buyer, lines } = invoice;

  return (
    <div className="bg-muted/30 min-h-screen py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-3xl px-4 print:px-0 print:max-w-none">
        <div className="flex items-center justify-between mb-4 print:hidden">
          <Link href={`/bestelling/${order.id}`} className="text-sm text-muted-foreground hover:text-foreground">
            ← Terug naar de bestelling
          </Link>
          <PrintButton />
        </div>

        <article className="bg-background border rounded-lg p-8 md:p-10 print:border-0 print:p-0">
          <header className="flex flex-wrap justify-between gap-6 border-b pb-6">
            <div>
              <h1 className="font-heading text-2xl font-bold">Factuur</h1>
              <dl className="mt-3 text-sm space-y-0.5">
                <div className="flex gap-2">
                  <dt className="text-muted-foreground w-28">Factuurnummer</dt>
                  <dd className="font-mono font-medium">{invoice.number}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground w-28">Factuurdatum</dt>
                  <dd>{formatDate(invoice.issuedAt)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground w-28">Bestelnummer</dt>
                  <dd className="font-mono">{order.id.slice(0, 8).toUpperCase()}</dd>
                </div>
              </dl>
            </div>
            <address className="not-italic text-sm text-right">
              <p className="font-semibold">{seller.name}</p>
              <p>{seller.street}</p>
              <p>{seller.postalCode} {seller.city}</p>
              <p className="text-muted-foreground mt-2">KvK {seller.kvk}</p>
              <p className="text-muted-foreground">Btw {seller.vatNumber}</p>
              <p className="text-muted-foreground">{seller.iban}</p>
            </address>
          </header>

          <section className="py-6 border-b">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Factuuradres</h2>
            <address className="not-italic text-sm">
              <p className="font-medium">{buyer.name}</p>
              {buyer.street && <p>{buyer.street}</p>}
              {(buyer.postalCode || buyer.city) && <p>{buyer.postalCode} {buyer.city}</p>}
              {buyer.country && <p>{buyer.country}</p>}
              {buyer.email && <p className="text-muted-foreground mt-1">{buyer.email}</p>}
              {buyer.vatNumber && <p className="text-muted-foreground">Btw-nummer: {buyer.vatNumber}</p>}
            </address>
          </section>

          <table className="w-full text-sm mt-6">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 font-medium">Omschrijving</th>
                <th className="py-2 font-medium w-20 text-right">Aantal</th>
                <th className="py-2 font-medium w-28 text-right">Stukprijs</th>
                <th className="py-2 font-medium w-28 text-right">Totaal</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.sku} className="border-b">
                  <td className="py-2">
                    {line.name}
                    <span className="block text-xs text-muted-foreground font-mono">{line.sku}</span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{line.quantity}</td>
                  <td className="py-2 text-right tabular-nums">{formatEur(line.unitPriceEur)}</td>
                  <td className="py-2 text-right tabular-nums">{formatEur(line.lineTotalEur)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-6 flex justify-end">
            <dl className="w-full max-w-xs text-sm space-y-1">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotaal</dt>
                <dd className="tabular-nums">{formatEur(invoice.subtotalEur)}</dd>
              </div>
              {invoice.discountEur > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <dt>Korting</dt>
                  <dd className="tabular-nums">-{formatEur(invoice.discountEur)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Verzendkosten</dt>
                <dd className="tabular-nums">{invoice.shippingEur === 0 ? "Gratis" : formatEur(invoice.shippingEur)}</dd>
              </div>
              <div className="flex justify-between border-t pt-1">
                <dt className="text-muted-foreground">Bedrag excl. btw</dt>
                <dd className="tabular-nums">{formatEur(invoice.totalEur - invoice.vatEur)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Btw {Math.round(invoice.vatRate * 100)}%</dt>
                <dd className="tabular-nums">{formatEur(invoice.vatEur)}</dd>
              </div>
              <div className="flex justify-between border-t pt-2 font-bold text-base">
                <dt>Totaal</dt>
                <dd className="tabular-nums">{formatEur(invoice.totalEur)}</dd>
              </div>
            </dl>
          </div>

          <footer className="mt-8 pt-6 border-t text-xs text-muted-foreground space-y-1">
            <p>
              Alle bedragen in euro. De prijzen op de website zijn inclusief {Math.round(invoice.vatRate * 100)}% btw;
              bovenstaande specificatie splitst het btw-bedrag conform de Wet op de omzetbelasting.
            </p>
            <p>Bewaar deze factuur — hij geldt ook als garantiebewijs. Vragen? {seller.email}</p>
          </footer>
        </article>
      </div>
    </div>
  );
}
