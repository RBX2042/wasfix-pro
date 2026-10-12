import { ImageResponse } from "next/og";
import { IMAGE_CACHE_CONTROL } from "@/lib/seo";

/**
 * The app icons the web manifest (src/app/manifest.ts) names: 192 and 512 px for "any" and a full-bleed 512 px
 * maskable one. The manifest used to claim 192 and 512 px icons that were the 180 px apple icon; a browser compares
 * the declared size with the file, and scripts/qa-seo.ts does the same for every icon the manifest lists.
 *
 * "any" icons keep the rounded corners of the app icon. A maskable icon is cropped by the operating system to
 * its own shape, so it fills the whole square and keeps the mark inside the central 80 % (the safe zone).
 */
const SPECS: Record<string, { size: number; maskable: boolean }> = {
  "192": { size: 192, maskable: false },
  "512": { size: 512, maskable: false },
  "maskable-512": { size: 512, maskable: true },
};

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(SPECS).map((name) => ({ name }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const spec = Object.hasOwn(SPECS, name) ? SPECS[name] : null;
  if (!spec) return new Response("Not found", { status: 404 });
  const { size, maskable } = spec;
  const mark = Math.round(size * (maskable ? 0.5 : 0.62));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #4f8cff, #00d4ff)",
          borderRadius: maskable ? 0 : Math.round(size * 0.22),
        }}
      >
        <svg width={mark} height={mark} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="3" fill="#fff" />
        </svg>
      </div>
    ),
    // One day, not the year ImageResponse sends by default: these addresses carry no content hash, so a changed icon
    // has to reach installed apps and crawlers within a day.
    { width: size, height: size, headers: { "Cache-Control": IMAGE_CACHE_CONTROL } },
  );
}
