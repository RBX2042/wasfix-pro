import { MarketingLayout } from "@/components/marketing-layout";
import { staticGuides } from "@/lib/static-db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { Clock, BookOpen, Wrench, Search, Crown } from "lucide-react";

export const dynamic = "force-dynamic";


export const metadata = { title: "Reparatiegidsen — wasmachines repareren" };

export default async function GidsenPage({ searchParams }: { searchParams: Promise<{ q?: string; difficulty?: string }> }) {
  const sp = await searchParams;
  const q = sp.q?.trim();
  const difficulty = sp.difficulty;

  const guides = staticGuides({ where: { q, difficulty }, orderBy: "created-desc" });

  return (
    <MarketingLayout>
      <section className="border-b bg-muted/30">
        <div className="container py-12">
          <Badge variant="secondary" className="mb-3">Kennisbank</Badge>
          <h1 className="font-heading text-3xl md:text-4xl font-bold">Reparatiegidsen</h1>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Stap-voor-stap handleidingen om je wasmachine zelf te repareren — voor elk niveau.
          </p>
          <form className="mt-6 max-w-xl" action="/gidsen">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input name="q" defaultValue={q} placeholder="Zoek op probleem of onderdeel..." className="pl-10" />
            </div>
          </form>
        </div>
      </section>

      <div className="container py-8">
        <div className="flex flex-wrap gap-2 mb-6">
          <Link href="/gidsen">
            <Button variant={!difficulty ? "default" : "outline"} size="sm">Alle</Button>
          </Link>
          <Link href="/gidsen?difficulty=EASY">
            <Button variant={difficulty === "EASY" ? "default" : "outline"} size="sm">Makkelijk</Button>
          </Link>
          <Link href="/gidsen?difficulty=MEDIUM">
            <Button variant={difficulty === "MEDIUM" ? "default" : "outline"} size="sm">Gemiddeld</Button>
          </Link>
          <Link href="/gidsen?difficulty=HARD">
            <Button variant={difficulty === "HARD" ? "default" : "outline"} size="sm">Moeilijk</Button>
          </Link>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {guides.map((g) => (
            <Link key={g.id} href={`/gidsen/${g.slug}`}>
              <Card className="hover:border-primary transition-colors h-full overflow-hidden group">
                <div className="bg-gradient-to-br from-primary/10 to-accent/10 aspect-[4/2] flex items-center justify-center relative">
                  <Wrench className="h-12 w-12 text-primary/50" />
                  {g.isPremium && (
                    <Badge variant="accent" className="absolute top-2 right-2"><Crown className="h-3 w-3 mr-1" /> Premium</Badge>
                  )}
                </div>
                <CardContent className="p-5">
                  <DifficultyBadge difficulty={g.difficulty} />
                  <h3 className="font-heading text-lg font-semibold mt-2 line-clamp-2 group-hover:text-primary transition-colors">{g.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">{g.summary}</p>
                  <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {g.timeMinutes} min</span>
                    {/* Only shown once the counter means something. The seed
                        shipped invented view counts; a fresh catalogue has
                        nothing to report and should say nothing. */}
                    {g.views > 0 && (
                      <span className="flex items-center gap-1"><BookOpen className="h-3 w-3" /> {g.views.toLocaleString("nl-NL")} keer bekeken</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {guides.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center">
              <p className="text-muted-foreground">Geen gidsen gevonden voor deze zoekopdracht.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </MarketingLayout>
  );
}

function DifficultyBadge({ difficulty }: { difficulty: string }) {
  const map: Record<string, { label: string; variant: any }> = {
    EASY: { label: "Makkelijk", variant: "success" },
    MEDIUM: { label: "Gemiddeld", variant: "warning" },
    HARD: { label: "Moeilijk", variant: "danger" },
    EXPERT: { label: "Expert", variant: "danger" },
  };
  const m = map[difficulty] ?? map.MEDIUM;
  return <Badge variant={m.variant} className="text-[10px]">{m.label}</Badge>;
}
