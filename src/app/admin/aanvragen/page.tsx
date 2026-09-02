import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import { formatDate } from "@/lib/utils";
import { setApplicationStatus, setReviewStatus, setRmaStatus } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin: aanvragen" };

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "secondary" | "default"> = {
  PENDING: "warning",
  RECEIVED: "warning",
  APPROVED: "success",
  REFUNDED: "success",
  REJECTED: "danger",
};

function StatusForm({ action, id, options }: { action: (fd: FormData) => Promise<void>; id: string; options: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((status) => (
        <form key={status} action={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value={status} />
          <button type="submit" className="text-xs border rounded px-2 py-1 hover:bg-muted">{status}</button>
        </form>
      ))}
    </div>
  );
}

export default async function AdminRequestsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const hasDb = isDatabaseConfigured();
  const [reviews, rmas, applications, subscribers, feedback] = hasDb
    ? await Promise.all([
        prisma.review.findMany({ orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []),
        prisma.rmaRequest.findMany({ orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []),
        prisma.monteurApplication.findMany({ orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []),
        prisma.newsletterSubscriber.count().catch(() => 0),
        prisma.diagnosisFeedback.groupBy({ by: ["rating"], _count: { _all: true } }).catch(() => []),
      ])
    : [[], [], [], 0, []];

  const up = feedback.find((f) => f.rating === "up")?._count._all ?? 0;
  const down = feedback.find((f) => f.rating === "down")?._count._all ?? 0;

  return (
    <DashboardLayout role={user.role}>
      <h1 className="font-heading text-2xl font-bold mb-1">Aanvragen &amp; moderatie</h1>
      <p className="text-muted-foreground text-sm mb-6">
        {hasDb
          ? `${subscribers} nieuwsbriefabonnees · AI-feedback 👍 ${up} / 👎 ${down}`
          : "Geen database geconfigureerd — aanvragen worden alleen per e-mail afgeleverd."}
      </p>

      <div className="space-y-6">
        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-semibold mb-4">Reviews ({reviews.length})</h2>
            {reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">Geen reviews.</p>
            ) : (
              <div className="space-y-3">
                {reviews.map((r) => (
                  <div key={r.id} className="border rounded-md p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>{r.status}</Badge>
                      <span style={{ color: "#f5b643" }}>{"★".repeat(r.rating)}</span>
                      <span className="font-medium">{r.title}</span>
                      <span className="text-muted-foreground text-xs">{r.targetType} {r.targetSku ?? r.targetSlug} · {r.author} · {formatDate(r.createdAt)}</span>
                    </div>
                    <p className="text-muted-foreground mb-2">{r.body}</p>
                    <StatusForm action={setReviewStatus} id={r.id} options={["APPROVED", "REJECTED"]} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-semibold mb-4">Retouraanvragen ({rmas.length})</h2>
            {rmas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Geen retouraanvragen.</p>
            ) : (
              <div className="space-y-3">
                {rmas.map((r) => (
                  <div key={r.id} className="border rounded-md p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>{r.status}</Badge>
                      <span className="font-mono font-medium">{r.rmaNumber}</span>
                      <span className="text-muted-foreground text-xs">order {r.orderId} · {r.name} &lt;{r.email}&gt; · {r.reason} · {formatDate(r.createdAt)}</span>
                    </div>
                    <p className="text-muted-foreground mb-2">{r.notes}</p>
                    <StatusForm action={setRmaStatus} id={r.id} options={["APPROVED", "REJECTED", "REFUNDED"]} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-semibold mb-4">Monteur Pro aanmeldingen ({applications.length})</h2>
            {applications.length === 0 ? (
              <p className="text-sm text-muted-foreground">Geen aanmeldingen.</p>
            ) : (
              <div className="space-y-3">
                {applications.map((a) => (
                  <div key={a.id} className="border rounded-md p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <Badge variant={STATUS_VARIANT[a.status] ?? "secondary"}>{a.status}</Badge>
                      <span className="font-medium">{a.companyName}</span>
                      <span className="text-muted-foreground text-xs">KvK {a.kvkNumber} · {a.contactName} &lt;{a.email}&gt;{a.phone ? ` · ${a.phone}` : ""} · {formatDate(a.createdAt)}</span>
                    </div>
                    {(a.coverageAreas || a.specializations) && (
                      <p className="text-muted-foreground text-xs mb-2">
                        {a.coverageAreas ? `Regio's: ${a.coverageAreas}` : ""}{a.coverageAreas && a.specializations ? " · " : ""}{a.specializations ? `Specialisaties: ${a.specializations}` : ""}
                      </p>
                    )}
                    <StatusForm action={setApplicationStatus} id={a.id} options={["APPROVED", "REJECTED"]} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
