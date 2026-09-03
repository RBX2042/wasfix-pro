/**
 * Applies the error-code verification verdicts to src/data/error-codes.json.
 *
 * The verdicts live in data/verification/*.json and are committed alongside the
 * result, so anyone can re-derive this change or challenge a single row. Each
 * verdict is one of:
 *
 *   VERIFIED       the code exists on that brand's washing machines and our
 *                  text matches; the row gets provenance VERIFIED plus the URL
 *                  it was checked against.
 *   MEANING_WRONG  the code exists but our text was wrong; the corrected text
 *                  is written and the row also becomes VERIFIED, since the
 *                  correction itself came from a cited source.
 *   UNVERIFIED     no source places this code on that brand's washing machines
 *                  (it may belong to a dryer or dishwasher, or be a filled gap
 *                  in a sequential run). The row is DELETED, along with any
 *                  part and guide links pointing at it.
 *
 * A row is only ever marked VERIFIED with a real http(s) source URL attached —
 * a verdict claiming VERIFIED without one is refused, because the whole point
 * of the field is that the claim is checkable.
 *
 * Idempotent: it reads the verdicts, not the current state, so re-running after
 * more verdicts arrive is safe.
 *
 * Usage: npx tsx scripts/apply-errorcode-verdicts.ts [--dry-run]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

type Verdict = {
  id: string;
  brand: string;
  code: string;
  verdict: "VERIFIED" | "MEANING_WRONG" | "UNVERIFIED";
  correctTitle?: string;
  correctDescription?: string;
  correctLikelyCauses?: string;
  diyFriendly?: boolean;
  severity?: string;
  sourceUrl?: string | null;
  sourceName?: string | null;
  note?: string;
};

type ErrorCode = {
  id: string;
  code: string;
  machineId: string;
  title: string;
  description: string;
  likelyCauses: string;
  severity: string;
  diyFriendly: boolean;
  provenance: string;
  sourceUrl: string | null;
  sourceName: string | null;
};

const ROOT = process.cwd();
const VERDICT_DIR = join(ROOT, "data/verification");
const CODES = join(ROOT, "src/data/error-codes.json");
const EC_PARTS = join(ROOT, "src/data/errorcode-parts.json");
const EC_GUIDES = join(ROOT, "src/data/errorcode-guides.json");

const dryRun = process.argv.includes("--dry-run");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function main() {
  if (!existsSync(VERDICT_DIR)) {
    console.error(`No verdict directory at ${VERDICT_DIR}`);
    process.exitCode = 1;
    return;
  }

  const verdicts: Verdict[] = [];
  for (const file of readdirSync(VERDICT_DIR).filter((f) => f.endsWith(".json")).sort()) {
    const rows = readJson<Verdict[]>(join(VERDICT_DIR, file));
    verdicts.push(...rows);
    console.log(`  read ${rows.length.toString().padStart(3)} verdicts from ${file}`);
  }

  const byId = new Map(verdicts.map((v) => [v.id, v]));
  const codes = readJson<ErrorCode[]>(CODES);

  const deleted: string[] = [];
  const refused: string[] = [];
  let verified = 0;
  let corrected = 0;

  const kept = codes.filter((ec) => {
    const v = byId.get(ec.id);
    if (!v) return true; // no verdict yet — leave the row exactly as it is

    if (v.verdict === "UNVERIFIED") {
      deleted.push(`${v.brand} ${v.code}${v.note ? ` — ${v.note}` : ""}`);
      return false;
    }

    if (!isHttpUrl(v.sourceUrl)) {
      // A verdict that claims verification without a citation is not applied:
      // the row keeps whatever it had and is reported for a human to look at.
      refused.push(`${v.brand} ${v.code} (${v.verdict}, no source URL)`);
      return true;
    }

    if (v.verdict === "MEANING_WRONG") corrected++;
    verified++;

    if (v.correctTitle) ec.title = v.correctTitle;
    if (v.correctDescription) ec.description = v.correctDescription;
    if (v.correctLikelyCauses) ec.likelyCauses = v.correctLikelyCauses;
    if (typeof v.diyFriendly === "boolean") ec.diyFriendly = v.diyFriendly;
    if (v.severity) ec.severity = v.severity;
    ec.provenance = "VERIFIED";
    ec.sourceUrl = v.sourceUrl;
    ec.sourceName = v.sourceName ?? null;
    return true;
  });

  // Relations pointing at a deleted code would seed a foreign-key failure.
  const liveIds = new Set(kept.map((ec) => ec.id));
  const parts = readJson<Array<{ errorCodeId: string }>>(EC_PARTS).filter((r) => liveIds.has(r.errorCodeId));
  const guides = readJson<Array<{ errorCodeId: string }>>(EC_GUIDES).filter((r) => liveIds.has(r.errorCodeId));
  const droppedParts = readJson<unknown[]>(EC_PARTS).length - parts.length;
  const droppedGuides = readJson<unknown[]>(EC_GUIDES).length - guides.length;

  console.log(`\n  ${verified} codes verified (${corrected} of them with a corrected meaning)`);
  console.log(`  ${deleted.length} codes deleted as unsourceable:`);
  for (const d of deleted) console.log(`    - ${d}`);
  if (droppedParts || droppedGuides) {
    console.log(`  ${droppedParts} part links and ${droppedGuides} guide links dropped with them`);
  }
  if (refused.length) {
    console.log(`\n  ${refused.length} verdict(s) REFUSED — verification claimed without a source URL:`);
    for (const r of refused) console.log(`    ! ${r}`);
  }
  const stillReported = kept.filter((ec) => ec.provenance !== "VERIFIED").length;
  console.log(`\n  result: ${kept.length} codes — ${kept.length - stillReported} VERIFIED, ${stillReported} REPORTED`);

  if (dryRun) {
    console.log("\n  --dry-run: nothing written");
    return;
  }
  writeFileSync(CODES, JSON.stringify(kept, null, 2) + "\n");
  writeFileSync(EC_PARTS, JSON.stringify(parts, null, 2) + "\n");
  writeFileSync(EC_GUIDES, JSON.stringify(guides, null, 2) + "\n");
  console.log("\n  written");
}

main();
