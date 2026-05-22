import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";


export const metadata = { title: "Admin: gebruikers" };

export default async function AdminUsersPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <DashboardLayout role={user.role}>
      <h1 className="font-heading text-2xl font-bold mb-6">Gebruikers ({users.length})</h1>

      <Card>
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="p-3">E-mail</th>
              <th className="p-3">Naam</th>
              <th className="p-3">Rol</th>
              <th className="p-3">Plan</th>
              <th className="p-3 text-right">Diagnoses</th>
              <th className="p-3">Lid sinds</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t hover:bg-muted/30">
                <td className="p-3 font-medium">{u.email}</td>
                <td className="p-3 text-muted-foreground">{u.name ?? "—"}</td>
                <td className="p-3"><Badge variant="outline">{u.role}</Badge></td>
                <td className="p-3"><Badge variant="accent">{u.plan}</Badge></td>
                <td className="p-3 text-right">{u.diagnosesUsed}</td>
                <td className="p-3 text-muted-foreground">{formatDate(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </DashboardLayout>
  );
}
