import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import Link from "next/link";
import { formatEur, formatDate } from "@/lib/utils";
import { MessageCircle, Package, Wrench, ArrowRight, TrendingUp, Sparkles, Crown } from "lucide-react";

export const dynamic = "force-dynamic";


export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen");

  let diagnoses: Awaited<ReturnType<typeof prisma.diagnosis.findMany>> = [];
  let orders: Awaited<ReturnType<typeof prisma.order.findMany>> = [];
  let savedMachines: Array<{ id: string; machine: { brand: string; model: string } }> = [];
  let totalSpent: { _sum: { totalEur: number | null } } = { _sum: { totalEur: 0 } };
  try {
    [diagnoses, orders, savedMachines] = await Promise.all([
      prisma.diagnosis.findMany({ where: { userId: user.id }, take: 5, orderBy: { createdAt: "desc" } }),
      prisma.order.findMany({ where: { userId: user.id }, take: 5, orderBy: { createdAt: "desc" } }),
      prisma.savedMachine.findMany({ where: { userId: user.id }, include: { machine: true } }),
    ]);

    totalSpent = await prisma.order.aggregate({
      where: { userId: user.id, status: { in: ["PAID", "SHIPPED", "DELIVERED"] } },
      _sum: { totalEur: true },
    });
  } catch {
    // DB unreachable — show empty dashboard
  }

  return (
    <DashboardLayout role={user.role}>
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl font-bold">Welkom terug, {user.name?.split(" ")[0]}!</h1>
          <div className="text-muted-foreground flex items-center gap-2 mt-1">
            <span>Plan:</span> <Badge variant="accent">{user.plan}</Badge>
            {user.plan === "FREE" && (
              <Link href="/prijzen" className="text-primary text-sm hover:underline">
                Upgrade voor onbeperkt →
              </Link>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={<MessageCircle className="h-4 w-4" />} label="Diagnoses" value={diagnoses.length.toString()} />
          <StatCard icon={<Package className="h-4 w-4" />} label="Bestellingen" value={orders.length.toString()} />
          <StatCard icon={<Wrench className="h-4 w-4" />} label="Wasmachines" value={savedMachines.length.toString()} />
          <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Totaal besteed" value={formatEur(totalSpent._sum.totalEur ?? 0)} />
        </div>

        {/* Quick actions */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="bg-primary text-primary-foreground">
            <CardContent className="p-6">
              <Sparkles className="h-8 w-8 mb-3" />
              <h2 className="font-heading text-xl font-bold mb-1">Start een nieuwe diagnose</h2>
              <p className="text-sm text-primary-foreground/80 mb-4">
                Heeft je wasmachine een probleem? Onze AI helpt je in 2 minuten.
              </p>
              <Button asChild variant="accent">
                <Link href="/diagnose">Nu starten <ArrowRight className="h-4 w-4" /></Link>
              </Button>
            </CardContent>
          </Card>

          {user.plan === "FREE" && (
            <Card className="border-accent/30 bg-accent/5">
              <CardContent className="p-6">
                <Crown className="h-8 w-8 mb-3 text-accent" />
                <h2 className="font-heading text-xl font-bold mb-1">Upgrade naar Particulier</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Onbeperkte diagnoses, premium gidsen en 5% korting op onderdelen.
                </p>
                <Button asChild>
                  <Link href="/prijzen">Bekijk plans</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Recent diagnoses */}
        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-heading text-lg font-semibold">Recente diagnoses</h2>
              <Link href="/dashboard/diagnoses" className="text-sm text-primary hover:underline">Alles bekijken →</Link>
            </div>
            {diagnoses.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Nog geen diagnoses. <Link href="/diagnose" className="text-primary hover:underline">Start je eerste diagnose →</Link></p>
            ) : (
              <div className="space-y-2">
                {diagnoses.map((d) => {
                  const result = d.result ? JSON.parse(d.result) : null;
                  return (
                    <div key={d.id} className="flex items-center gap-4 p-3 rounded-md border">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{d.brand}</Badge>
                          {result?.errorCode && <span className="text-sm font-medium text-primary">{result.errorCode}</span>}
                        </div>
                        <p className="text-sm mt-1 line-clamp-1">{result?.mainCause ?? d.symptoms}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{formatDate(d.createdAt)}</p>
                      </div>
                      {result?.confidence && (
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold">{result.confidence}%</p>
                          <p className="text-xs text-muted-foreground">match</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent orders */}
        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-heading text-lg font-semibold">Recente bestellingen</h2>
              <Link href="/dashboard/bestellingen" className="text-sm text-primary hover:underline">Alles bekijken →</Link>
            </div>
            {orders.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Nog geen bestellingen. <Link href="/onderdelen" className="text-primary hover:underline">Bekijk onderdelen →</Link></p>
            ) : (
              <div className="space-y-2">
                {orders.map((o) => (
                  <Link key={o.id} href={`/bestelling/${o.id}`}>
                    <div className="flex items-center gap-4 p-3 rounded-md border hover:border-primary transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">#{o.id.slice(0, 8).toUpperCase()}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(o.createdAt)}</p>
                      </div>
                      <Badge variant={o.status === "PAID" || o.status === "DELIVERED" ? "success" : "secondary"}>{o.status}</Badge>
                      <span className="font-bold whitespace-nowrap">{formatEur(o.totalEur)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
          {icon} {label}
        </div>
        <p className="font-heading text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
