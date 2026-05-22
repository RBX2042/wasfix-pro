import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Wrench, Plus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";


export const metadata = { title: "Mijn wasmachines" };

export default async function MyMachinesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen");

  let saved: Awaited<ReturnType<typeof prisma.savedMachine.findMany<{
    include: { machine: { include: { _count: { select: { errorCodes: true } } } } };
  }>>> = [];
  try {
    saved = await prisma.savedMachine.findMany({
      where: { userId: user.id },
      include: { machine: { include: { _count: { select: { errorCodes: true } } } } },
    });
  } catch {
    // DB unreachable
  }

  return (
    <DashboardLayout role={user.role}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold">Mijn wasmachines</h1>
          <p className="text-muted-foreground text-sm">Bewaar je wasmachines voor snellere diagnoses</p>
        </div>
        <Button asChild>
          <Link href="/merken"><Plus className="h-4 w-4" /> Wasmachine toevoegen</Link>
        </Button>
      </div>

      {saved.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Wrench className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground mb-4">Voeg je wasmachine toe voor snellere diagnoses en gepersonaliseerde gidsen.</p>
            <Button asChild><Link href="/merken">Bekijk merken</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {saved.map((s) => (
            <Card key={s.id} className="hover:border-primary transition-colors">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <Badge variant="outline" className="mb-2">{s.machine.brand}</Badge>
                    <h3 className="font-heading font-semibold">{s.nickname ?? s.machine.model}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{s.machine.brand} {s.machine.model}</p>
                    <p className="text-xs text-muted-foreground mt-1">{s.machine._count.errorCodes} foutcodes beschikbaar</p>
                  </div>
                  <Link href={`/merken/${encodeURIComponent(s.machine.brand)}/${encodeURIComponent(s.machine.model)}`} className="text-primary text-sm hover:underline flex items-center gap-1">
                    Bekijk <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
