import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { exportPartsCsv } from "@/app/admin/_lib/catalog-csv";

export const dynamic = "force-dynamic";

/** Catalogue as CSV (sku;name;brand;category;price;cost;costSource;stock;supplier). Admin only; contains purchase prices. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Geen toegang" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "Geen database geconfigureerd" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const csv = await exportPartsCsv();
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="onderdelen-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
