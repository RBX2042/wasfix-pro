import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import { isDatabaseConfigured } from "@/lib/env";
import { DeleteButton, EditErrorCodeButton, NewErrorCodeButton, deleteErrorCode, type ErrorCodeRow, type MachineOption } from "../_lib/catalog-forms";

export const dynamic = "force-dynamic";


export const metadata = { title: "Admin: foutcodes" };

export default async function AdminErrorCodesPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const hasDb = isDatabaseConfigured();
  let codes: Array<ErrorCodeRow & { machine: { brand: string; model: string } }> = [];
  let machines: MachineOption[] = [];
  try {
    if (!hasDb) throw new Error("no database");
    [codes, machines] = await Promise.all([
      prisma.errorCode.findMany({
        include: { machine: true },
        orderBy: [{ machine: { brand: "asc" } }, { code: "asc" }],
      }),
      prisma.washingMachine
        .findMany({ orderBy: [{ brand: "asc" }, { model: "asc" }] })
        .then((rows) => rows.map((m) => ({ id: m.id, label: `${m.brand} ${m.model}` }))),
    ]);
  } catch {
    const { staticErrorCodes, machines: staticMachines } = await import("@/lib/static-db");
    codes = staticErrorCodes() as typeof codes;
    machines = staticMachines.map((m) => ({ id: m.id, label: `${m.brand} ${m.model}` }));
  }

  return (
    <DashboardLayout role={user.role}>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">Foutcodes beheren</h1>
          <p className="text-muted-foreground text-sm">{codes.length} foutcodes</p>
        </div>
        {hasDb && <NewErrorCodeButton machines={machines} />}
      </div>

      {!hasDb && (
        <Card className="mb-4">
          <div className="p-4 text-sm text-muted-foreground">
            Read-only: zonder <code className="bg-muted px-1 rounded text-xs">DATABASE_URL</code> komen de foutcodes uit
            <code className="bg-muted px-1 rounded text-xs ml-1">src/data</code>.
          </div>
        </Card>
      )}

      <Card>
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="p-3">Code</th>
              <th className="p-3">Merk / Model</th>
              <th className="p-3">Titel</th>
              <th className="p-3">Severity</th>
              <th className="p-3">DIY</th>
              <th className="p-3">Bron</th>
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
                <td className="p-3">
                  {ec.provenance === "VERIFIED" ? (
                    <Badge variant="success">Gecontroleerd</Badge>
                  ) : (
                    <Badge variant="secondary">Nog nalopen</Badge>
                  )}
                </td>
                <td className="p-3">
                  {hasDb && (
                    <div className="flex items-center justify-end gap-1">
                      <EditErrorCodeButton errorCode={ec} machines={machines} />
                      <DeleteButton id={ec.id} label={`${ec.machine.brand} ${ec.code}`} action={deleteErrorCode} />
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
