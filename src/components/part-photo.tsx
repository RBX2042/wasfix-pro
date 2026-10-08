import Image from "next/image";
import { ImageOff } from "lucide-react";
import { categoryLabel } from "@/lib/part-categories";

// Hosts next.config.ts lists in images.remotePatterns. next/image throws at
// render time for any other host, which would take the whole page down the day
// the owner pastes a photo URL from somewhere else; those go through a plain
// <img> instead (the CSP still decides whether the browser may load it).
const OPTIMIZED_HOSTS = [/(^|\.)supabase\.co$/, /^images\.unsplash\.com$/, /^cdn\.jsdelivr\.net$/];

function canOptimize(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && OPTIMIZED_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/**
 * The picture of a part, or an honest "Foto volgt" tile.
 *
 * Every seed image was a placehold.co text tile that looked like a product photo.
 * static-db.realImageUrl() now turns those into null; this component is the other
 * half: with no real photo it says so, with the category as the only content, and
 * a real URL on Part.imageUrl takes over automatically with no code change.
 */
export function PartPhoto({
  imageUrl,
  name,
  category,
  sizes,
  priority = false,
  className = "",
}: {
  imageUrl: string | null;
  name: string;
  category: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  if (!imageUrl) {
    return (
      <div
        className={`relative flex flex-col items-center justify-center gap-1.5 bg-muted text-muted-foreground ${className}`}
        role="img"
        aria-label={`Foto volgt voor ${name}`}
      >
        <ImageOff className="h-8 w-8 opacity-50" aria-hidden="true" />
        <span className="text-xs font-medium">Foto volgt</span>
        <span className="text-[11px] opacity-70">{categoryLabel(category)}</span>
      </div>
    );
  }
  return (
    <div className={`relative overflow-hidden bg-muted ${className}`}>
      {canOptimize(imageUrl) ? (
        <Image src={imageUrl} alt={name} fill sizes={sizes} className="object-cover" priority={priority} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={name} loading={priority ? "eager" : "lazy"} className="absolute inset-0 h-full w-full object-cover" />
      )}
    </div>
  );
}

/**
 * A 48px thumbnail for lists (the parts of a guide): the photo when there is a real
 * one, nothing when there is not. Same host safety as PartPhoto - a photo URL on a
 * host next.config does not list must not crash the page.
 */
export function PartThumb({ imageUrl, name }: { imageUrl: string | null; name: string }) {
  if (!imageUrl) return null;
  return canOptimize(imageUrl) ? (
    <Image src={imageUrl} alt={name} width={48} height={48} className="h-12 w-12 rounded bg-muted object-cover" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imageUrl} alt={name} width={48} height={48} loading="lazy" className="h-12 w-12 rounded bg-muted object-cover" />
  );
}
