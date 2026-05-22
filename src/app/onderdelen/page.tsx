import { MarketingLayout } from "@/components/marketing-layout";
import { PartCard } from "@/components/part-card";
import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { Search } from "lucide-react";

export const dynamic = "force-dynamic";


export const metadata = { title: "Onderdelen — Wasmachine reserveonderdelen" };

const CATEGORIES = [
  { value: "PUMP", label: "Pompen", emoji: "💧" },
  { value: "DOOR", label: "Deuren & Pakkingen", emoji: "🚪" },
  { value: "MOTOR", label: "Motor", emoji: "⚙️" },
  { value: "HEATING", label: "Verwarming", emoji: "🔥" },
  { value: "VALVE", label: "Ventielen", emoji: "🚰" },
  { value: "BEARING", label: "Lagers", emoji: "🔩" },
  { value: "BELT", label: "Snaren", emoji: "🪢" },
  { value: "FILTER", label: "Filters", emoji: "🌀" },
  { value: "ELECTRONICS", label: "Elektronica", emoji: "🔌" },
  { value: "HOSE", label: "Slangen", emoji: "🪠" },
];

export default async function OnderdelenPage({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string; brand?: string }> }) {
  const sp = await searchParams;
  const q = sp.q?.trim();
  const cat = sp.cat;
  const brand = sp.brand;

  const where: any = {};
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { description: { contains: q } },
      { sku: { contains: q } },
    ];
  }
  if (cat) where.category = cat;
  if (brand) where.brand = brand;

  const [parts, brands] = await Promise.all([
    prisma.part.findMany({
      where,
      orderBy: [{ stock: "desc" }, { priceEur: "asc" }],
      take: 60,
    }),
    prisma.part.findMany({ select: { brand: true }, distinct: ["brand"] }),
  ]);

  return (
    <MarketingLayout>
      <section className="border-b bg-muted/30">
        <div className="container py-10">
          <div className="max-w-2xl">
            <h1 className="font-heading text-3xl md:text-4xl font-bold">Onderdelen winkel</h1>
            <p className="text-muted-foreground mt-2">
              Originele en voordelige reserveonderdelen voor alle grote merken. Voor 22:00 besteld = morgen in huis.
            </p>
          </div>

          <form className="mt-6 max-w-2xl" action="/onderdelen">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input name="q" defaultValue={q} placeholder="Zoek op SKU, naam of beschrijving..." className="pl-10" />
            </div>
          </form>
        </div>
      </section>

      <div className="container py-8 grid lg:grid-cols-[260px_1fr] gap-8">
        <aside className="space-y-6">
          <div>
            <h3 className="font-semibold mb-3">Categorieën</h3>
            <div className="space-y-1">
              <Link href="/onderdelen" className={`block px-3 py-2 rounded-md text-sm hover:bg-muted ${!cat ? "bg-primary/10 text-primary font-medium" : ""}`}>
                Alle onderdelen
              </Link>
              {CATEGORIES.map((c) => (
                <Link
                  key={c.value}
                  href={`/onderdelen?cat=${c.value}${brand ? `&brand=${brand}` : ""}`}
                  className={`block px-3 py-2 rounded-md text-sm hover:bg-muted ${cat === c.value ? "bg-primary/10 text-primary font-medium" : ""}`}
                >
                  <span className="mr-2">{c.emoji}</span> {c.label}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-3">Merk</h3>
            <div className="space-y-1">
              {brands.map((b) => (
                <Link
                  key={b.brand}
                  href={`/onderdelen?brand=${encodeURIComponent(b.brand)}${cat ? `&cat=${cat}` : ""}`}
                  className={`block px-3 py-2 rounded-md text-sm hover:bg-muted ${brand === b.brand ? "bg-primary/10 text-primary font-medium" : ""}`}
                >
                  {b.brand}
                </Link>
              ))}
            </div>
          </div>
        </aside>

        <div>
          <div className="flex items-center justify-between mb-6">
            <p className="text-sm text-muted-foreground">{parts.length} onderdelen gevonden</p>
            {(q || cat || brand) && (
              <Link href="/onderdelen" className="text-sm text-primary hover:underline">
                Filters wissen
              </Link>
            )}
          </div>

          {parts.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <Search className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">Geen onderdelen gevonden voor deze zoekopdracht.</p>
                <Link href="/onderdelen" className="text-primary text-sm hover:underline mt-2 inline-block">Toon alle onderdelen</Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {parts.map((p) => (
                <PartCard key={p.id} part={p} />
              ))}
            </div>
          )}
        </div>
      </div>
    </MarketingLayout>
  );
}
