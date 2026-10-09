import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Whether the Search Console environment variables exist. It does NOT mean data
 * is being read: no code fetches anything from Google yet, so `integrated` is
 * false. The old answer ("connected") let the analytics page claim a link that
 * did not exist. Admin only (middleware protects /api/admin too; checked here as well).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
  const configured = Boolean(process.env.GSC_REFRESH_TOKEN) && Boolean(process.env.GSC_OAUTH_CLIENT_ID);
  return NextResponse.json({ configured, integrated: false, providerUrl: "https://search.google.com/search-console" });
}
