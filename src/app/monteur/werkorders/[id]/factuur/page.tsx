import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCurrentUser, hasProAccess } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { issueWorkOrderInvoice } from "@/lib/monteur-invoicing";
import { formatEur, formatDate } from "@/lib/utils";
import { PrintButton } from "@/app/bestelling/[id]/factuur/print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Factuur werkorder", robots: { index: false, follow: false } };

/**
 * The invoice a monteur sends to their own customer for a work order.
 * Opening this page issues the invoice if it does not exist yet; the number
 * is allocated once and reused on every later view.
 */
export default async function WorkOrderInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/inloggen?next=/monteur/werkorders/${id}/factuur`);
  if (!hasProAccess(user)) redirect("/upgrade?plan=MONTEUR_PRO");
  if (!isDatabaseConfigured()) notFound();

  const result = await issueWorkOrderInvoice(user.id, id);

  if (!result.ok) {
    return (
      <DashboardLayout role={user.role}>
        <Card>
          <CardContent className="p-10 text-center">
            <h1 className="font-heading text-xl font-bold mb-2">Nog geen factuur</h1>
            <p className="text-muted-foreground text-sm mb-4">{result.error}</p>
            {result.missing && result.missing.length > 0 && (
              <p className="text-sm text-muted-foreground mb-4">
                Ontbreekt: {result.missing.join(", ")}.
              </p>
            )}
            <div className="flex gap-2 justify-center">
              {result.missing && (
                <Button asChild><Link href="/monteur/instellingen">Bedrijfsgegevens invullen</Link></Button>
              )}
              <Button asChild variant="outline"><Link href="/monteur/werkorders">Terug naar werkorders</Link></Button>
            </div>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  const inv = result.invoice;

  return (
    <div className="bg-muted/30 min-h-screen py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-3xl px-4 print:px-0 print:max-w-none">
        <div className="flex items-center justify-between mb-4 print:hidden">
          <Link href="/monteur/werkorders" className="text-sm text-muted-foreground hover:text-foreground">
            ← Terug naar werkorders
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
                  <dd className="font-mono font-medium">{inv.number}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground w-28">Factuurdatum</dt>
                  <dd>{formatDate(inv.issuedAt)}</dd>
                </div>
                {inv.dueAt && (
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground w-28">Vervaldatum</dt>
                    <dd>{formatDate(inv.dueAt)}</dd>
                  </div>
                )}
              </dl>
            </div>
            <address className="not-italic text-sm text-right">
              <p className="font-semibold">{inv.seller.name}</p>
              {inv.seller.street && <p>{inv.seller.street}</p>}
              <p>{inv.seller.postalCode} {inv.seller.city}</p>
              {inv.seller.kvk && <p className="text-muted-foreground mt-2">KvK {inv.seller.kvk}</p>}
              {inv.seller.vatNumber && <p className="text-muted-foreground">Btw {inv.seller.vatNumber}</p>}
              {inv.seller.iban && <p className="text-muted-foreground">{inv.seller.iban}</p>}
            </address>
          </header>

          <section className="py-6 border-b">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Aan</h2>
            <address className="not-italic text-sm">
              <p className="font-medium">{inv.buyer.name}</p>
              {inv.buyer.street && <p>{inv.buyer.street}</p>}
              {(inv.buyer.postalCode || inv.buyer.city) && <p>{inv.buyer.postalCode} {inv.buyer.city}</p>}
              {inv.buyer.email && <p className="text-muted-foreground mt-1">{inv.buyer.email}</p>}
            </address>
          </section>

          <table className="w-full text-sm mt-6">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 font-medium">Omschrijving</th>
                <th className="py-2 font-medium w-28 text-right">Bedrag</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((line) => (
                <tr key={line.sku} className="border-b">
                  <td className="py-2">
                    {line.name}
                    <span className="block text-xs text-muted-foreground font-mono">Werkorder {line.sku}</span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatEur(line.lineTotalEur)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-6 flex justify-end">
            <dl className="w-full max-w-xs text-sm space-y-1">
              {/* Only when btw is actually charged. A monteur on the
                  kleineondernemersregeling has vatRate 0, and printing
                  "Bedrag excl. btw \u20ac 50,00 / Btw 0% \u20ac 0,00 / Totaal
                  \u20ac 50,00" next to the exemption statement in the footer
                  reads as an invoice charging btw at a zero rate. It is an
                  exempt supply: one amount, and the reason for the exemption,
                  which src/lib/monteur-invoicing.ts requires in the footer
                  before it will issue at 0%. */}
              {inv.vatRate > 0 && (
                <>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Bedrag excl. btw</dt>
                    <dd className="tabular-nums">{formatEur(inv.totalEur - inv.vatEur)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Btw {Math.round(inv.vatRate * 100)}%</dt>
                    <dd className="tabular-nums">{formatEur(inv.vatEur)}</dd>
                  </div>
                </>
              )}
              <div className="flex justify-between border-t pt-2 font-bold text-base">
                <dt>Totaal</dt>
                <dd className="tabular-nums">{formatEur(inv.totalEur)}</dd>
              </div>
            </dl>
          </div>

          <footer className="mt-8 pt-6 border-t text-xs text-muted-foreground space-y-1">
            {inv.footer
              ? <p>{inv.footer}</p>
              : inv.dueAt && <p>Betaling graag binnen de termijn, vóór {formatDate(inv.dueAt)}, onder vermelding van factuurnummer {inv.number}.</p>}
            <p>Gemaakt met WasFix Pro.</p>
          </footer>
        </article>
      </div>
    </div>
  );
}
