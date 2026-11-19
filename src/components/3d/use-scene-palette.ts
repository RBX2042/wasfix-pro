"use client";

import * as React from "react";

/**
 * Colours for the 3D scenes, read from the theme tokens (globals.css) so a scene follows Licht and Donker.
 *
 * three.js cannot take a CSS variable, so the tokens are resolved here with getComputedStyle and handed over as
 * "hsl(h, s%, l%)" strings, which THREE.Color parses. They are re-read whenever the class on <html> changes: a
 * MutationObserver, not the theme from next-themes, because the provider writes the class in an effect that
 * runs AFTER the effects of its children, so a child reading the variables in its own effect would still see
 * the old theme for one switch.
 *
 * Grey parts of an object are given as a lightness (0-100) as they look in the light theme and lifted into the
 * visible range in the dark theme, where a charcoal part would vanish into the dark backdrop.
 *
 * Known and left alone: the metal parts (the bearing) render almost black in both themes. The scene has no environment
 * map (PartViewer3D.tsx says why), so a metal surface has nothing to reflect and only the specular glints of the lights
 * show. Lifting the greys does not change that (tried: a lighter light-theme grey renders the same black bearing), the
 * materials are the original ones, and the brief limits this folder to colours.
 */
export type ScenePalette = {
  primary: string;
  accent: string;
  card: string;
  success: string;
  info: string;
  dark: boolean;
  /** A neutral grey. `l` is the lightness it should have in the light theme. */
  grey: (l: number) => string;
};

const FALLBACK: ScenePalette = {
  primary: "hsl(180, 60%, 26%)",
  accent: "hsl(14, 64%, 38%)",
  card: "hsl(0, 0%, 100%)",
  success: "hsl(152, 62%, 24%)",
  info: "hsl(208, 85%, 30%)",
  dark: false,
  grey: (l) => `hsl(0, 0%, ${l}%)`,
};

/** "180 60% 26%" -> "hsl(180, 60%, 26%)". Tokens with an alpha part ("... / 0.5") are not used here. */
function toHsl(triple: string, fallback: string): string {
  const m = /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/.exec(triple.trim());
  return m ? `hsl(${m[1]}, ${m[2]}%, ${m[3]}%)` : fallback;
}

function readPalette(): ScenePalette {
  const root = document.documentElement;
  const css = getComputedStyle(root);
  const dark = root.classList.contains("dark");
  return {
    primary: toHsl(css.getPropertyValue("--primary"), FALLBACK.primary),
    accent: toHsl(css.getPropertyValue("--accent"), FALLBACK.accent),
    card: toHsl(css.getPropertyValue("--card"), FALLBACK.card),
    success: toHsl(css.getPropertyValue("--success"), FALLBACK.success),
    info: toHsl(css.getPropertyValue("--info"), FALLBACK.info),
    dark,
    grey: (l) => `hsl(0, 0%, ${dark ? Math.round(38 + l * 0.55) : l}%)`,
  };
}

export function useScenePalette(): ScenePalette {
  const [palette, setPalette] = React.useState<ScenePalette>(FALLBACK);
  React.useEffect(() => {
    const update = () => setPalette(readPalette());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return palette;
}
