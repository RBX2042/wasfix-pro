import { MetadataRoute } from "next";
import { THEME_COLOR_LIGHT } from "@/components/theme-colors";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "WasFix Pro — AI wasmachine diagnose",
    short_name: "WasFix Pro",
    description: "AI-diagnose, onderdelen, gidsen. Wasmachine kapot? Wij helpen je de oorzaak te vinden.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    // Light is the default theme (src/components/theme-colors.ts), so the splash screen and the title bar of an
    // installed app are light as well; they used to be the old dark palette.
    background_color: THEME_COLOR_LIGHT,
    theme_color: THEME_COLOR_LIGHT,
    categories: ["utilities", "shopping", "lifestyle"],
    lang: "nl-NL",
    dir: "ltr",
    scope: "/",
    // Every size declared here is the real pixel size of the file behind it (scripts/qa-seo.ts reads the PNG
    // headers). 192 and 512 px are what a browser asks for to offer installation.
    icons: [
      { src: "/icon", sizes: "48x48", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "AI Diagnose", short_name: "Diagnose", url: "/diagnose", icons: [{ src: "/icon", sizes: "48x48" }] },
      { name: "Onderdelen", short_name: "Shop", url: "/onderdelen", icons: [{ src: "/icon", sizes: "48x48" }] },
      { name: "Foutcodes", short_name: "Codes", url: "/foutcodes", icons: [{ src: "/icon", sizes: "48x48" }] },
    ],
  };
}
