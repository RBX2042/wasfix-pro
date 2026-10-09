import { firstParam } from "@/lib/safe-param";
import { MarketingLayout } from "@/components/marketing-layout";
import { PartCard } from "@/components/part-card";
import {
  searchPublicParts,
  publicPartCategories,
  publicPartBrandFacets,
  partSearchHints,
  type PartSort,
} from "@/lib/static-db";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Search } from "lucide-react";

// No `dynamic = "force-dynamic"`: the catalogue reads below come from the tagged
// data cache. The page itself is rendered per request only because it reads
// searchParams (filters live in the URL).

export const metadata = {
  title: "Wasmachine onderdelen kopen",
  description:
    "Reserveonderdelen voor wasmachines van Bosch, Miele, Samsung, LG, AEG en meer: pompen, deursloten, lagers, moederborden en meer. Zoek op naam, SKU, merk of modelnummer.",
  alternates: { canonical: "/onderdelen" },
};

const PAGE_SIZE = 24;
const MAX_SHOWN = 480;

type SP = { q?: string; cat?: string; brand?: string; sort?: string; n?: string };
type RawSP = { [K in keyof SP]?: string | string[] };

const SORTS: Array<{ value: PartSort; label: string }> = [
  { value: "aanbevolen", label: "Standaard" },
  { value: "prijs-op", label: "Prijs laag-hoog" },
  { value: "prijs-af", label: "Prijs hoog-laag" },
];

function href(base: { q?: string; cat?: string; brand?: string; sort?: string }, patch: Partial<Record<keyof SP, string | undefined>>) {
  const merged = { ...base, ...patch };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `/onderdelen?${s}` : "/onderdelen";
}

