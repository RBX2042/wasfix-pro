import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { apiError, apiSuccess } from "@/lib/api-response";
import { rateLimit, getClientKey } from "@/lib/ratelimit";
import { REF_COOKIE, REFERRAL_ENABLED, VISITOR_COOKIE, isValidCode, recordClick } from "@/lib/referrals";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

const Schema = z.object({
  code: z.string().max(20),
  landingPath: z.string().max(200).optional(),
});

/**
 * Records a referral click and issues the cookies that carry attribution:
 * the referral code and an anonymous visitor id (no personal data).
 */
export async function POST(req: NextRequest) {
  // The programme is off by default. Off means off: no row, no cookie, no visitor id.
  if (!REFERRAL_ENABLED) return NextResponse.json({ tracked: false, enabled: false });

  if (!(await rateLimit(`referral:${getClientKey(req)}`, 30, 60 * 60 * 1000))) {
    return apiError("Te veel verzoeken", 429);
  }

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body ?? {});
  if (!parsed.success || !isValidCode(parsed.data.code)) {
    return apiError("Ongeldige referral-code", 400);
  }

  const visitorId = req.cookies.get(VISITOR_COOKIE)?.value ?? randomUUID();
  // A signed-in referrer following their own link records nothing (see recordClick).
  const actor = await getCurrentUser().catch(() => null);
  await recordClick(parsed.data.code, visitorId, parsed.data.landingPath, actor?.id ?? null);

  const res = NextResponse.json({ tracked: true });
  const maxAge = 30 * 24 * 60 * 60;
  res.cookies.set(REF_COOKIE, parsed.data.code, { maxAge, path: "/", sameSite: "lax" });
  res.cookies.set(VISITOR_COOKIE, visitorId, { maxAge, path: "/", sameSite: "lax", httpOnly: true });
  return res;
}

export async function GET() {
  return apiSuccess({ ok: true, hint: "POST { code } om een referral-klik te registreren." });
}
