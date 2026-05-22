import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser, getPlanLimits } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { formatEur } from "@/lib/utils";
import { Package, ShoppingCart, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";


export const metadata = { title: "Bulk onderdelen — Monteur" };

export default async function MonteurOnderdelenPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen");

  const limits = getPlanLimits(user.plan);
  const parts = await prisma.part.findMany({
    where: { stock: { gt: 0 } },
    orderBy: [{ stock: "desc" }, { priceEur: "asc" }],
  });

  return (
    <DashboardLayout role={user.role}>
      <div className="mb-6">
        <Badge variant="accent" className="mb-2">Monteur Pro</Badge>
        <h1 className="font-heading text-2xl font-bold">Bulk onderdelen bestellen</h1>
        <p className="text-muted-foreground text-sm">
          {(limits.partsDiscount * 100).toFixed(0)}% monteurkorting wordt automatisch toegepast op alle bestellingen.
        </p>
      </div>

      {limits.partsDiscount > 0 && (
        <Card className="mb-6 border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-emerald-500/20 flex items-center justify-center text-emerald-600">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-sm">Jouw monteurkorting is actief</p>
              <p className="text-xs text-muted-foreground">{(limits.partsDiscount * 100).toFixed(0)}% korting op alle onderdelen + gratis verzending vanaf €50</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {parts.map((p) => {
          const discounted = p.priceEur * (1 - limits.partsDiscount);
          const lowStock = p.stock < 10;
          return (
            <Card key={p.id} className="hover:border-primary transition-colors">
              <CardContent className="p-4">
                <div className="flex gap-3">
                  {p.imageUrl && (
                    <Image src={p.imageUrl} alt={p.name} width={64} height={64} className="h-16 w-16 rounded bg-muted object-cover shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium line-clamp-2">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.sku} · {p.brand}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <div>
                    {limits.partsDiscount > 0 ? (
                      <>
                        <span className="text-xs text-muted-foreground line-through">{formatEur(p.priceEur)}</span>
                        <span className="text-lg font-bold text-primary ml-2">{formatEur(discounted)}</span>
                      </>
                    ) : (
                      <span className="text-lg font-bold text-primary">{formatEur(p.priceEur)}</span>
                    )}
                  </div>
                  {lowStock ? (
                    <Badge variant="warning" className="text-[10px] gap-1"><AlertTriangle className="h-3 w-3" /> {p.stock}</Badge>
                  ) : (
                    <Badge variant="success" className="text-[10px]">Voorraad: {p.stock}</Badge>
                  )}
                </div>
                <Button asChild size="sm" variant="outline" className="w-full mt-3">
                  <Link href={`/onderdelen/${p.sku}`}>
                    <ShoppingCart className="h-3 w-3" /> Bestellen
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </DashboardLayout>
  );
}
