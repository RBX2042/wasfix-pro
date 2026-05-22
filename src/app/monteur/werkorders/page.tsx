import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import { Plus, Calendar, MapPin, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata = { title: "Werkorders — Monteur" };

const DEMO_WORKORDERS = [
  { id: "WO-001", klant: "Familie de Vries", machine: "Bosch WAU28T40NL", probleem: "Foutcode E18 — afvoerprobleem", status: "OPEN", urgent: true, datum: "2026-04-28", adres: "Hoofdstraat 12, Amsterdam" },
  { id: "WO-002", klant: "M. Janssen", machine: "Miele WED 125 WPS", probleem: "F11 — afvoer / pomp", status: "WACHT_OP_ONDERDEEL", urgent: false, datum: "2026-04-29", adres: "Schoolstraat 8, Utrecht" },
  { id: "WO-003", klant: "Familie Bakker", machine: "Samsung WW90T684DLH", probleem: "UE — onbalans, lager versleten", status: "GEPLAND", urgent: false, datum: "2026-05-02", adres: "Kerkweg 25, Rotterdam" },
  { id: "WO-004", klant: "Familie van Dijk", machine: "LG F4WV710P1E", probleem: "OE — afvoer", status: "VOLTOOID", urgent: false, datum: "2026-04-22", adres: "Nieuwstraat 4, Den Haag" },
];

const STATUS_VARIANT: Record<string, any> = {
  OPEN: "danger",
  WACHT_OP_ONDERDEEL: "warning",
  GEPLAND: "default",
  VOLTOOID: "success",
};

export default async function WerkordersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen");

  return (
    <DashboardLayout role={user.role}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold">Werkorders</h1>
          <p className="text-muted-foreground text-sm">{DEMO_WORKORDERS.filter((w) => w.status !== "VOLTOOID").length} actieve werkorders</p>
        </div>
        <Button><Plus className="h-4 w-4" /> Nieuwe werkorder</Button>
      </div>

      <div className="space-y-3">
        {DEMO_WORKORDERS.map((w) => (
          <Card key={w.id} className={w.urgent ? "border-red-500/40" : ""}>
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-mono font-bold text-sm">{w.id}</span>
                    <Badge variant={STATUS_VARIANT[w.status] ?? "secondary"}>{w.status.replace(/_/g, " ")}</Badge>
                    {w.urgent && <Badge variant="danger">Urgent</Badge>}
                  </div>
                  <h3 className="font-heading font-semibold">{w.klant}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{w.machine} — {w.probleem}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {w.datum}</span>
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {w.adres}</span>
                  </div>
                </div>
                <Button variant="outline" size="sm">Open <ChevronRight className="h-3 w-3" /></Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </DashboardLayout>
  );
}
