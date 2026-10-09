/**
 * Find Playwright without making it a dependency of the app.
 *
 * Order: PLAYWRIGHT_PATH (a path to playwright/index.js), the `playwright` package
 * if it is installed, the global install of the development machine. CI installs
 * it on the fly (see .github/workflows/ci.yml).
 */
import { createRequire } from "node:module";

type PlaywrightLike = { chromium: { launch: (opts?: Record<string, unknown>) => Promise<any> } }; // eslint-disable-line @typescript-eslint/no-explicit-any

export function loadPlaywright(): PlaywrightLike | null {
  const require = createRequire(`${process.cwd()}/`);
  const candidates = [process.env.PLAYWRIGHT_PATH, "playwright", "/opt/node22/lib/node_modules/playwright/index.js"].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      return require(c) as PlaywrightLike;
    } catch {
      // try the next one
    }
  }
  return null;
}

/** Minimal check runner shared by the QA scripts of this bundle. */
export function makeChecker(title: string) {
  const lines: string[] = [];
  let failed = 0;
  return {
    check(cond: boolean, ok: string, bad?: string) {
      if (!cond) failed++;
      lines.push(cond ? `PASS ${ok}` : `FAIL ${bad ?? ok}`);
    },
    note(text: string) {
      lines.push(`---- ${text}`);
    },
    finish(): number {
      console.log(`\n=== ${title} ===`);
      for (const l of lines) console.log(l);
      const total = lines.filter((l) => l.startsWith("PASS") || l.startsWith("FAIL")).length;
      console.log(`\n${total - failed}/${total} checks passed${failed ? `, ${failed} FAILED` : ""}`);
      return failed ? 1 : 0;
    },
  };
}
