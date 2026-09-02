import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import Link from "next/link";
import { isDatabaseConfigured } from "@/lib/env";
import { DeleteButton, EditGuideButton, NewGuideButton, deleteGuide, type GuideRow } from "../_lib/catalog-forms";

export const dynamic = "force-dynamic";


export const metadata = { title: "Admin: gidsen" };

export default async function AdminGuidesPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const hasDb = isDatabaseConfigured();
  let guides: Array<GuideRow & { views: number }> = [];
  try {
    if (!hasDb) throw new Error("no database");
    guides = await prisma.repairGuide.findMany({ orderBy: { views: "desc" } });
  } catch {
    const { guides: staticGuideList } = await import("@/lib/static-db");
    guides = [...staticGuideList].sort((a, b) => b.views - a.views) as typeof guides;
  }

  return (
    <DashboardLayout role={user.role}>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">Reparatiegidsen beheren</h1>
          <p className="text-muted-foreground text-sm">{guides.length} gidsen</p>
        </div>
        {hasDb && <NewGuideButton />}
      </div>

      {!hasDb && (
        <Card className="mb-4">
          <div className="p-4 text-sm text-muted-foreground">
            Read-only: zonder <code className="bg-muted px-1 rounded text-xs">DATABASE_URL</code> komen de gidsen uit
            <code className="bg-muted px-1 rounded text-xs ml-1">src/data</code>.
          </div>
        </Card>
      )}

      <Card>
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="p-3">Titel</th>
              <th className="p-3">Moeilijkheid</th>
              <th className="p-3">Tijd</th>
              <th className="p-3">Premium</th>
              <th className="p-3 text-right">Views</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {guides.map((g) => (
              <tr key={g.id} className="border-t hover:bg-muted/30">
                <td className="p-3"><Link href={`/gidsen/${g.slug}`} className="hover:text-primary font-medium">{g.title}</Link></td>
                <td className="p-3"><Badge variant="outline">{g.difficulty}</Badge></td>
                <td className="p-3 text-muted-foreground">{g.timeMinutes} min</td>
                <td className="p-3">{g.isPremium ? <Badge variant="accent">Premium</Badge> : <Badge variant="secondary">Gratis</Badge>}</td>
                <td className="p-3 text-right font-medium">{g.views.toLocaleString("nl-NL")}</td>
                <td className="p-3">
                  {hasDb && (
                    <div className="flex items-center justify-end gap-1">
                      <EditGuideButton guide={g} />
                      <DeleteButton id={g.id} label={g.title} action={deleteGuide} />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </DashboardLayout>
  );
}
