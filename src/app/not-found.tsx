import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MarketingLayout } from "@/components/marketing-layout";
import { ArrowLeft, Search } from "lucide-react";

export default function NotFound() {
  return (
    <MarketingLayout>
      <div className="container py-24 text-center max-w-xl">
        <div className="mb-6">
          <span className="font-heading text-9xl font-bold text-muted-foreground/20">404</span>
        </div>
        <h1 className="font-heading text-3xl font-bold mb-3">Pagina niet gevonden</h1>
        <p className="text-muted-foreground mb-8">
          De pagina die je zoekt bestaat niet of is verplaatst. Geen zorgen — laten we je terug brengen.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href="/"><ArrowLeft className="h-4 w-4" /> Naar de homepage</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/diagnose"><Search className="h-4 w-4" /> Start een diagnose</Link>
          </Button>
        </div>
      </div>
    </MarketingLayout>
  );
}
