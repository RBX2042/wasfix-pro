import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";


export const metadata = { title: "Mijn diagnoses" };

export default async function DiagnosesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen");

  let diagnoses: Awaited<ReturnType<typeof prisma.diagnosis.findMany>> = [];
  try {
    diagnoses = await prisma.diagnosis.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
  } catch { /* DB unreachable */ }

  return (
    <DashboardLayout role={user.role}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold">Mijn diagnoses</h1>
          <p className="text-muted-foreground text-sm">{diagnoses.length} diagnoses uitgevoerd</p>
        </div>
        <Button asChild>
          <Link href="/diagnose"><Sparkles className="h-4 w-4" /> Nieuwe diagnose</Link>
        </Button>
      </div>

      {diagnoses.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Sparkles className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground mb-4">Je hebt nog geen diagnoses uitgevoerd.</p>
            <Button asChild><Link href="/diagnose">Start je eerste diagnose</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {diagnoses.map((d) => {
            const result = d.result ? JSON.parse(d.result) : null;
            return (
              <Card key={d.id} className="hover:border-primary transition-colors">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <Badge variant="outline">{d.brand}</Badge>
                        {result?.errorCode && <Badge>{result.errorCode}</Badge>}
                        {result?.diyFriendly && <Badge variant="success" className="text-[10px]">Zelf oplosbaar</Badge>}
                      </div>
                      <p className="font-medium">{result?.mainCause ?? d.symptoms}</p>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{result?.recommendedAction}</p>
                      <p className="text-xs text-muted-foreground mt-2">{formatDate(d.createdAt)}</p>
                    </div>
                    {result?.confidence && (
                      <div className="text-right shrink-0">
                        <p className="font-heading text-2xl font-bold text-primary">{result.confidence}%</p>
                        <p className="text-xs text-muted-foreground">zekerheid</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </DashboardLayout>
  );
}
