import { DashboardLayout } from "@/components/dashboard-layout";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AnalyticsDashboard } from "./client";

export const metadata = { title: "Analytics dashboard · WasFix Admin", robots: "noindex" };
export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {
  // Auth guard
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/inloggen?next=/admin/analytics");
  if (user.role !== "ADMIN" && user.role !== "BUSINESS") {
    redirect("/");
  }

  return (
    <DashboardLayout role={user.role}>
      <AnalyticsDashboard />
    </DashboardLayout>
  );
}
