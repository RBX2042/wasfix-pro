import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { orderRef } from "@/lib/order-status";
import { dateTimeNl } from "../../_lib/format";
import { pickList } from "../../_lib/orders-query";
import { PrintStyles } from "../print-styles";
import { PrintButton } from "../print-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pick-lijst", robots: { index: false, follow: false } };

/** All paid orders waiting to ship, summed per SKU, so one walk along the shelves fills every box. */
export default async function PickListPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");
  if (!isDatabaseConfigured()) notFound();
  const { skus, orders } = await pickList();
  const total = skus.reduce((s, r) => s + r.quantity, 0);

  return (
    <div className="min-h-screen bg-muted/30 py-8 print:bg-white print:py-0">
      <PrintStyles />
      <div className="mx-auto max-w-3xl px-4 print:px-0 print:max-w-none">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link href="/admin/bestellingen" className="text-sm text-muted-foreground hover:text-foreground">← Terug naar bestellingen</Link>
          <PrintButton />
        </div>
        <article className="rounded-lg border bg-background p-8 print:border-0 print:p-0">
          <h1 className="font-heading text-2xl font-bold">Pick-lijst</h1>
          <p className="text-sm text-muted-foreground">{orders} bestelling{orders === 1 ? "" : "en"} te verzenden · {total} stuks · {dateTimeNl(new Date())}</p>
          {skus.length === 0 ? (
            <p className="mt-6 text-sm">Niets te picken: er zijn geen betaalde bestellingen die nog verzonden moeten worden.</p>
          ) : (
            <div className="overflow-x-auto"><table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 w-10">Klaar</th>
                  <th className="py-2 w-20 text-right">Totaal</th>
                  <th className="py-2 pl-4 w-40">SKU</th>
                  <th className="py-2">Omschrijving</th>
                  <th className="py-2 w-24 text-right" title="Wat volgens het systeem op de plank hoort te liggen, inclusief dit en andere onverzonden bestellingen">Op de plank</th>
                  <th className="py-2 pl-4">Bestellingen</th>
                </tr>
              </thead>
              <tbody>
                {skus.map((r) => (
                  <tr key={r.sku} className="border-b align-top">
                    <td className="py-3"><span className="inline-block h-4 w-4 border border-foreground" aria-hidden /></td>
                    <td className="py-3 text-right text-lg font-bold tabular-nums">{r.quantity}</td>
                    <td className="py-3 pl-4 font-mono">{r.sku}</td>
                    <td className="py-3">{r.name}</td>
                    <td className={`py-3 text-right tabular-nums ${r.onShelf < r.quantity ? "text-red-600 font-semibold" : ""}`}>{r.onShelf}</td>
                    <td className="py-3 pl-4 text-xs font-mono">{r.orders.map((o) => `#${orderRef(o.orderId)}${o.quantity > 1 ? ` (${o.quantity}×)` : ""}`).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </article>
      </div>
    </div>
  );
}
