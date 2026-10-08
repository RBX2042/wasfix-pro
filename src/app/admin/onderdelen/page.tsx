import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import Link from "next/link";
import { formatEur } from "@/lib/utils";
import { costBasis } from "@/lib/invoicing";
import { AdminShell } from "../_lib/page-shell";
import { AdminNav } from "../_lib/admin-nav";
import { reservedByPart } from "../_lib/orders-query";
import { AdjustStockButton, DeleteButton, EditPartButton, NewPartButton, deletePart, type PartRow } from "../_lib/catalog-forms";
import { ImportPanel } from "./import-panel";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin: onderdelen" };

export default async function AdminPartsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const hasDb = isDatabaseConfigured();
  let parts: PartRow[] = [];
  try {
    if (hasDb) {
      const found = await prisma.part.findMany({ orderBy: { sku: "asc" } });
      const reserved = await reservedByPart();
      parts = found.map((p) => ({ ...p, reserved: reserved.get(p.id) ?? 0 }));
    } else {
      throw new Error("no database");
    }
  } catch {
    const { parts: staticPartList } = await import("@/lib/static-db");
    parts = [...staticPartList].sort((a, b) => a.sku.localeCompare(b.sku)) as PartRow[];
  }

  // The demo seed fills every part with generated stock. If (nearly) all stock still equals
  // those numbers, nobody has counted the shelves yet and the shop would sell units it does not have.
  let stockNotCounted = false;
  if (hasDb && parts.length > 0) {
    try {
      const { parts: seed } = await import("@/lib/static-db");
      const seedStock = new Map(seed.map((s) => [s.sku, s.stock]));
      const equal = parts.filter((p) => seedStock.get(p.sku) === p.stock && p.stock > 0).length;
      stockNotCounted = equal / parts.length >= 0.9;
    } catch {
      /* no static data: no banner */
    }
  }

  return (
    <DashboardLayout role={user.role}>
      <AdminShell>
      <AdminNav current="/admin/onderdelen" />
      <div className="flex flex-wrap items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">Onderdelen beheren</h1>
          <p className="text-muted-foreground text-sm">{parts.length} onderdelen</p>
        </div>
        {hasDb && <NewPartButton />}
      </div>

      {stockNotCounted && (
        <Card className="mb-4 border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
          <div className="p-4 text-sm">
            <p className="font-semibold">Voorraad nog niet geteld</p>
            <p className="text-muted-foreground">Bijna alle voorraadaantallen zijn nog de voorbeeldcijfers uit de seed. Tel de planken en zet de echte aantallen via CSV-import of &ldquo;Voorraad&rdquo; achter elk onderdeel voordat je verkoopt.</p>
          </div>
        </Card>
      )}

      {hasDb && <ImportPanel />}

      {!hasDb && (
        <Card className="mb-4">
          <div className="p-4 text-sm text-muted-foreground">
            Read-only: zonder <code className="bg-muted px-1 rounded text-xs">DATABASE_URL</code> komt de catalogus uit
            <code className="bg-muted px-1 rounded text-xs ml-1">src/data</code> en kan hij niet in de browser worden bewerkt.
          </div>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="p-3">SKU</th>
                <th className="p-3">Naam</th>
                <th className="p-3">Merk</th>
                <th className="p-3">Categorie</th>
                <th className="p-3 text-right">Prijs</th>
                <th className="p-3 text-right">Marge</th>
                <th className="p-3 text-right">Voorraad</th>
                <th className="p-3 text-right" title="Verkocht en nog niet verzonden; al van de voorraad afgehaald">Gereserveerd</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.id} className="border-t hover:bg-muted/30">
                  <td className="p-3 font-mono">{p.sku}</td>
                  <td className="p-3">
                    <Link href={`/onderdelen/${p.sku}`} className="hover:text-primary">{p.name}</Link>
                  </td>
                  <td className="p-3"><Badge variant="outline">{p.brand}</Badge></td>
                  <td className="p-3 text-muted-foreground">{p.category}</td>
                  <td className="p-3 text-right font-medium">{formatEur(p.priceEur)}</td>
                  <td className="p-3 text-right tabular-nums">
                    {(() => {
                      const cost = (p as { costEur?: number | null }).costEur;
                      const basis = costBasis({ costEur: cost, costSource: (p as { costSource?: string | null }).costSource });
                      if (basis === "UNKNOWN") {
                        return <span className="text-xs text-amber-600">geen inkoop</span>;
                      }
                      const net = p.priceEur / 1.21;
                      const pct = net > 0 ? ((net - (cost as number)) / net) * 100 : 0;
                      // Only a cost from a real quote is a margin; the rest is labelled "schatting" (D8).
                      return (
                        <span className={basis === "QUOTE" ? (pct < 20 ? "text-amber-600" : "text-emerald-600") : "text-muted-foreground"}>
                          {pct.toFixed(0)}%{basis === "ESTIMATE" && <span className="ml-1 text-[10px] uppercase">schatting</span>}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="p-3 text-right">
                    {p.stock > 10 ? <span className="text-emerald-600">{p.stock}</span> : p.stock > 0 ? <span className="text-amber-600">{p.stock}</span> : <span className="text-destructive">0</span>}
                  </td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">{p.reserved ? p.reserved : "–"}</td>
                  <td className="p-3">
                    {hasDb && (
                      <div className="flex items-center justify-end gap-1">
                        <AdjustStockButton part={p} />
                        <EditPartButton part={p} />
                        <DeleteButton id={p.id} label={p.sku} action={deletePart} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AdminShell>
    </DashboardLayout>
  );
}
