import Link from "next/link";
import { Sparkles } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="border-t bg-muted/40 mt-20">
      <div className="container py-12">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <Link href="/" className="flex items-center gap-2 font-heading font-bold text-lg">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              WasFix<span className="text-accent">Pro</span>
            </Link>
            <p className="mt-3 text-sm text-muted-foreground">
              AI-gestuurde wasmachine diagnose en originele onderdelen, voor consumenten en monteurs.
            </p>
          </div>

          <div>
            <h4 className="font-semibold mb-3 text-sm">Product</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="/diagnose" className="hover:text-foreground">AI Diagnose</Link></li>
              <li><Link href="/onderdelen" className="hover:text-foreground">Onderdelen</Link></li>
              <li><Link href="/gidsen" className="hover:text-foreground">Reparatiegidsen</Link></li>
              <li><Link href="/foutcodes" className="hover:text-foreground">Foutcodes database</Link></li>
              <li><Link href="/tools/repareren-of-vervangen" className="hover:text-foreground">Repareren of vervangen?</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-3 text-sm">Bedrijf</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="/prijzen" className="hover:text-foreground">Prijzen</Link></li>
              <li><Link href="/monteur" className="hover:text-foreground">Voor monteurs</Link></li>
              <li><Link href="/api-info" className="hover:text-foreground">API toegang</Link></li>
              <li><Link href="/over" className="hover:text-foreground">Over ons</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-3 text-sm">Support</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="/help" className="hover:text-foreground">Helpcentrum</Link></li>
              <li><Link href="/contact" className="hover:text-foreground">Contact</Link></li>
              <li><Link href="/privacy" className="hover:text-foreground">Privacy</Link></li>
              <li><Link href="/voorwaarden" className="hover:text-foreground">Voorwaarden</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} WasFix Pro. Alle rechten voorbehouden.</p>
          <p>Made with care in The Netherlands.</p>
        </div>
      </div>
    </footer>
  );
}
