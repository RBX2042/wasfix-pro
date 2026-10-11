import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import { subscriberUnsubscribeLinksCsv } from "@/lib/newsletter";

export const dynamic = "force-dynamic";

const deny = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * The owner's helper for decision D20: every subscriber with its signed opt-out link, as CSV (email,afmeldlink), to
 * load into the Resend audience as a contact property and use as a merge field in every broadcast. Admin only: the
 * file is the whole list plus a working opt-out link per address. Same shape as the other admin exports
 * (src/app/api/admin/parts/export/route.ts); it lives under /api/newsletter because that is where the list's code is.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return deny("Geen toegang", 403);
  if (!isDatabaseConfigured()) return deny("Geen database geconfigureerd", 503);
  let csv: string | null;
  try {
    csv = await subscriberUnsubscribeLinksCsv();
  } catch (err) {
    logger.error("[newsletter] afmeldlinks export failed", err);
    return deny("De lijst kon niet worden gelezen. Probeer het later opnieuw.", 503);
  }
  if (csv === null) return deny("Geen ondertekeningssleutel (CRON_SECRET of CLERK_SECRET_KEY): er kunnen geen afmeldlinks worden gemaakt.", 503);
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nieuwsbrief-afmeldlinks-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
