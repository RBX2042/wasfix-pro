import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import { Plus, Edit } from "lucide-react";

export const dynamic = "force-dynamic";


export const metadata = { title: "Admin: foutcodes" };

export default async function AdminErrorCodesPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  let codes: Awaited<ReturnType<typeof prisma.errorCode.findMany<{ include: { machine: true } }>>> = [];
  try {
    codes = await prisma.errorCode.findMany({
      include: { machine: true },
      orderBy: [{ machine: { brand: "asc" } }, { code: "asc" }],
    });
  } catch {
    const { staticErrorCodes } = await import("@/lib/static-db");
    codes = staticErrorCodes() as typeof codes;
  }

  return (
    <DashboardLayout role={user.role}>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-2xl font-bold">Foutcodes beheren</h1>
        <Button><Plus className="h-4 w-4" /> Nieuwe foutcode</Button>
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="p-3">Code</th>
              <th className="p-3">Merk / Model</th>
              <th className="p-3">Titel</th>
              <th className="p-3">Severity</th>
              <th className="p-3">DIY</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {codes.map((ec) => (
              <tr key={ec.id} className="border-t hover:bg-muted/30">
                <td className="p-3 font-mono font-bold text-primary">{ec.code}</td>
                <td className="p-3"><Badge variant="outline">{ec.machine.brand}</Badge> <span className="text-xs text-muted-foreground">{ec.machine.model}</span></td>
                <td className="p-3">{ec.title}</td>
                <td className="p-3"><Badge variant={ec.severity === "HIGH" ? "danger" : ec.severity === "MEDIUM" ? "warning" : "secondary"}>{ec.severity}</Badge></td>
                <td className="p-3">{ec.diyFriendly ? "✓" : "✗"}</td>
                <td className="p-3"><Button size="icon" variant="ghost" className="h-7 w-7"><Edit className="h-3 w-3" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </DashboardLayout>
  );
}
