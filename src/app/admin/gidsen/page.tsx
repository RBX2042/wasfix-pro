import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Edit } from "lucide-react";

export const dynamic = "force-dynamic";


export const metadata = { title: "Admin: gidsen" };

export default async function AdminGuidesPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  let guides: Awaited<ReturnType<typeof prisma.repairGuide.findMany>> = [];
  try {
    guides = await prisma.repairGuide.findMany({ orderBy: { views: "desc" } });
  } catch {
    const { guides: staticGuideList } = await import("@/lib/static-db");
    guides = [...staticGuideList].sort((a, b) => b.views - a.views).map((g) => ({ ...g, createdAt: new Date(g.createdAt) })) as typeof guides;
  }

  return (
    <DashboardLayout role={user.role}>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-2xl font-bold">Reparatiegidsen beheren</h1>
        <Button><Plus className="h-4 w-4" /> Nieuwe gids</Button>
      </div>

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
                  <Button size="icon" variant="ghost" className="h-7 w-7"><Edit className="h-3 w-3" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </DashboardLayout>
  );
}
