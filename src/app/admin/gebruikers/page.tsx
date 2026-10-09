import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import { formatDate } from "@/lib/utils";
import { AdminShell } from "../_lib/page-shell";
import { AdminNav } from "../_lib/admin-nav";
import { accountStats } from "../_lib/economics";

export const dynamic = "force-dynamic";


export const metadata = { title: "Admin: gebruikers" };

export default async function AdminUsersPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  let users: Awaited<ReturnType<typeof prisma.user.findMany>> = [];
  let accounts = 0;
  let guests = 0;
  try {
    // Accounts are people who signed up (they have a Clerk id). Every guest checkout also creates a User row so
    // the order has an owner; those are not users and are counted apart, their details live on the order.
    const [rows, stats] = await Promise.all([
      prisma.user.findMany({ where: { clerkId: { not: null } }, orderBy: { createdAt: "desc" }, take: 500 }),
      accountStats(),
    ]);
    users = rows;
    accounts = stats.accounts;
    guests = stats.guests;
  } catch { /* DB unreachable */ }

  return (
    <DashboardLayout role={user.role}>
      <AdminShell>
      <AdminNav current="/admin/gebruikers" />
      <h1 className="font-heading text-2xl font-bold mb-1">Gebruikers ({accounts})</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Alleen accounts. {guests} gast{guests === 1 ? "" : "en"} bestelde{guests === 1 ? "" : "n"} zonder account; hun gegevens staan bij de bestelling in{" "}
        <a className="underline" href="/admin/bestellingen">Bestellingen</a>.{accounts > users.length ? ` De ${users.length} nieuwste worden getoond.` : ""}
      </p>

      <Card>
        <div className="overflow-x-auto">
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
        </div>
      </Card>
      </AdminShell>
    </DashboardLayout>
  );
}
