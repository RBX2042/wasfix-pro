import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { env, isDatabaseConfigured } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { COMPANY, realOrNull } from "@/lib/plans";
import { orderRef } from "@/lib/order-status";
import { dateNl, parseShippingAddress } from "../../../_lib/format";
import { PrintStyles } from "../../print-styles";
import { PrintButton } from "../../print-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pakbon", robots: { index: false, follow: false } };

/**
 * Packing slip: what goes in the box. No prices (the invoice has those) but the
 * SKUs to pick, tick boxes, the delivery note, and how to return.
 */
export default async function PackingSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");
  if (!isDatabaseConfigured()) notFound();
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: { include: { part: { select: { sku: true, name: true } } } }, invoice: { select: { number: true } } },
  });
  if (!order) notFound();
  const a = parseShippingAddress(order.shippingAddress);
  const retourUrl = `${env.APP_URL.replace(/\/+$/, "")}/retour/start`;
  const street = realOrNull(COMPANY.street);
  const postal = realOrNull(COMPANY.postalCode);
  const returnAddress = street && postal ? `${COMPANY.name}, ${street}, ${postal} ${COMPANY.city}` : null;

  return (
    <div className="min-h-screen bg-muted/30 py-8 print:bg-white print:py-0">
      <PrintStyles />
      <div className="mx-auto max-w-3xl px-4 print:px-0 print:max-w-none">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link href="/admin/bestellingen" className="text-sm text-muted-foreground hover:text-foreground">← Terug naar bestellingen</Link>
          <PrintButton />
        </div>
        <article className="rounded-lg border bg-background p-8 print:border-0 print:p-0">
          <header className="flex flex-wrap justify-between gap-6 border-b pb-4">
            <div>
              <h1 className="font-heading text-2xl font-bold">Pakbon</h1>
              <p className="mt-2 font-mono text-lg">#{orderRef(order.id)}</p>
              <p className="text-sm text-muted-foreground">Besteld op {dateNl(order.createdAt)}{order.invoice && ` · factuur ${order.invoice.number}`}</p>
            </div>
            <p className="text-sm text-right">{COMPANY.name}</p>
          </header>

          <section className="py-4 border-b">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Verzenden naar</h2>
            <address className="not-italic text-base">
              <p className="font-semibold">{a.name}</p>
              {a.street && <p>{a.street}</p>}
              <p>{[a.postalCode, a.city].filter(Boolean).join(" ")}</p>
              <p>{a.country}</p>
              {order.phone && <p className="text-sm text-muted-foreground mt-1">Tel. {order.phone}</p>}
            </address>
            {order.customerNote && <p className="mt-3 border-l-4 border-amber-400 pl-3 text-sm"><span className="font-semibold">Opmerking klant:</span> {order.customerNote}</p>}
          </section>

          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 w-10">Klaar</th>
                <th className="py-2 w-16 text-right">Aantal</th>
                <th className="py-2 pl-4 w-40">SKU</th>
                <th className="py-2">Omschrijving</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((i) => (
                <tr key={i.id} className="border-b">
                  <td className="py-3"><span className="inline-block h-4 w-4 border border-foreground" aria-hidden /></td>
                  <td className="py-3 text-right text-lg font-bold tabular-nums">{i.quantity}</td>
                  <td className="py-3 pl-4 font-mono">{i.part.sku}</td>
                  <td className="py-3">{i.part.name}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <footer className="mt-8 text-xs text-muted-foreground space-y-1">
            <p>Niet goed of niet nodig? Je hebt 30 dagen bedenktijd. Vraag je retour aan via {retourUrl} met je bestelnummer #{orderRef(order.id)}.</p>
            {returnAddress ? <p>Stuur nooit zomaar iets terug: wacht op je RMA-nummer. Retouradres: {returnAddress}.</p> : <p>Het retouradres staat in de e-mail met je RMA-nummer.</p>}
          </footer>
        </article>
      </div>
    </div>
  );
}
