import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import { Plus, Phone, Mail, Wrench } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata = { title: "Klanten — Monteur" };

const DEMO_CUSTOMERS = [
  { id: 1, name: "Familie de Vries", email: "vries@example.nl", phone: "06-12345678", machine: "Bosch WAU28T40NL", lastVisit: "2026-04-12", status: "Actief" },
  { id: 2, name: "M. Janssen", email: "m.janssen@example.nl", phone: "06-87654321", machine: "Miele WED 125 WPS", lastVisit: "2026-04-08", status: "Actief" },
  { id: 3, name: "Familie Bakker", email: "bakker@example.nl", phone: "06-11122334", machine: "Samsung WW90T684DLH", lastVisit: "2026-03-25", status: "Wacht op onderdeel" },
  { id: 4, name: "P. Vermeer", email: "vermeer@example.nl", phone: "06-44455566", machine: "AEG L7FE96BS", lastVisit: "2026-03-18", status: "Voltooid" },
];

export default async function MonteurKlantenPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen");

  return (
    <DashboardLayout role={user.role}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold">Klanten</h1>
          <p className="text-muted-foreground text-sm">{DEMO_CUSTOMERS.length} klanten in jouw beheer</p>
        </div>
        <Button><Plus className="h-4 w-4" /> Klant toevoegen</Button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {DEMO_CUSTOMERS.map((c) => (
          <Card key={c.id} className="hover:border-primary transition-colors">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-heading font-semibold">{c.name}</h3>
                  <p className="text-xs text-muted-foreground">Laatste bezoek: {c.lastVisit}</p>
                </div>
                <Badge variant={c.status === "Actief" ? "success" : c.status === "Wacht op onderdeel" ? "warning" : "secondary"}>{c.status}</Badge>
              </div>
              <div className="space-y-1 text-sm">
                <p className="flex items-center gap-2 text-muted-foreground"><Mail className="h-3 w-3" /> {c.email}</p>
                <p className="flex items-center gap-2 text-muted-foreground"><Phone className="h-3 w-3" /> {c.phone}</p>
                <p className="flex items-center gap-2 text-muted-foreground"><Wrench className="h-3 w-3" /> {c.machine}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </DashboardLayout>
  );
}
