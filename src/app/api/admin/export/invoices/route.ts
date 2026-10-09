import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { toCsv } from "@/lib/export-csv";
import { ledgerRows, periodDates } from "@/app/admin/_lib/economics";

export const dynamic = "force-dynamic";

/**
 * Invoices and credit notes for the accountant: ?year=2026&quarter=3 (quarter 1-4, or 0/absent
 * for the whole year). One row per document; credit notes carry NEGATIVE net, VAT and total, so
 * the column sums equal sum(Invoice) - sum(CreditNote). The period is by Europe/Amsterdam date.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Geen toegang" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "Geen database geconfigureerd" }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const year = Number.parseInt(req.nextUrl.searchParams.get("year") ?? "", 10);
  const quarter = Number.parseInt(req.nextUrl.searchParams.get("quarter") ?? "0", 10) || 0;
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || quarter < 0 || quarter > 4) {
    return NextResponse.json({ error: "Gebruik ?year=2026&quarter=1..4 (quarter weglaten voor het hele jaar)" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const { from, to } = periodDates(year, quarter);
  const rows = await ledgerRows(from, to);
  const csv = toCsv(
    ["type", "nummer", "datum", "bestelling", "netto", "btw", "totaal", "status", "verwijst_naar"],
    rows.map((r) => [r.kind, r.number, r.date, r.orderRef, r.netEur, r.vatEur, r.totalEur, r.status, r.refersTo]),
  );
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="facturen-${year}${quarter ? `-Q${quarter}` : ""}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
