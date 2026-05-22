import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import { formatDate, formatEur } from "@/lib/utils";
import Link from "next/link";
import { Package, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";


export const metadata = { title: "Mijn bestellingen" };

const STATUS_VARIANT: Record<string, any> = {
  PENDING: "warning",
  PAID: "success",
  SHIPPED: "default",
  DELIVERED: "success",
  CANCELLED: "danger",
};

export default async function OrdersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen");

  const orders = await prisma.order.findMany({
    where: { userId: user.id },
    include: { items: { include: { part: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <DashboardLayout role={user.role}>
      <h1 className="font-heading text-2xl font-bold mb-1">Mijn bestellingen</h1>
      <p className="text-muted-foreground text-sm mb-6">{orders.length} bestellingen</p>

      {orders.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Package className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground mb-4">Nog geen bestellingen.</p>
            <Link href="/onderdelen" className="text-primary hover:underline">Bekijk onderdelen →</Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <Link key={o.id} href={`/bestelling/${o.id}`}>
              <Card className="hover:border-primary transition-colors">
                <CardContent className="p-5">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-mono font-medium text-sm">#{o.id.slice(0, 8).toUpperCase()}</p>
                        <Badge variant={STATUS_VARIANT[o.status] ?? "secondary"}>{o.status}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{formatDate(o.createdAt)} · {o.items.length} onderdelen</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {o.items.slice(0, 3).map((it) => (
                          <span key={it.id} className="text-xs text-muted-foreground">{it.part.name}{o.items.indexOf(it) < o.items.length - 1 && o.items.indexOf(it) < 2 && ", "}</span>
                        ))}
                        {o.items.length > 3 && <span className="text-xs text-muted-foreground">+ {o.items.length - 3} meer</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-heading text-xl font-bold">{formatEur(o.totalEur)}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
