import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WasFix Pro — AI wasmachine diagnose",
    short_name: "WasFix Pro",
    description: "AI-diagnose, onderdelen, gidsen. Wasmachine kapot? Wij weten wat er echt mis is.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#060912",
    theme_color: "#4f8cff",
    categories: ["utilities", "shopping", "lifestyle"],
    lang: "nl-NL",
    dir: "ltr",
    scope: "/",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
      { src: "/apple-icon", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "AI Diagnose", short_name: "Diagnose", url: "/diagnose", icons: [{ src: "/icon", sizes: "32x32" }] },
      { name: "Onderdelen", short_name: "Shop", url: "/onderdelen", icons: [{ src: "/icon", sizes: "32x32" }] },
      { name: "Foutcodes", short_name: "Codes", url: "/foutcodes", icons: [{ src: "/icon", sizes: "32x32" }] },
    ],
  };
}
