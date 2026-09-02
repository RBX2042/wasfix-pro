import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { referralCodeFor, referralStats } from "@/lib/referrals";

export const dynamic = "force-dynamic";

/**
 * Referral stats for the signed-in user. A ?code= is only honoured when it
 * matches the caller's own code, so nobody can read someone else's numbers.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const ownCode = await referralCodeFor(user.id);
  const requested = req.nextUrl.searchParams.get("code");
  if (requested && requested.toUpperCase() !== ownCode) {
    return NextResponse.json({ error: "Geen toegang tot deze referral-code" }, { status: 403 });
  }

  const stats = await referralStats(ownCode, env.APP_URL);
  return NextResponse.json({ data: stats });
}
