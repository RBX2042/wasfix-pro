import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getCreditNotesForOrder, getInvoiceForOrder, issueInvoiceForOrder, type IssuedInvoice } from "@/lib/invoicing";
import { isOrderStatus, orderRef } from "@/lib/order-status";
import { formatEur, formatDate } from "@/lib/utils";
import { loadOrderForViewer, tokenFromParam } from "../../_lib/access";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";
// Same rules as the order page: the address carries the guest's credential.
export const metadata: Metadata = { title: "Factuur", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

/**
 * Printable invoice with the btw-specification NL law requires. Opens with the
 * order's token (guest), for the signed-in customer who placed it, or for an
 * admin: see ../../_lib/access.ts. Everyone else gets the 404.
 */
export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { id } = await params;
  const token = tokenFromParam((await searchParams).t);

  const access = await loadOrderForViewer(id, token);
  if (!access) notFound();
  const { order, via } = access;
  const tokenQs = via === "token" && token ? `?t=${encodeURIComponent(token)}` : "";

  // Orders paid before invoicing existed still get a number on first view. In
  // production that is refused while the company identity is incomplete; the
  // page then says the invoice is being prepared instead of failing.
  let invoice: IssuedInvoice | null = await getInvoiceForOrder(order.id);
  if (!invoice && ["PAID", "SHIPPED", "DELIVERED"].includes(order.status)) {
    invoice = await issueInvoiceForOrder(order.id).catch(() => null);
  }
  if (!invoice) {
    return (
      <div className="mx-auto max-w-2xl p-10 text-center">
        <h1 className="font-heading text-xl font-bold">Nog geen factuur</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Deze bestelling is nog niet betaald. Zodra de betaling binnen is maken we automatisch een factuur aan.
        </p>
        <Link href={`/bestelling/${order.id}${tokenQs}`} className="text-primary hover:underline text-sm mt-4 inline-block">
          Terug naar de bestelling
        </Link>
      </div>
    );
  }

  const { seller, buyer, lines } = invoice;
  const creditNotes = await getCreditNotesForOrder(order.id);
  const status = isOrderStatus(order.status) ? order.status : "PENDING";
  const isPaid = status === "PAID" || status === "SHIPPED" || status === "DELIVERED";
  const isBankTransfer = order.paymentMethod === "BANK_TRANSFER";
  // What the document says about payment, from the order row: a bookkeeper must be able to
  // tell from the paper alone whether, how and by when this invoice is paid.
  const stamp = status === "CANCELLED"
    ? { text: "Geannuleerd", tone: "text-red-700 border-red-700" }
    : isPaid
      ? { text: "Betaald", tone: "text-emerald-700 border-emerald-700" }
      : { text: "Openstaand", tone: "text-amber-700 border-amber-700" };

  return (
    <div className="bg-muted/30 min-h-screen py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-3xl px-4 print:px-0 print:max-w-none">
        <div className="flex items-center justify-between mb-4 print:hidden">
          <Link href={`/bestelling/${order.id}${tokenQs}`} className="text-sm text-muted-foreground hover:text-foreground">
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
                {isBankTransfer && order.dueAt && (
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground w-28">Vervaldatum</dt>
                    <dd>{formatDate(order.dueAt)}</dd>
                  </div>
                )}
                <div className="flex gap-2">
                  <dt className="text-muted-foreground w-28">Status</dt>
                  <dd><span className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${stamp.tone}`}>{stamp.text}</span></dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground w-28">Bestelnummer</dt>
                  <dd className="font-mono">{orderRef(order.id)}</dd>
                </div>
              </dl>
            </div>
            <address className="not-italic text-sm text-right">
              <p className="font-semibold">{seller.name}</p>
              <p>{seller.street}</p>
              <p>{seller.postalCode} {seller.city}</p>
              <p className="text-muted-foreground mt-2">KvK {seller.kvk}</p>
              <p className="text-muted-foreground">Btw {seller.vatNumber}</p>
              {seller.iban && <p className="text-muted-foreground">IBAN {seller.iban}</p>}
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

          {/* overflow-x-auto: at 320px the four columns are wider than the page; the table scrolls
              inside its own box instead of pushing the whole page sideways. */}
          <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 font-medium">Omschrijving</th>
                <th className="py-2 font-medium w-16 text-right">Aantal</th>
                <th className="py-2 font-medium w-24 text-right">Stukprijs</th>
                <th className="py-2 font-medium w-24 text-right">Totaal</th>
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
          </div>

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

          <section className="mt-6 border-t pt-4 text-sm" aria-label="Betaling">
            {isPaid ? (
              <p>
                Betaald{order.paidAt ? ` op ${formatDate(order.paidAt)}` : ""} via {isBankTransfer ? "bankoverschrijving" : "iDEAL of kaart"}.
              </p>
            ) : status === "CANCELLED" ? (
              <p>Deze bestelling is geannuleerd{creditNotes.length ? "; zie de creditfactuur hieronder" : ""}. Je hoeft deze factuur niet te betalen.</p>
            ) : (
              <>
                <p className="font-medium">Betaal {formatEur(invoice.totalEur)}{order.dueAt ? ` uiterlijk ${formatDate(order.dueAt)}` : ""} per bankoverschrijving:</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <dt className="text-muted-foreground">IBAN</dt>
                  <dd className="font-mono break-all">{seller.iban}</dd>
                  <dt className="text-muted-foreground">Ten name van</dt>
                  <dd>{seller.name}</dd>
                  <dt className="text-muted-foreground">Betalingskenmerk</dt>
                  <dd className="font-mono font-semibold">{invoice.number}</dd>
                </dl>
              </>
            )}
            {creditNotes.length > 0 && (
              <ul className="mt-3 space-y-1">
                {creditNotes.map((c) => (
                  <li key={c.number}>
                    Creditfactuur{" "}
                    <Link href={`/bestelling/${order.id}/creditnota/${encodeURIComponent(c.number)}${tokenQs}`} className="font-mono text-primary underline print:no-underline">{c.number}</Link>{" "}
                    van {formatDate(c.issuedAt)}: <span className="tabular-nums">-{formatEur(c.totalEur)}</span> (incl. btw)
                  </li>
                ))}
              </ul>
            )}
          </section>

          <footer className="mt-8 pt-6 border-t text-xs text-muted-foreground space-y-1">
            <p>
              Alle bedragen in euro. De prijzen op de website zijn inclusief {Math.round(invoice.vatRate * 100)}% btw;
              bovenstaande specificatie splitst het btw-bedrag conform de Wet op de omzetbelasting.
            </p>
            <p>Bewaar deze factuur — hij geldt ook als garantiebewijs.{seller.email ? ` Vragen? ${seller.email}` : ""}</p>
          </footer>
        </article>
      </div>
    </div>
  );
}
