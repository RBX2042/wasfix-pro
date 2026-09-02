import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import Link from "next/link";
import { formatEur } from "@/lib/utils";
import { DeleteButton, EditPartButton, NewPartButton, deletePart, type PartRow } from "../_lib/catalog-forms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin: onderdelen" };

export default async function AdminPartsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const hasDb = isDatabaseConfigured();
  let parts: PartRow[] = [];
  try {
    if (hasDb) {
      parts = await prisma.part.findMany({ orderBy: { sku: "asc" } });
    } else {
      throw new Error("no database");
    }
  } catch {
    const { parts: staticPartList } = await import("@/lib/static-db");
    parts = [...staticPartList].sort((a, b) => a.sku.localeCompare(b.sku)) as PartRow[];
  }

  return (
    <DashboardLayout role={user.role}>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">Onderdelen beheren</h1>
          <p className="text-muted-foreground text-sm">{parts.length} onderdelen</p>
        </div>
        {hasDb && <NewPartButton />}
      </div>

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
                <th className="p-3 text-right">Voorraad</th>
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
                  <td className="p-3 text-right">
                    {p.stock > 10 ? <span className="text-emerald-600">{p.stock}</span> : p.stock > 0 ? <span className="text-amber-600">{p.stock}</span> : <span className="text-destructive">0</span>}
                  </td>
                  <td className="p-3">
                    {hasDb && (
                      <div className="flex items-center justify-end gap-1">
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
    </DashboardLayout>
  );
}
