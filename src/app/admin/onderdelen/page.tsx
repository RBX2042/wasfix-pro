import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import Link from "next/link";
import { formatEur } from "@/lib/utils";
import { Plus, Edit } from "lucide-react";

export const dynamic = "force-dynamic";


export const metadata = { title: "Admin: onderdelen" };

export default async function AdminPartsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const parts = await prisma.part.findMany({ orderBy: { sku: "asc" } });

  return (
    <DashboardLayout role={user.role}>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-2xl font-bold">Onderdelen beheren</h1>
        <Button>
          <Plus className="h-4 w-4" /> Nieuw onderdeel
        </Button>
      </div>

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
                    <Button size="icon" variant="ghost" className="h-7 w-7"><Edit className="h-3 w-3" /></Button>
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
