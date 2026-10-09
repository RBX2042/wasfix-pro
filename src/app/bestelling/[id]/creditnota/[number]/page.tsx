import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getCreditNotesForOrder, getInvoiceForOrder } from "@/lib/invoicing";
import { orderRef } from "@/lib/order-status";
import { formatEur, formatDate } from "@/lib/utils";
import { loadOrderForViewer, tokenFromParam } from "../../../_lib/access";
import { PrintButton } from "../../factuur/print-button";

export const dynamic = "force-dynamic";
// Same rules as the invoice: the address carries the guest's credential.
export const metadata: Metadata = { title: "Creditfactuur", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

/**
 * Printable credit note (creditfactuur). The terms (7.1) and the return terms promise one whenever an
 * invoiced order is cancelled or refunded; until now the customer got a number and one line on the invoice.
 *
 * Opens with the order's token (guest), for the signed-in customer who placed it, or for an admin: the same
 * three ways in as the invoice (../../../_lib/access.ts). Everyone else, and a number that belongs to another
 * order, gets the same 404.
 *
 * SIGN CONVENTION (see IssuedCreditNote in src/lib/invoicing.ts): the amounts are stored as positive
 * magnitudes, what is credited. The document prints them as credits, with a minus sign, and says which invoice
 * they correct; the invoice itself is never changed.
 */
export default async function CreditNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; number: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { id, number } = await params;
  const token = tokenFromParam((await searchParams).t);

  const access = await loadOrderForViewer(id, token);
  if (!access) notFound();
  const { order, via } = access;
  const tokenQs = via === "token" && token ? `?t=${encodeURIComponent(token)}` : "";

  const notes = await getCreditNotesForOrder(order.id);
  const note = notes.find((c) => c.number === decodeURIComponent(number));
  if (!note) notFound();
  const invoice = await getInvoiceForOrder(order.id);

  const { seller, buyer, lines } = note;
  const rate = Math.round(note.vatRate * 100);

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
              <h1 className="font-heading text-2xl font-bold">Creditfactuur</h1>
              <dl className="mt-3 text-sm space-y-0.5">
                <div className="flex gap-2">
                  <dt className="text-muted-foreground w-36">Creditnummer</dt>
                  <dd className="font-mono font-medium">{note.number}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground w-36">Datum</dt>
                  <dd>{formatDate(note.issuedAt)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground w-36">Betreft factuur</dt>
                  <dd className="font-mono">{note.invoiceNumber}{invoice ? <span className="font-sans text-muted-foreground"> van {formatDate(invoice.issuedAt)}</span> : null}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground w-36">Bestelnummer</dt>
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
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Aan</h2>
            <address className="not-italic text-sm">
              <p className="font-medium">{buyer.name}</p>
              {buyer.street && <p>{buyer.street}</p>}
              {(buyer.postalCode || buyer.city) && <p>{buyer.postalCode} {buyer.city}</p>}
              {buyer.country && <p>{buyer.country}</p>}
              {buyer.email && <p className="text-muted-foreground mt-1">{buyer.email}</p>}
              {buyer.vatNumber && <p className="text-muted-foreground">Btw-nummer: {buyer.vatNumber}</p>}
            </address>
          </section>

          <p className="mt-6 text-sm">
            Met deze creditfactuur corrigeren wij factuur <span className="font-mono">{note.invoiceNumber}</span>. De factuur zelf blijft ongewijzigd. De bedragen hieronder zijn tegoed voor jou.
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 font-medium">Omschrijving</th>
                  <th className="py-2 font-medium w-16 text-right">Aantal</th>
                  <th className="py-2 font-medium w-24 text-right">Stukprijs</th>
                  <th className="py-2 font-medium w-24 text-right">Tegoed</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={`${line.sku}-${i}`} className="border-b">
                    <td className="py-2">
                      {line.name}
                      {line.sku && <span className="block text-xs text-muted-foreground font-mono">{line.sku}</span>}
                    </td>
                    <td className="py-2 text-right tabular-nums">{line.quantity}</td>
                    <td className="py-2 text-right tabular-nums">{formatEur(line.unitPriceEur)}</td>
                    {/* What is credited is the negative of what was invoiced: goods come out as "-€ 73,00", the invoice's discount line (negative) as "+€ 3,00". */}
                    <td className="py-2 text-right tabular-nums">{line.lineTotalEur < 0 ? "+" : "-"}{formatEur(Math.abs(line.lineTotalEur))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex justify-end">
            <dl className="w-full max-w-xs text-sm space-y-1">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Gecrediteerd excl. btw</dt>
                <dd className="tabular-nums">-{formatEur(note.subtotalEur)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Btw {rate}%</dt>
                <dd className="tabular-nums">-{formatEur(note.vatEur)}</dd>
              </div>
              <div className="flex justify-between border-t pt-2 font-bold text-base">
                <dt>Totaal tegoed (incl. btw)</dt>
                <dd className="tabular-nums">-{formatEur(note.totalEur)}</dd>
              </div>
            </dl>
          </div>

          <footer className="mt-8 pt-6 border-t text-xs text-muted-foreground space-y-1">
            <p>Alle bedragen in euro. Het btw-bedrag is het deel van het tegoed dat in het gecrediteerde bedrag zit ({rate}%).</p>
            <p>Bewaar deze creditfactuur bij de factuur.{seller.email ? ` Vragen? ${seller.email}` : ""}</p>
          </footer>
        </article>
      </div>
    </div>
  );
}
