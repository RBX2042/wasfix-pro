import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

// Returns referral stats for the current user (or by ?code= for testing).
// Real implementation: query Referral table with attribution-window logic.
// Demo: returns zeros + the user's code.

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  // Either get from user session or from query param (for own-link only)
  const user = await getCurrentUser().catch(() => null);
  if (!user && !code) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // Demo data — replace with real DB query when Referral model exists
  return NextResponse.json({
    data: {
      link: `https://wasfix.nl/?ref=${code ?? user?.id?.slice(0, 6).toUpperCase() ?? "DEMO"}`,
      clicks: 0,
      signups: 0,
      conversions: 0,
      earningsEur: 0,
    },
    meta: { note: "Statistics are populated once referral conversions accumulate. Demo shows zeros." },
  });
}
