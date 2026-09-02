import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Google Search Console koppelen" };

export default async function ConnectGscPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") redirect("/dashboard");

  const checks = [
    { name: "GSC_OAUTH_CLIENT_ID", ok: Boolean(process.env.GSC_OAUTH_CLIENT_ID) },
    { name: "GSC_OAUTH_CLIENT_SECRET", ok: Boolean(process.env.GSC_OAUTH_CLIENT_SECRET) },
    { name: "GSC_REFRESH_TOKEN", ok: Boolean(process.env.GSC_REFRESH_TOKEN) },
  ];
  const connected = checks.every((c) => c.ok);

  return (
    <DashboardLayout role={user.role}>
      <Link href="/admin/analytics" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-6">
        <ArrowLeft className="h-3 w-3" /> Terug naar analytics
      </Link>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="font-heading text-2xl font-bold">Google Search Console</h1>
        <Badge variant={connected ? "success" : "warning"}>{connected ? "Gekoppeld" : "Niet gekoppeld"}</Badge>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-semibold mb-4">Status omgevingsvariabelen</h2>
            <ul className="space-y-2 text-sm">
              {checks.map((c) => (
                <li key={c.name} className="flex items-center gap-2">
                  {c.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-destructive" />}
                  <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{c.name}</code>
                  <span className="text-muted-foreground">{c.ok ? "ingesteld" : "ontbreekt"}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <h2 className="font-heading text-lg font-semibold mb-4">Koppelen in 5 stappen</h2>
            <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground">
              <li>Maak in de <a className="text-primary hover:underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud Console</a> een OAuth 2.0 client (type: Web application).</li>
              <li>Activeer de <em>Google Search Console API</em> voor hetzelfde project.</li>
              <li>Genereer via de <a className="text-primary hover:underline" href="https://developers.google.com/oauthplayground" target="_blank" rel="noreferrer">OAuth Playground</a> een refresh token met scope <code className="font-mono text-xs">https://www.googleapis.com/auth/webmasters.readonly</code>.</li>
              <li>Zet <code className="font-mono text-xs">GSC_OAUTH_CLIENT_ID</code>, <code className="font-mono text-xs">GSC_OAUTH_CLIENT_SECRET</code> en <code className="font-mono text-xs">GSC_REFRESH_TOKEN</code> als Vercel environment variables.</li>
              <li>Redeploy — deze pagina toont daarna &quot;Gekoppeld&quot; en het keyword-widget op /admin/analytics vult zich.</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
