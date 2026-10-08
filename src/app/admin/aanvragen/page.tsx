import { DashboardLayout } from "@/components/dashboard-layout";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { setApplicationStatus, setReviewStatus } from "./actions";

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

const NOTICES: Record<string, { text: string; tone: "ok" | "warn" }> = {
  "goedgekeurd-mail-verstuurd": { text: "Aanmelding goedgekeurd. De aanvrager heeft een e-mail met de link om het abonnement te starten. Er is geen plan of rol toegekend: toegang volgt pas na betaling.", tone: "ok" },
  "goedgekeurd-mail-mislukt": { text: "Aanmelding goedgekeurd, maar de e-mail aan de aanvrager is NIET verstuurd (controleer RESEND_API_KEY en het verzenddomein). Stuur hem zelf de link naar /upgrade?plan=MONTEUR_PRO. Er is geen plan of rol toegekend.", tone: "warn" },
};

export default async function AdminRequestsPage({ searchParams }: { searchParams?: Promise<{ melding?: string }> }) {
  const notice = NOTICES[(await searchParams)?.melding ?? ""];
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const hasDb = isDatabaseConfigured();
  const [reviews, openReturns, applications, subscribers, feedback] = hasDb
    ? await Promise.all([
        prisma.review.findMany({ orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []),
        prisma.rmaRequest.count({ where: { status: { in: ["RECEIVED", "APPROVED", "RETURN_RECEIVED"] } } }).catch(() => 0),
        prisma.monteurApplication.findMany({ orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []),
        prisma.newsletterSubscriber.count().catch(() => 0),
        prisma.diagnosisFeedback.groupBy({ by: ["rating"], _count: { _all: true } }).catch(() => []),
      ])
    : [[], 0, [], 0, []];

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

      {notice && (
        <div role="status" className={`mb-6 rounded-md border p-4 text-sm ${notice.tone === "ok" ? "border-emerald-500/40 bg-emerald-50 text-emerald-900" : "border-amber-500/40 bg-amber-50 text-amber-900"}`}>
          {notice.text}
        </div>
      )}

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
            <h2 className="font-heading text-lg font-semibold mb-1">Retouraanvragen ({openReturns} open)</h2>
            <p className="text-sm text-muted-foreground">
              Retouren worden afgehandeld op <Link href="/admin/retouren" className="underline">/admin/retouren</Link>: daar
              hebben goedkeuren, ontvangen en terugbetalen echte gevolgen (retouradres per e-mail, creditnota, voorraad).
              Het oude scherm hier zette alleen een label om, zonder dat er iets werd terugbetaald, en is verwijderd.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-semibold mb-1">Monteur Pro aanmeldingen ({applications.length})</h2>
            <p className="text-xs text-muted-foreground mb-4">Goedkeuren is alleen een controle: de aanvrager krijgt een e-mail en moet zelf het abonnement afsluiten. Er wordt geen plan of rol toegekend.</p>
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
