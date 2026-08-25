import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { hasMonteurAccess, getOrCreateCompanyForUser } from "@/lib/company";
import { WORK_ORDER_STATUS_LABELS, type WorkOrderStatus } from "@/lib/work-order";
import { startOfWeek, weekDays, addDays, parseWeekParam, toWeekParam, weekdayLabelNl, isSameDay } from "@/lib/planning";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Wrench, MapPin, Inbox } from "lucide-react";
import { RescheduleForm } from "./reschedule-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Planning — Monteur" };

const UNSCHEDULED_STATUSES = ["NEW", "PRE_DIAGNOSIS"];
const TERMINAL_STATUSES = ["INVOICED", "PAID", "WARRANTY", "CANCELLED"];

export default async function PlanningPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/inloggen");

  if (!hasMonteurAccess(user)) {
    return (
      <DashboardLayout role={user.role}>
        <Card>
          <CardContent className="p-12 text-center">
            <Wrench className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
            <h2 className="font-heading text-xl font-bold mb-2">Monteur Pro vereist</h2>
            <p className="text-muted-foreground mb-4">Deze functie is beschikbaar voor Monteur Pro abonnees.</p>
            <Button asChild><Link href="/prijzen">Bekijk Monteur Pro</Link></Button>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  const company = await getOrCreateCompanyForUser(user);
  const { week } = await searchParams;
  const anchor = parseWeekParam(week);
  const weekStart = startOfWeek(anchor);
  const weekEnd = addDays(weekStart, 7);
  const days = weekDays(weekStart);

  const [scheduled, unscheduled] = await Promise.all([
    prisma.workOrder.findMany({
      where: { companyId: company.id, scheduledAt: { gte: weekStart, lt: weekEnd } },
      include: { customer: true, machine: true },
      orderBy: { scheduledAt: "asc" },
    }),
    prisma.workOrder.findMany({
      where: { companyId: company.id, status: { in: UNSCHEDULED_STATUSES }, scheduledAt: null },
      include: { customer: true, machine: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const prevWeekHref = `/monteur/planning?week=${toWeekParam(addDays(weekStart, -7))}`;
  const nextWeekHref = `/monteur/planning?week=${toWeekParam(addDays(weekStart, 7))}`;
  const todayHref = `/monteur/planning`;

  const weekLabel = `${weekStart.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })} – ${addDays(weekStart, 6).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <DashboardLayout role={user.role}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-heading text-2xl font-bold">Planning</h1>
          <p className="text-muted-foreground text-sm">{weekLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild><Link href={prevWeekHref}><ChevronLeft className="h-4 w-4" /></Link></Button>
          <Button variant="outline" size="sm" asChild><Link href={todayHref}>Vandaag</Link></Button>
          <Button variant="outline" size="sm" asChild><Link href={nextWeekHref}><ChevronRight className="h-4 w-4" /></Link></Button>
        </div>
      </div>

      {unscheduled.length > 0 && (
        <Card className="mb-6 border-amber-500/40">
          <CardContent className="p-5">
            <h2 className="font-heading font-semibold mb-3 flex items-center gap-2"><Inbox className="h-4 w-4" /> Niet ingepland ({unscheduled.length})</h2>
            <div className="space-y-2">
              {unscheduled.map((w) => (
                <div key={w.id} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-md border">
                  <div>
                    <Link href={`/monteur/werkorders/${w.id}`} className="font-medium text-sm hover:text-primary">{w.number} · {w.customer.name}</Link>
                    <p className="text-xs text-muted-foreground">{w.machine ? `${w.machine.brand} ${w.machine.model} — ` : ""}{w.complaint}</p>
                  </div>
                  <RescheduleForm workOrderId={w.id} status={w.status} scheduledAt={null} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 overflow-x-auto">
        {days.map((day) => {
          const dayOrders = scheduled.filter((w) => w.scheduledAt && isSameDay(new Date(w.scheduledAt), day));
          const isToday = isSameDay(day, new Date());
          return (
            <Card key={day.toISOString()} className={isToday ? "border-primary/50" : ""}>
              <CardContent className="p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  {weekdayLabelNl(day)} {day.getDate()}/{day.getMonth() + 1}
                </p>
                {dayOrders.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60">—</p>
                ) : (
                  <div className="space-y-2">
                    {dayOrders.map((w) => (
                      <div key={w.id} className="p-2 rounded-md border text-xs space-y-1">
                        <p className="font-mono font-semibold">
                          {new Date(w.scheduledAt!).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })} · {w.number}
                        </p>
                        <Link href={`/monteur/werkorders/${w.id}`} className="font-medium hover:text-primary block">{w.customer.name}</Link>
                        {w.customer.city && <p className="flex items-center gap-1 text-muted-foreground"><MapPin className="h-3 w-3" /> {w.customer.city}</p>}
                        <Badge variant={TERMINAL_STATUSES.includes(w.status) ? "secondary" : "default"} className="text-[10px] px-1.5 py-0">
                          {WORK_ORDER_STATUS_LABELS[w.status as WorkOrderStatus] ?? w.status}
                        </Badge>
                        <RescheduleForm workOrderId={w.id} status={w.status} scheduledAt={w.scheduledAt!.toISOString()} />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </DashboardLayout>
  );
}
