import { MarketingLayout } from "@/components/marketing-layout";
import { firstParam } from "@/lib/safe-param";
import { dbErrorCodes, dbMachineBrands } from "@/lib/static-db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Search, AlertCircle, ChevronRight } from "lucide-react";
import { formatCount } from "@/lib/catalog-stats";

// Not force-dynamic: the reads are tagged cache entries. The page renders per request
// only because it reads searchParams.

export const metadata = {
  title: "Foutcodes database: alle wasmachine fouten",
  description:
    "Zoek de foutcode van je wasmachine (Bosch, Miele, Samsung, LG, AEG en meer) en lees de mogelijke oorzaken en wat je eraan kunt doen.",
  alternates: { canonical: "/foutcodes" },
};

const PAGE_SIZE = 50;
const MAX_SHOWN = 400;

export default async function FoutcodesPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; brand?: string | string[]; n?: string | string[] }> }) {
  const sp = await searchParams;
  const q = firstParam(sp.q)?.trim().slice(0, 60) || undefined;
  const requested = Math.min(MAX_SHOWN, Math.max(PAGE_SIZE, parseInt(firstParam(sp.n) ?? "", 10) || PAGE_SIZE));

  const brands = (await dbMachineBrands()).map((b) => ({ brand: b }));
  const brand = brands.some((b) => b.brand === firstParam(sp.brand)) ? firstParam(sp.brand) : undefined;

  const [matching, everything] = await Promise.all([
    dbErrorCodes({ where: { q, brand } }),
    dbErrorCodes({}),
  ]);
  const errorCodes = matching.slice(0, requested);
  const verifiedCount = everything.filter((ec) => ec.provenance === "VERIFIED").length;
  const hrefFor = (patch: { brand?: string; n?: string }) => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    const b = "brand" in patch ? patch.brand : brand;
    if (b) qs.set("brand", b);
    if (patch.n) qs.set("n", patch.n);
    const s = qs.toString();
    return s ? `/foutcodes?${s}` : "/foutcodes";
  };

  const BrandLinks = () => (
    <div className="space-y-0.5">
      <Link href={hrefFor({ brand: undefined })} className={`flex items-center min-h-11 px-3 rounded-md text-sm hover:bg-muted ${!brand ? "bg-primary/10 text-primary font-medium" : ""}`}>
        Alle merken
      </Link>
      {brands.map((b) => (
        <Link
          key={b.brand}
          href={hrefFor({ brand: b.brand })}
          className={`flex items-center min-h-11 px-3 rounded-md text-sm hover:bg-muted ${brand === b.brand ? "bg-primary/10 text-primary font-medium" : ""}`}
        >
          {b.brand}
        </Link>
      ))}
    </div>
  );

  return (
    <MarketingLayout>
      <section className="border-b bg-muted/30">
        <div className="container py-8 md:py-12">
          <Badge variant="secondary" className="mb-3">Foutcode database</Badge>
          <h1 className="font-heading text-3xl md:text-4xl font-bold">Wasmachine foutcodes</h1>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Zoek de foutcode van je wasmachine en ontdek direct de oorzaak en oplossing.
          </p>
          {/* Say up front how much of this database we have actually checked.
              A visitor should not have to open a detail page to find out. */}
          <p className="text-sm text-muted-foreground mt-3 max-w-2xl">
            Van de {formatCount(everything.length)} codes hier zijn er{" "}
            <strong>{formatCount(verifiedCount)}</strong> gecontroleerd tegen een openbare
            bron, met de link erbij op de detailpagina. Bij de overige codes zeggen we op de pagina zelf
            waarom niet — meestal omdat bronnen elkaar tegenspreken. Fabrikanten wijzigen codes per
            serie, dus controleer bij twijfel altijd de handleiding van jouw model.
          </p>
          <form className="mt-6 max-w-xl flex gap-2" action="/foutcodes">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input name="q" defaultValue={q} aria-label="Zoek een foutcode" placeholder="Bv. E18, F21, dE..." className="pl-10 h-11" />
            </div>
            {brand && <input type="hidden" name="brand" value={brand} />}
            <Button type="submit" className="h-11">Zoeken</Button>
          </form>
        </div>
      </section>

      {/* grid-cols-1 (minmax(0,1fr)) plus min-w-0: without an explicit track the
          single mobile column is auto-sized to the widest min-content in it, which
          blew the aside out to 452px in a 390px viewport and gave the whole page
          95px of horizontal scroll. */}
      <div className="container py-6 md:py-8 grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-6 lg:gap-8">
        <aside className="min-w-0">
          <h3 className="font-semibold mb-2 hidden lg:block">Filter op merk</h3>
          <details className="lg:hidden rounded-md border">
            <summary className="min-h-11 px-3 flex items-center cursor-pointer font-medium text-sm">
              Filter op merk{brand ? `: ${brand}` : ""}
            </summary>
            <div className="p-2 pt-0"><BrandLinks /></div>
          </details>
          <div className="hidden lg:block"><BrandLinks /></div>
        </aside>

        <div className="min-w-0">
          <p className="text-sm text-muted-foreground mb-4" data-testid="code-count">
            {errorCodes.length < matching.length
              ? `${errorCodes.length} van ${matching.length} foutcodes`
              : `${matching.length} foutcodes gevonden`}
          </p>
          <div className="space-y-3">
            {errorCodes.map((ec) => (
              // The title and description of a code can contain an unbreakable run
              // (e.g. "verwarmings-/luchtdruk..."). min-w-0 + overflow-wrap:anywhere
              // keep the row inside the column; a single such row made /foutcodes
              // 431px wide on a 375px phone.
              <Link key={ec.id} href={`/foutcodes/${encodeURIComponent(ec.machine.brand)}-${encodeURIComponent(ec.code)}`} className="block min-w-0">
                <Card className="hover:border-primary transition-colors group">
                  <CardContent className="p-4 md:p-5 flex items-start gap-3 md:gap-4">
                    <div className="shrink-0 h-12 w-12 rounded-md bg-primary/10 flex items-center justify-center">
                      <span className="font-heading font-bold text-primary text-sm">{ec.code}</span>
                    </div>
                    <div className="flex-1 min-w-0 [overflow-wrap:anywhere]">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <Badge variant="outline">{ec.machine.brand}</Badge>
                        <SeverityBadge severity={ec.severity} />
                        {ec.diyFriendly && <Badge variant="success" className="text-[10px]">Zelf oplosbaar</Badge>}
                      </div>
                      <h3 className="font-heading font-semibold group-hover:text-primary transition-colors">{ec.title}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{ec.description}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" aria-hidden="true" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {errorCodes.length < matching.length && (
            <div className="mt-8 text-center">
              <Button asChild variant="outline" size="lg" className="min-h-11 h-auto py-2 whitespace-normal">
                <Link href={hrefFor({ n: String(Math.min(MAX_SHOWN, errorCodes.length + PAGE_SIZE)) })} scroll={false}>
                  Toon meer foutcodes ({matching.length - errorCodes.length} te gaan)
                </Link>
              </Button>
            </div>
          )}

          {errorCodes.length === 0 && (
            <Card>
              <CardContent className="p-12 text-center">
                <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" aria-hidden="true" />
                <p className="text-muted-foreground">Geen foutcodes gevonden voor deze zoekopdracht.</p>
                <Link href="/diagnose" className="text-primary text-sm hover:underline mt-3 inline-flex items-center min-h-11">Probeer onze AI diagnose →</Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </MarketingLayout>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { label: string; variant: "secondary" | "warning" | "danger" }> = {
    LOW: { label: "Laag", variant: "secondary" },
    MEDIUM: { label: "Gemiddeld", variant: "warning" },
    HIGH: { label: "Hoog", variant: "danger" },
    CRITICAL: { label: "Kritiek", variant: "danger" },
  };
  const m = map[severity] ?? map.MEDIUM;
  return <Badge variant={m.variant} className="text-[10px]">{m.label}</Badge>;
}
