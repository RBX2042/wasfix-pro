import WasFixHome from "@/components/redesign/WasFixHome";
import { staticParts, staticErrorCodes } from "@/lib/static-db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "WasFix Pro — AI wasmachine diagnose in 60 seconden",
  description:
    "Foto of foutcode → diagnose, juist onderdeel, stap-voor-stap reparatie. Geen voorrijkosten. Gemiddeld €140 bespaard per reparatie.",
};

export default function HomePage() {
  // Featured parts for the catalogue strip (8 with stock, ordered by stock)
  const partItems = staticParts({ where: { minStock: 0 }, orderBy: "stock-desc", take: 8 }).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    priceEur: p.priceEur,
    stock: p.stock,
    isOriginal: p.isOriginal,
  }));

  // Top error codes for the explorer — first 12 by severity
  const codeItems = staticErrorCodes({ take: 12 }).map((ec) => ({
    id: ec.code,
    brand: ec.machine.brand,
    desc: ec.title,
    // First likely cause = the "part" hint
    part: (ec.likelyCauses ?? "").split("|")[0] || "Onderdeel onbekend",
    url: `/foutcodes/${encodeURIComponent(ec.machine.brand)}-${encodeURIComponent(ec.code)}`,
  }));

  return <WasFixHome parts={partItems} codes={codeItems} />;
}
