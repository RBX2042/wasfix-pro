import { MarketingLayout } from "@/components/marketing-layout";
import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { Search, AlertCircle, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";


export const metadata = { title: "Foutcodes database — alle wasmachine fouten" };

export default async function FoutcodesPage({ searchParams }: { searchParams: Promise<{ q?: string; brand?: string }> }) {
  const sp = await searchParams;
  const q = sp.q?.trim();
  const brand = sp.brand;

  const where: any = {};
  if (q) {
    where.OR = [
      { code: { contains: q.toUpperCase() } },
      { title: { contains: q } },
      { description: { contains: q } },
    ];
  }
  if (brand) where.machine = { brand };

  let errorCodes: Awaited<ReturnType<typeof prisma.errorCode.findMany<{ include: { machine: true } }>>> = [];
  let brands: Array<{ brand: string }> = [];
  try {
    [errorCodes, brands] = await Promise.all([
      prisma.errorCode.findMany({
        where,
        include: { machine: true },
        take: 100,
        orderBy: [{ severity: "desc" }, { code: "asc" }],
      }),
      prisma.washingMachine.findMany({ select: { brand: true }, distinct: ["brand"] }),
    ]);
  } catch {
    // DB unreachable — render empty state
  }

  return (
    <MarketingLayout>
      <section className="border-b bg-muted/30">
        <div className="container py-12">
          <Badge variant="secondary" className="mb-3">Foutcode database</Badge>
          <h1 className="font-heading text-3xl md:text-4xl font-bold">Wasmachine foutcodes</h1>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Zoek de foutcode van je wasmachine en ontdek direct de oorzaak en oplossing.
          </p>
          <form className="mt-6 max-w-xl" action="/foutcodes">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input name="q" defaultValue={q} placeholder="Bv. E18, F21, dE..." className="pl-10" />
            </div>
          </form>
        </div>
      </section>

      <div className="container py-8 grid lg:grid-cols-[220px_1fr] gap-8">
        <aside>
          <h3 className="font-semibold mb-3">Filter op merk</h3>
          <div className="space-y-1">
            <Link href="/foutcodes" className={`block px-3 py-2 rounded-md text-sm hover:bg-muted ${!brand ? "bg-primary/10 text-primary font-medium" : ""}`}>
              Alle merken
            </Link>
            {brands.map((b) => (
              <Link
                key={b.brand}
                href={`/foutcodes?brand=${encodeURIComponent(b.brand)}`}
                className={`block px-3 py-2 rounded-md text-sm hover:bg-muted ${brand === b.brand ? "bg-primary/10 text-primary font-medium" : ""}`}
              >
                {b.brand}
              </Link>
            ))}
          </div>
        </aside>

        <div>
          <p className="text-sm text-muted-foreground mb-4">{errorCodes.length} foutcodes gevonden</p>
          <div className="space-y-3">
            {errorCodes.map((ec) => (
              <Link key={ec.id} href={`/foutcodes/${encodeURIComponent(ec.machine.brand)}-${encodeURIComponent(ec.code)}`}>
                <Card className="hover:border-primary transition-colors group">
                  <CardContent className="p-5 flex items-start gap-4">
                    <div className="shrink-0 h-12 w-12 rounded-md bg-primary/10 flex items-center justify-center">
                      <span className="font-heading font-bold text-primary">{ec.code}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <Badge variant="outline">{ec.machine.brand}</Badge>
                        <SeverityBadge severity={ec.severity} />
                        {ec.diyFriendly && <Badge variant="success" className="text-[10px]">Zelf oplosbaar</Badge>}
                      </div>
                      <h3 className="font-heading font-semibold group-hover:text-primary transition-colors">{ec.title}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{ec.description}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {errorCodes.length === 0 && (
            <Card>
              <CardContent className="p-12 text-center">
                <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">Geen foutcodes gevonden voor deze zoekopdracht.</p>
                <Link href="/diagnose" className="text-primary text-sm hover:underline mt-3 inline-block">Probeer onze AI diagnose →</Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </MarketingLayout>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { label: string; variant: any }> = {
    LOW: { label: "Laag", variant: "secondary" },
    MEDIUM: { label: "Gemiddeld", variant: "warning" },
    HIGH: { label: "Hoog", variant: "danger" },
    CRITICAL: { label: "Kritiek", variant: "danger" },
  };
  const m = map[severity] ?? map.MEDIUM;
  return <Badge variant={m.variant} className="text-[10px]">{m.label}</Badge>;
}