export default async function OnderdelenPage({ searchParams }: { searchParams: Promise<RawSP> }) {
  // A repeated parameter (?q=a&q=b) arrives as an array; take the first value.
  const raw = await searchParams;
  const sp: SP = { q: firstParam(raw.q), cat: firstParam(raw.cat), brand: firstParam(raw.brand), sort: firstParam(raw.sort), n: firstParam(raw.n) };
  const q = sp.q?.trim().slice(0, 80) || undefined;
  const sort: PartSort = SORTS.some((s) => s.value === sp.sort) ? (sp.sort as PartSort) : "aanbevolen";
  const requested = Math.min(MAX_SHOWN, Math.max(PAGE_SIZE, parseInt(sp.n ?? "", 10) || PAGE_SIZE));

  const [categories, brands] = await Promise.all([publicPartCategories(), publicPartBrandFacets()]);
  // Filters are validated against what exists, so a hand-typed ?cat= cannot produce a
  // misleading empty state or reflect arbitrary text into the page.
  const cat = categories.some((c) => c.value === sp.cat) ? sp.cat : undefined;
  const brand = brands.some((b) => b.brand === sp.brand) ? sp.brand : undefined;
  const base = { q, cat, brand, sort: sort === "aanbevolen" ? undefined : sort };

  const { parts, total, relaxed } = await searchPublicParts({ q, category: cat, brand, sort }, requested);
  const hints = total === 0 && q ? await partSearchHints(q) : [];
  const filtered = Boolean(q || cat || brand);

  const FilterLinks = () => (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold mb-2">Categorieën</h3>
        <div className="space-y-0.5">
          <Link
            href={href(base, { cat: undefined, n: undefined })}
            className={`flex items-center justify-between min-h-11 px-3 rounded-md text-sm hover:bg-muted ${!cat ? "bg-primary/10 text-primary font-medium" : ""}`}
          >
            Alle onderdelen
          </Link>
          {categories.map((c) => (
            <Link
              key={c.value}
              href={href(base, { cat: c.value, n: undefined })}
              className={`flex items-center justify-between min-h-11 px-3 rounded-md text-sm hover:bg-muted ${cat === c.value ? "bg-primary/10 text-primary font-medium" : ""}`}
            >
              <span>{c.label}</span>
              <span className="text-xs text-muted-foreground">{c.count}</span>
            </Link>
          ))}
        </div>
      </div>
      <div>
        <h3 className="font-semibold mb-2">Merk</h3>
        <div className="space-y-0.5">
          {brands.map((b) => (
            <Link
              key={b.brand}
              href={href(base, { brand: b.brand, n: undefined })}
              className={`flex items-center justify-between min-h-11 px-3 rounded-md text-sm hover:bg-muted ${brand === b.brand ? "bg-primary/10 text-primary font-medium" : ""}`}
            >
              <span>{b.brand}</span>
              <span className="text-xs text-muted-foreground">{b.count}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <MarketingLayout>
      <section className="border-b bg-muted/30">
        <div className="container py-8 md:py-10">
          <div className="max-w-2xl">
            <h1 className="font-heading text-3xl md:text-4xl font-bold">Onderdelen winkel</h1>
            <p className="text-muted-foreground mt-2">
              Originele en voordelige reserveonderdelen voor alle grote merken. We verzenden binnen Nederland op werkdagen; zodra je bestelling is verzonden krijg je een track &amp; trace-code.
            </p>
          </div>

          <form className="mt-5 max-w-2xl flex gap-2" action="/onderdelen">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                name="q"
                defaultValue={q}
                aria-label="Zoek onderdelen"
                placeholder="Zoek een onderdeel"
                className="pl-10 h-11"
              />
            </div>
            {cat && <input type="hidden" name="cat" value={cat} />}
            {brand && <input type="hidden" name="brand" value={brand} />}
            <Button type="submit" className="h-11">Zoeken</Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground max-w-2xl">
            Zoek op naam, SKU, merk, modelnummer of foutcode, bijvoorbeeld &lsquo;Bosch pomp&rsquo; of &lsquo;WAU28T40NL&rsquo;.
          </p>
        </div>
      </section>

      <div className="container py-6 md:py-8 grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-6 lg:gap-8">
        <aside className="min-w-0">
          {/* Phones: collapsed, so the first parts are not pushed below 17 categories. */}
          <details className="lg:hidden rounded-md border">
            <summary className="min-h-11 px-3 flex items-center cursor-pointer font-medium text-sm">
              Filters {filtered ? "(actief)" : ""}
            </summary>
            <div className="p-2 pt-0"><FilterLinks /></div>
          </details>
          <div className="hidden lg:block"><FilterLinks /></div>
        </aside>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
            <p className="text-sm text-muted-foreground" data-testid="part-count">
              {parts.length < total ? `${parts.length} van ${total} onderdelen` : `${total} ${total === 1 ? "onderdeel" : "onderdelen"} gevonden`}
            </p>
            <div className="flex flex-wrap items-center gap-x-1 text-sm">
              <span className="text-muted-foreground mr-1">Sorteer:</span>
              {SORTS.map((s) => (
                <Link
                  key={s.value}
                  href={href(base, { sort: s.value === "aanbevolen" ? undefined : s.value, n: undefined })}
                  className={`inline-flex items-center min-h-11 px-2 hover:underline ${sort === s.value ? "text-primary font-medium" : "text-muted-foreground"}`}
                >
                  {s.label}
                </Link>
              ))}
              {filtered && (
                <Link href="/onderdelen" className="inline-flex items-center min-h-11 px-2 text-primary hover:underline">
                  Filters wissen
                </Link>
              )}
            </div>
          </div>

          {relaxed && q && (
            <p className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="relaxed-note">
              Geen onderdeel past bij al je zoekwoorden. Dit zijn onderdelen die bij bijna alles passen van &lsquo;{q}&rsquo;.
            </p>
          )}
          {total === 0 ? (
            <Card>
              <CardContent className="p-8 md:p-12 text-center">
                <Search className="mx-auto h-12 w-12 text-muted-foreground/30 mb-3" aria-hidden="true" />
                <p className="font-medium">Geen onderdelen gevonden{q ? <> voor &lsquo;{q}&rsquo;</> : null}.</p>
                {hints.length > 0 && (
                  <p className="text-sm text-muted-foreground mt-3">
                    Bedoelde je een van deze woorden?{" "}
                    {hints.map((h, i) => (
                      <span key={h.word}>
                        {i > 0 && ", "}
                        <Link className="text-primary hover:underline" href={href({ ...base, q: undefined }, { q: h.word })}>
                          {h.word} ({h.count})
                        </Link>
                      </span>
                    ))}
                  </p>
                )}
                <p className="text-sm text-muted-foreground mt-3">Of kies een categorie:</p>
                <div className="mt-2 flex flex-wrap justify-center gap-x-3">
                  {categories.slice(0, 8).map((c) => (
                    <Link key={c.value} href={href({}, { cat: c.value })} className="inline-flex items-center min-h-11 text-sm text-primary hover:underline">
                      {c.label}
                    </Link>
                  ))}
                </div>
                <Link href="/onderdelen" className="text-primary text-sm hover:underline mt-2 inline-flex items-center min-h-11">Toon alle onderdelen</Link>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 min-[360px]:grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                {parts.map((p) => (
                  <PartCard key={p.id} part={p} />
                ))}
              </div>
              {parts.length < total && parts.length < MAX_SHOWN && (
                <div className="mt-8 text-center">
                  <Button asChild variant="outline" size="lg" className="min-h-11 h-auto py-2 whitespace-normal">
                    <Link href={href(base, { n: String(Math.min(MAX_SHOWN, parts.length + PAGE_SIZE)) })} scroll={false}>
                      Toon meer onderdelen ({total - parts.length} te gaan)
                    </Link>
                  </Button>
                </div>
              )}
              {/* At the cap the button above would link to the same page again. */}
              {parts.length < total && parts.length >= MAX_SHOWN && (
                <p className="mt-8 text-center text-sm text-muted-foreground">
                  Er zijn nog {total - parts.length} onderdelen. Kies een categorie of merk, of verfijn je zoekopdracht.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </MarketingLayout>
  );
}
