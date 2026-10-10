/**
 * Tests for the deploy pipeline: .github/workflows/deploy.yml and scripts/deploy/*.sh,
 * run WITHOUT Vercel, without a database and without the network.
 *
 *   npx tsx scripts/qa-deploy.ts
 *
 * How: a fake `vercel` and a fake `npm` are put first on PATH. They log every call
 * (so the ORDER pull -> migrate -> preflight -> build -> deploy -> preflight --url can
 * be asserted), write what the real ones write (.vercel/.env.production.local from a
 * fake Production environment, .vercel/output, a deployment URL on stdout) and fail
 * on request. check-ci.sh talks to a fake GitHub API on 127.0.0.1; check-ref.sh and
 * checkout-tip.sh run against a temporary git origin. The workflow file is parsed and
 * read back for the expressions and outputs the scripts depend on. Two runs use the
 * REAL preflight (scripts/preflight.ts, offline) to show that its report carries no
 * secret value. The additive-migration scanner is tested on SQL samples before it is
 * run over prisma/migrations.
 *
 * Every gate has a case that shows it stopping, and the proof that nothing after the
 * stop ran is the call log of the fakes. Secrets in these tests are built at run time
 * and are not key-shaped (push protection).
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { makeChecker } from "./lib/browser";

const { check, note, finish } = makeChecker("qa-deploy");
const ROOT = process.cwd();
const DEPLOY = path.join(ROOT, "scripts", "deploy");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "deploy.yml");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wasfix-deploy-"));
let seq = 0;

// ── fixtures (built at run time; none of these is key-shaped) ─────────────────
const TOKEN = ["vcl", "qa", "T".repeat(24)].join("-");
const ORG = `team_${"o".repeat(20)}`;
const PROJECT = `prj_${"p".repeat(20)}`;
const DB_PW = `pw-pooled-${"a".repeat(12)}`;
const DIRECT_PW = `pw-direct-${"b".repeat(12)}`;
const STRIPE_KEY = ["sk", "live", "c".repeat(24)].join("_");
const CRON = `cron-${"d".repeat(28)}`;
const RESEND = `re_${"e".repeat(20)}`;
const GH_TOKEN = `ghs_${"f".repeat(30)}`;
const DEPLOY_URL = "https://wasfix-pro-abc123-example-team.vercel.app";
const SITE = "https://shop.example.nl";
const DATABASE_URL = `postgresql://postgres.abcdefgh:${DB_PW}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1`;
const DIRECT_URL = `postgresql://postgres.abcdefgh:${DIRECT_PW}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`;
/** Values that must never appear in anything the scripts print. */
const SECRET_VALUES = [TOKEN, ORG, PROJECT, DB_PW, DIRECT_PW, STRIPE_KEY, CRON, RESEND, GH_TOKEN];
const leaks = (text: string) => SECRET_VALUES.filter((v) => text.includes(v));

/** A Production environment as `vercel pull` writes it (one NAME="value" per line). */
function envFileText(overrides: Record<string, string | null> = {}): string {
  const vars: Record<string, string | null> = {
    DATABASE_URL, DIRECT_URL, NEXT_PUBLIC_APP_URL: SITE, STRIPE_SECRET_KEY: STRIPE_KEY, CRON_SECRET: CRON, RESEND_API_KEY: RESEND, VERCEL_ENV: "production",
    ...overrides,
  };
  return `# Created by Vercel CLI\n${Object.entries(vars).filter(([, v]) => v !== null).map(([k, v]) => `${k}="${v}"`).join("\n")}\n`;
}

// ── the fakes ─────────────────────────────────────────────────────────────────
const bin = path.join(tmp, "bin");
fs.mkdirSync(bin);
function writeExe(name: string, lines: string[]) {
  const p = path.join(bin, name);
  fs.writeFileSync(p, lines.join("\n") + "\n");
  fs.chmodSync(p, 0o755);
}
writeExe("vercel", [
  "#!/usr/bin/env bash",
  "# fake Vercel CLI for scripts/qa-deploy.ts: logs its arguments, writes what the real one writes, never uses the network",
  'echo "vercel $*" >> "$FAKE_LOG"',
  'case " $* " in *" --token=$VERCEL_TOKEN "*) ;; *) echo "fake vercel: --token missing or wrong" >&2; exit 98 ;; esac',
  'case "$1" in',
  "  pull)",
  '    [ -n "$VERCEL_ORG_ID" ] && [ -n "$VERCEL_PROJECT_ID" ] || { echo "fake vercel: not linked (VERCEL_ORG_ID / VERCEL_PROJECT_ID missing)" >&2; exit 97; }',
  '    [ "$FAKE_PULL_EXIT" = 0 ] || { echo "Error: fake pull failure" >&2; exit "$FAKE_PULL_EXIT"; }',
  "    mkdir -p .vercel",
  '    [ "$FAKE_PULL_NO_FILE" = 1 ] || cp "$FAKE_ENV_SOURCE" .vercel/.env.production.local',
  '    printf \'{"orgId":"%s","projectId":"%s"}\\n\' "$VERCEL_ORG_ID" "$VERCEL_PROJECT_ID" > .vercel/project.json',
  '    echo "> Downloaded Production environment to .vercel/.env.production.local (fake)" >&2',
  "    ;;",
  "  build)",
  '    [ "$FAKE_BUILD_EXIT" = 0 ] || { echo "Error: fake build failure" >&2; exit "$FAKE_BUILD_EXIT"; }',
  '    mkdir -p .vercel/output && echo "> Build Completed in .vercel/output (fake)" >&2',
  "    ;;",
  "  deploy)",
  '    [ "$FAKE_DEPLOY_EXIT" = 0 ] || { echo "Error: fake deploy failure" >&2; exit "$FAKE_DEPLOY_EXIT"; }',
  '    echo "Inspect: https://vercel.com/fake/inspect (fake)" >&2',
  '    [ "$FAKE_DEPLOY_NO_URL" = 1 ] || echo "$FAKE_DEPLOY_URL"',
  "    ;;",
  '  *) echo "fake vercel: unexpected $*" >&2; exit 99 ;;',
  "esac",
]);
writeExe("npm", [
  "#!/usr/bin/env bash",
  "# fake npm for scripts/qa-deploy.ts: the two package scripts the pipeline runs, nothing else",
  'echo "npm $*" >> "$FAKE_LOG"',
  'if [ "$1" = run ] && [ "$2" = db:migrate:deploy ]; then',
  '  printf \'DATABASE_URL=%s\\nDIRECT_URL=%s\\n\' "$DATABASE_URL" "$DIRECT_URL" > "$FAKE_SEEN_MIGRATE"',
  '  echo "Database: fake-host:5432/fake via fake (migrate)"',
  '  exit "$FAKE_MIGRATE_EXIT"',
  "fi",
  'if [ "$1" = run ] && [ "$2" = preflight ] && [ "$3" = -- ]; then',
  "  shift 3",
  '  case " $* " in *" --url "*) code="$FAKE_PREFLIGHT_URL_EXIT" ;; *) code="$FAKE_PREFLIGHT_EXIT" ;; esac',
  '  echo "[fake preflight] $*"',
  '  if [ "$code" = 0 ]; then echo "UITSLAG: KLAAR (0 blokkerend, 0 waarschuwing(en))"; else echo "UITSLAG: NIET KLAAR (1 blokkerend, 0 waarschuwing(en))"; fi',
  '  exit "$code"',
  "fi",
  'echo "fake npm: unexpected $*" >&2; exit 99',
]);

// ── process helpers ───────────────────────────────────────────────────────────
type Proc = { code: number; out: string; err: string };
function run(cmd: string, args: string[], opts: { cwd: string; env: Record<string, string> }): Promise<Proc> {
  return new Promise((resolve) => {
    // The same cast as qa-preflight: the repository's ProcessEnv augmentation makes NODE_ENV required, and these children must NOT inherit it.
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] as const });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code: code ?? -1, out, err }));
  });
}
const readOr = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
const realPath = process.env.PATH ?? "/usr/bin:/bin";
const baseEnv = () => ({ PATH: `${bin}:${realPath}`, HOME: tmp, LANG: "C" });

type GateRun = Proc & { output: string; summary: string };
/** Run one gate script with GITHUB_OUTPUT / GITHUB_STEP_SUMMARY files, as the workflow does. */
async function gate(script: string, args: string[], env: Record<string, string | undefined>, cwd = tmp): Promise<GateRun> {
  const output = path.join(tmp, `output-${++seq}`);
  const summary = path.join(tmp, `summary-${seq}`);
  const full: Record<string, string> = { ...baseEnv(), GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary };
  for (const [k, v] of Object.entries(env)) if (v !== undefined) full[k] = v;
  const r = await run("bash", [path.join(DEPLOY, script), ...args], { cwd, env: full });
  return { ...r, output: readOr(output), summary: readOr(summary) };
}

type Pipeline = Proc & { calls: string[]; log: string[]; output: string; summary: string; seen: string; vercelLeft: boolean; work: string };
const tag = (l: string) =>
  l.startsWith("vercel pull") ? "pull" : l.startsWith("npm run db:migrate:deploy") ? "migrate" : l.startsWith("npm run preflight") ? (l.includes(" --url ") ? "preflight-url" : "preflight") : l.startsWith("vercel build") ? "build" : l.startsWith("vercel deploy") ? "deploy" : l;
/** Run scripts/deploy/run.sh in a fresh working directory with the fakes on PATH. */
async function pipeline(opts: { envFile?: string; fake?: Record<string, string>; secrets?: Record<string, string | undefined> } = {}): Promise<Pipeline> {
  const n = ++seq;
  const work = path.join(tmp, `work-${n}`);
  fs.mkdirSync(work);
  const files = { log: path.join(tmp, `log-${n}`), output: path.join(tmp, `output-${n}`), summary: path.join(tmp, `summary-${n}`), seen: path.join(tmp, `seen-${n}`), envSource: path.join(tmp, `env-${n}.env`) };
  fs.writeFileSync(files.envSource, opts.envFile ?? envFileText());
  const env: Record<string, string> = {
    ...baseEnv(),
    GITHUB_OUTPUT: files.output, GITHUB_STEP_SUMMARY: files.summary,
    VERCEL_TOKEN: TOKEN, VERCEL_ORG_ID: ORG, VERCEL_PROJECT_ID: PROJECT,
    FAKE_LOG: files.log, FAKE_ENV_SOURCE: files.envSource, FAKE_SEEN_MIGRATE: files.seen, FAKE_DEPLOY_URL: DEPLOY_URL,
    FAKE_PULL_EXIT: "0", FAKE_PULL_NO_FILE: "0", FAKE_BUILD_EXIT: "0", FAKE_DEPLOY_EXIT: "0", FAKE_DEPLOY_NO_URL: "0", FAKE_MIGRATE_EXIT: "0", FAKE_PREFLIGHT_EXIT: "0", FAKE_PREFLIGHT_URL_EXIT: "0",
    ...opts.fake,
  };
  for (const [k, v] of Object.entries(opts.secrets ?? {})) if (v === undefined) delete env[k]; else env[k] = v;
  const r = await run("bash", [path.join(DEPLOY, "run.sh")], { cwd: work, env });
  const log = readOr(files.log).split("\n").filter(Boolean);
  return { ...r, log, calls: log.map(tag), output: readOr(files.output), summary: readOr(files.summary), seen: readOr(files.seen), vercelLeft: fs.existsSync(path.join(work, ".vercel")), work };
}
const describe = (r: Pipeline) => `exit ${r.code}; calls ${JSON.stringify(r.calls)}; out ${r.out.slice(-300).replace(/\n/g, " | ")}; err ${r.err.slice(-300).replace(/\n/g, " | ")}`;

// ── 1. the scripts and the workflow, read statically ──────────────────────────
type Step = { name?: string; id?: string; if?: string; run?: string; uses?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Workflow = { name: string; on: Record<string, unknown>; permissions: Record<string, string>; concurrency: { group: string; "cancel-in-progress": boolean }; jobs: Record<string, { if?: string; env?: Record<string, string>; steps: Step[]; "timeout-minutes"?: number }> };

function parseYaml(text: string): Workflow | null {
  // js-yaml is eslint's dependency (present after npm ci); PyYAML is the fallback, nothing else is.
  try {
    const yaml = createRequire(path.join(ROOT, "package.json"))("js-yaml") as { load: (s: string) => unknown };
    return yaml.load(text) as Workflow;
  } catch {
    // tried below
  }
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const py = spawnSync("python3", ["-c", "import json,sys,yaml; print(json.dumps(yaml.safe_load(sys.stdin.read())))"], { input: text, encoding: "utf8" });
  if (py.status === 0) {
    const doc = JSON.parse(py.stdout) as Record<string, unknown>;
    if (doc.on === undefined && doc.true !== undefined) doc.on = doc.true; // PyYAML (YAML 1.1) reads the key `on` as a boolean
    return doc as unknown as Workflow;
  }
  return null;
}

/** The code lines of a shell script or workflow: comment lines dropped, so a comment that SAYS "no cat" is not a hit. */
const codeLines = (text: string) => text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const LEAK_PATTERNS: Array<[string, RegExp]> = [
  ["set -x / xtrace", /\bset\s+-x\b|\bset\s+-o\s+xtrace\b|\bbash\s+-x\b/],
  ["cat/less/head/tail of the variables file", /\b(cat|less|head|tail|more)\b[^\n]*(ENV_FILE|\.env\b)/],
  ["sourcing the variables file", /(^|[\s;])(source|\.)\s+[^\n]*(ENV_FILE|\.env\b)/m],
  ["printing a variable's value", /\becho\b[^\n]*"\$(db|direct|site|DATABASE_URL|DIRECT_URL|VERCEL_TOKEN)\b/],
];

function section1_static() {
  note("scripts/deploy/*.sh and deploy.yml, read back");
  const scripts = fs.readdirSync(DEPLOY).filter((f) => f.endsWith(".sh")).sort();
  const expected = ["build.sh", "check-ci.sh", "check-ref.sh", "check-secrets.sh", "checkout-tip.sh", "deploy.sh", "lib.sh", "migrate.sh", "preflight-gate.sh", "pull.sh", "run.sh"];
  check(JSON.stringify(scripts) === JSON.stringify(expected), `the pipeline is ${expected.length} small scripts (${expected.join(", ")})`, `found: ${scripts.join(", ")}`);
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  for (const s of scripts) {
    const src = fs.readFileSync(path.join(DEPLOY, s), "utf8");
    check(spawnSync("bash", ["-n", path.join(DEPLOY, s)]).status === 0, `${s}: bash -n accepts it`);
    if (s !== "lib.sh") check(/^set -euo pipefail$/m.test(src) && /^\. "\$\(dirname "\$0"\)\/lib\.sh"$|^\. "\$here\/lib\.sh"$/m.test(src), `${s}: set -euo pipefail and the shared lib.sh`);
    for (const [what, re] of LEAK_PATTERNS) check(!re.test(codeLines(src)), `${s}: no ${what}`, `${s} contains ${what}: ${re.exec(codeLines(src))?.[0]}`);
  }
  const wfText = fs.readFileSync(WORKFLOW, "utf8");
  for (const [what, re] of LEAK_PATTERNS) check(!re.test(codeLines(wfText)), `deploy.yml: no ${what}`);
  const referenced = [...wfText.matchAll(/scripts\/deploy\/([\w-]+\.sh)/g)].map((m) => m[1]);
  check(referenced.length >= 5 && referenced.every((f) => fs.existsSync(path.join(DEPLOY, f))), `every script deploy.yml runs exists (${[...new Set(referenced)].join(", ")})`);
  for (const f of ["check-secrets.sh", "check-ref.sh", "check-ci.sh", "checkout-tip.sh", "run.sh"]) check(referenced.includes(f), `deploy.yml runs ${f}`);
  check(/bash scripts\/deploy\/run\.sh/.test(wfText) && !/bash scripts\/deploy\/(pull|migrate|build|deploy|preflight-gate)\.sh/.test(wfText), "the workflow runs the pipeline through run.sh, never a pipeline step on its own (the order lives in ONE testable place)");

  note("deploy.yml, parsed: triggers, concurrency, permissions, the job condition and the step outputs");
  const wf = parseYaml(wfText);
  check(!!wf, "deploy.yml parses as YAML (js-yaml, else PyYAML)", "no YAML parser available: install js-yaml (eslint brings it) or PyYAML");
  if (!wf) return;
  const on = wf.on;
  const wr = on.workflow_run as { workflows?: string[]; types?: string[]; branches?: string[] } | undefined;
  const ciName = /^name:\s*(.+)$/m.exec(fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8"))?.[1]?.trim();
  check(!!wr && JSON.stringify(wr.workflows) === JSON.stringify([ciName]) && JSON.stringify(wr.types) === JSON.stringify(["completed"]) && JSON.stringify(wr.branches) === JSON.stringify(["main"]), `trigger: workflow_run of "${ciName}" (the name in ci.yml), completed, on main`, JSON.stringify(wr));
  check("workflow_dispatch" in on, "trigger: workflow_dispatch (by hand)");
  check(!("push" in on) && !("pull_request" in on), "no push / pull_request trigger: a deploy never starts before CI has judged the commit");
  check(typeof wf.concurrency?.group === "string" && wf.concurrency.group.length > 0 && wf.concurrency["cancel-in-progress"] === false, "concurrency group with cancel-in-progress: false (two deploys never run at once, a running one is never cut off)", JSON.stringify(wf.concurrency));
  check(wf.permissions?.contents === "read" && wf.permissions?.actions === "read", "permissions: contents read, actions read (check-ci.sh lists runs), nothing else", JSON.stringify(wf.permissions));
  const job = wf.jobs.deploy;
  check(!!job && Object.keys(wf.jobs).length === 1, "one job: deploy");
  if (!job) return;
  const cond = job.if ?? "";
  for (const needle of ["github.event.workflow_run.conclusion == 'success'", "github.event.workflow_run.event == 'push'", "github.event.workflow_run.head_branch == 'main'", "github.event.workflow_run.head_repository.full_name == github.repository", "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'"]) {
    check(cond.includes(needle), `job if: ${needle}`, `job if is: ${cond}`);
  }
  const usesSecrets = (s: string) => /(^|[^.\w])secrets\./.test(s); // `steps.secrets.outputs` is the gate step's id, not the secrets context
  check(!usesSecrets(cond) && job.steps.every((s) => !usesSecrets(s.if ?? "")), "no `secrets.` context in any if: (GitHub does not allow it; the secrets gate is a step with an output)");
  check(job.env?.VERCEL_TOKEN === "${{ secrets.VERCEL_TOKEN }}" && job.env?.VERCEL_ORG_ID === "${{ secrets.VERCEL_ORG_ID }}" && job.env?.VERCEL_PROJECT_ID === "${{ secrets.VERCEL_PROJECT_ID }}", "the three Vercel secrets reach the scripts as job environment", JSON.stringify(job.env));
  check(job.env?.DEPLOY_SHA === "${{ github.event.workflow_run.head_sha || github.sha }}", "DEPLOY_SHA = the commit CI tested, or the tip of main for a dispatch");
  check((job["timeout-minutes"] ?? 0) > 0 && (job["timeout-minutes"] ?? 0) <= 60, "the job has a timeout");
  const steps = job.steps;
  const idx = (pred: (s: Step) => boolean) => steps.findIndex(pred);
  const iCheckout = idx((s) => /actions\/checkout@/.test(s.uses ?? ""));
  check(iCheckout === 0 && steps[0].with?.ref === "${{ github.event.workflow_run.head_sha || github.sha }}", "step 1 checks out exactly the commit CI tested (workflow_run.head_sha), not whatever main is now", JSON.stringify(steps[0]));
  const iSecrets = idx((s) => /check-secrets\.sh/.test(s.run ?? ""));
  const iRef = idx((s) => /check-ref\.sh/.test(s.run ?? ""));
  const iNode = idx((s) => /actions\/setup-node@/.test(s.uses ?? ""));
  const iCi = idx((s) => /check-ci\.sh/.test(s.run ?? ""));
  const iTip = idx((s) => /checkout-tip\.sh/.test(s.run ?? ""));
  const iNpm = idx((s) => /^npm ci$/m.test(s.run ?? ""));
  const iCli = idx((s) => /npm i(nstall)? -g vercel@latest/.test(s.run ?? ""));
  const iRun = idx((s) => /scripts\/deploy\/run\.sh/.test(s.run ?? ""));
  const iClean = idx((s) => /rm -rf \.vercel/.test(s.run ?? ""));
  check(iSecrets === 1 && steps[iSecrets].id === "secrets" && !steps[iSecrets].if, "step 2 is the secrets gate (id secrets), unconditional");
  check(iRef === 2 && steps[iRef].id === "ref" && steps[iRef].if === "steps.secrets.outputs.configured == 'true'" && /check-ref\.sh "\$DEPLOY_SHA" main/.test(steps[iRef].run ?? ""), "step 3 is the ref gate (id ref), only when the secrets are set, for DEPLOY_SHA against main", JSON.stringify(steps[iRef]));
  check(iNode > iRef && iCi > iNode && iTip > iCi && iNpm > iTip && iCli > iNpm && iRun > iCli && iClean === steps.length - 1, `step order: checkout, secrets, ref, setup-node, check-ci, checkout-tip, npm ci, vercel CLI, run.sh, cleanup (got ${[iCheckout, iSecrets, iRef, iNode, iCi, iTip, iNpm, iCli, iRun, iClean].join(",")})`);
  for (const i of [iNode, iCi]) check(i > 0 && steps[i].if === "steps.secrets.outputs.configured == 'true'", `step ${i + 1} (${steps[i].name ?? steps[i].uses}) runs when the secrets gate said true (the ref gate always names a commit to deploy)`, JSON.stringify(steps[i]));
  check(iCi > 0 && steps[iCi].id === "ci" && steps[iCi].env?.GITHUB_TOKEN === "${{ secrets.GITHUB_TOKEN }}" && steps[iCi].env?.DEPLOY_TARGET === "${{ steps.ref.outputs.sha }}" && steps[iCi].env?.STALE_RUN === "${{ steps.ref.outputs.current == 'false' }}" && /check-ci\.sh "\$DEPLOY_TARGET"/.test(steps[iCi].run ?? ""), "the CI gate (id ci) gets GITHUB_TOKEN, the commit check-ref chose (steps.ref.outputs.sha) and STALE_RUN = (current == 'false'), all as environment", JSON.stringify(steps[iCi]));
  check(iTip > 0 && steps[iTip].if === "steps.ci.outputs.green == 'true' && steps.ref.outputs.current == 'false'" && steps[iTip].env?.DEPLOY_TARGET === "${{ steps.ref.outputs.sha }}" && /checkout-tip\.sh "\$DEPLOY_TARGET"/.test(steps[iTip].run ?? ""), "the tip is checked out only when CI is green for it AND this run's own commit is not the tip", JSON.stringify(steps[iTip]));
  for (const i of [iNpm, iCli, iRun]) check(i > 0 && steps[i].if === "steps.ci.outputs.green == 'true'", `step ${i + 1} (${steps[i].name ?? steps[i].uses}) runs only when the CI gate said green=true (which it only says after the secrets gate said true)`, JSON.stringify(steps[i]));
  check(steps.every((s) => !/\$\{\{/.test(s.run ?? "")), "no `${{ }}` expression inside any run: (step outputs and secrets reach the scripts as environment; nothing is inlined into shell)", JSON.stringify(steps.filter((s) => /\$\{\{/.test(s.run ?? "")).map((s) => s.name)));
  check(iClean > 0 && steps[iClean].if === "always()", "the last step removes .vercel/ with if: always() (also after a failure or a skip)");
  check(iNode > 0 && steps[iNode].with?.["node-version"] === 22, "Node 22, as package.json engines says");
  check(steps.every((s) => !s.uses || /@v\d+$/.test(s.uses)), "actions are pinned to a major version like ci.yml does");
  check(/vercel@latest/.test(steps[iCli]?.run ?? "") && /pin/i.test(wfText), "vercel@latest, with the comment that says why it is not pinned and to pin after the first run");
}

// ── 2. lib.sh: reading one variable from the pulled file without sourcing it ──
async function section2_envValue() {
  note("lib.sh env_value: the pulled file is read, never sourced");
  const file = path.join(tmp, "probe.env");
  fs.writeFileSync(file, 'A="1"\r\nexport B=two\n  C = 3\nD=\'single\'\nE=x=y#z\nA="last wins"\nF="https://shop.example.nl"\nG="$(touch ' + path.join(tmp, "EXECUTED") + ')"\n');
  const r = await run("bash", ["-c", `. "${path.join(DEPLOY, "lib.sh")}"; for n in A B C D E F G H; do printf '%s=[%s]\\n' "$n" "$(env_value "${file}" "$n")"; done; echo "count=$(env_count "${file}")"`], { cwd: tmp, env: baseEnv() });
  const got = Object.fromEntries(r.out.trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  check(got.A === "[last wins]" && got.B === "[two]" && got.D === "[single]" && got.E === "[x=y#z]" && got.F === "[https://shop.example.nl]", "quoted, single-quoted, export, a value with = and #, CRLF; the last occurrence wins (like preflight's parseEnvFile)", r.out + r.err);
  check(got.C === "[]" && got.H === "[]", "a line that is not NAME=value, and an absent name, give the empty string (the caller treats that as missing)", r.out);
  check(got.G === "[$(touch " + path.join(tmp, "EXECUTED") + ")]" && !fs.existsSync(path.join(tmp, "EXECUTED")), "a value that looks like a command substitution is returned as text and NOT executed", r.out);
  check(got.count === "7", "env_count counts the defined lines (7: A twice, B, D, E, F, G), which is all pull.sh prints about the file", r.out);
}

// ── 3. check-secrets.sh ───────────────────────────────────────────────────────
async function section3_secrets() {
  note("check-secrets.sh: skip cleanly without the secrets, never print a value");
  const all = await gate("check-secrets.sh", [], { VERCEL_TOKEN: TOKEN, VERCEL_ORG_ID: ORG, VERCEL_PROJECT_ID: PROJECT });
  check(all.code === 0 && /^configured=true$/m.test(all.output), "all three set: exit 0, output configured=true", `exit ${all.code} output ${all.output} ${all.err}`);
  check(leaks(all.out + all.err + all.summary + all.output).length === 0, "...and no value is printed", all.out);
  const noToken = await gate("check-secrets.sh", [], { VERCEL_ORG_ID: ORG, VERCEL_PROJECT_ID: PROJECT });
  check(noToken.code === 0 && /^configured=false$/m.test(noToken.output), "VERCEL_TOKEN missing: exit 0 (a skip, not a failure), output configured=false", `exit ${noToken.code} output ${noToken.output}`);
  check(/VERCEL_TOKEN/.test(noToken.summary) && !/VERCEL_ORG_ID/.test(noToken.summary) && /overgeslagen/.test(noToken.summary) && /README/.test(noToken.summary), "...the job summary names exactly the missing secret and points at the README", noToken.summary);
  check(leaks(noToken.out + noToken.err + noToken.summary).length === 0, "...and the values that ARE set are not printed", noToken.out);
  const empty = await gate("check-secrets.sh", [], { VERCEL_TOKEN: "", VERCEL_ORG_ID: "   " });
  check(empty.code === 0 && /configured=false/.test(empty.output) && /VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID/.test(empty.summary), "empty or absent secrets: all three named (an empty secret counts as missing)", empty.summary);
}

// ── 4. check-ref.sh ───────────────────────────────────────────────────────────
async function section4_ref() {
  note("check-ref.sh: an older commit, queued behind a newer one, steps aside instead of rolling main back");
  const git = (args: string[], cwd: string) => run("git", ["-c", "user.name=qa", "-c", "user.email=qa@example.test", "-c", "init.defaultBranch=main", ...args], { cwd, env: { ...baseEnv(), GIT_CONFIG_NOSYSTEM: "1" } });
  const origin = path.join(tmp, "origin.git");
  const clone1 = path.join(tmp, "clone1");
  const clone2 = path.join(tmp, "clone2");
  await git(["init", "--bare", "-q", origin], tmp);
  await git(["clone", "-q", origin, clone1], tmp);
  await git(["commit", "-q", "--allow-empty", "-m", "A"], clone1);
  const shaA = (await git(["rev-parse", "HEAD"], clone1)).out.trim();
  await git(["push", "-q", "-u", "origin", "main"], clone1);
  await git(["commit", "-q", "--allow-empty", "-m", "B"], clone1);
  const shaB = (await git(["rev-parse", "HEAD"], clone1)).out.trim();
  await git(["push", "-q", "origin", "main"], clone1);
  // The runner's situation: a checkout at the commit CI tested, while origin may have moved on.
  await git(["clone", "-q", origin, clone2], tmp);
  await git(["checkout", "-q", shaA], clone2);
  const stale = await gate("check-ref.sh", [shaA, "main"], {}, clone2);
  check(stale.code === 0 && /^current=false$/m.test(stale.output), "checkout at A while origin/main is at B: exit 0, current=false (asked at origin, not the local clone)", `exit ${stale.code} output ${stale.output} err ${stale.err}`);
  check(new RegExp(`^sha=${shaB}$`, "m").test(stale.output), "...and sha=<the tip B>: the run deploys the tip, not its own older commit", stale.output);
  check(stale.summary.includes(shaA) && stale.summary.includes(shaB) && /rollback/.test(stale.summary) && /geannuleerd/.test(stale.summary) && !/zorgt voor zijn eigen deploy/.test(stale.summary), "...the summary names both commits, the word rollback, and that the tip's own run may have been cancelled (it no longer claims that run deploys)", stale.summary);
  await git(["checkout", "-q", shaB], clone2);
  const current = await gate("check-ref.sh", [shaB, "main"], {}, clone2);
  check(current.code === 0 && /^current=true$/m.test(current.output) && new RegExp(`^sha=${shaB}$`, "m").test(current.output), "checkout at B = origin/main: current=true, sha=B", `exit ${current.code} output ${current.output} err ${current.err}`);
  const noBranch = await gate("check-ref.sh", [shaB, "does-not-exist"], {}, clone2);
  check(noBranch.code === 1 && !/current=/.test(noBranch.output) && !/sha=/.test(noBranch.output), "a branch origin does not have: exit 1, no output (never 'current=true' or a sha by accident)", `exit ${noBranch.code} ${noBranch.err}`);
  await git(["remote", "set-url", "origin", `file://${path.join(tmp, "no-such-origin.git")}`], clone2);
  const noOrigin = await gate("check-ref.sh", [shaB, "main"], {}, clone2);
  check(noOrigin.code === 1 && !/current=/.test(noOrigin.output) && !/sha=/.test(noOrigin.output) && /ls-remote/.test(noOrigin.summary) && /::error::/.test(noOrigin.err), "origin unreachable (git ls-remote fails): exit 1 through fail(), with a job summary and an annotation, not a bare git error", `exit ${noOrigin.code} summary ${noOrigin.summary} err ${noOrigin.err}`);

  note("checkout-tip.sh: the working tree becomes the tip (fetched by sha, HEAD verified)");
  // The runner's situation, built the way actions/checkout (fetch-depth 1) builds it: an
  // empty repository, the OLDER commit A fetched by sha, checked out detached. Origin has
  // moved on to B, and B is NOT in this clone: the script's own fetch has to bring it in.
  const clone3 = path.join(tmp, "clone3");
  fs.mkdirSync(clone3);
  await git(["init", "-q"], clone3);
  await git(["remote", "add", "origin", `file://${origin}`], clone3);
  await git(["fetch", "-q", "--depth=1", "origin", shaA], clone3);
  await git(["checkout", "-q", "--detach", shaA], clone3);
  const hasB = async () => (await git(["cat-file", "-e", shaB], clone3)).code === 0;
  check((await git(["rev-parse", "HEAD"], clone3)).out.trim() === shaA && !(await hasB()), "(setup) a shallow clone at A, made like actions/checkout makes it, that does NOT have the tip B yet");
  const bogus = "f".repeat(40);
  const unreachable = await gate("checkout-tip.sh", [bogus], {}, clone3);
  check(unreachable.code === 1 && /niet gedeployed/.test(unreachable.err) && (await git(["rev-parse", "HEAD"], clone3)).out.trim() === shaA, "a commit origin does not have: exit 1, HEAD unchanged", `exit ${unreachable.code} ${unreachable.err}`);
  const short = await gate("checkout-tip.sh", [shaB.slice(0, 7)], {}, clone3);
  check(short.code === 1 && /volledige commit-sha/.test(short.err) && !(await hasB()), "an abbreviated sha is refused before anything is fetched (the gate hands over full shas only)", `exit ${short.code} ${short.err}`);
  const tip = await gate("checkout-tip.sh", [shaB], {}, clone3);
  check(tip.code === 0 && (await hasB()) && (await git(["rev-parse", "HEAD"], clone3)).out.trim() === shaB && tip.out.includes(shaB), "the tip B: fetched by sha into the shallow clone that did not have it, checked out, HEAD verified", `exit ${tip.code} ${tip.out} ${tip.err}`);
}

// ── 5. check-ci.sh against a fake GitHub API ──────────────────────────────────
type ApiHit = { path: string; auth: string; accept: string };
async function fakeApi() {
  const hits: ApiHit[] = [];
  let respond: (hit: ApiHit) => { status: number; body?: unknown; raw?: string } = () => ({ status: 200, body: { workflow_runs: [] } });
  const server = http.createServer((req, res) => {
    const hit = { path: req.url ?? "", auth: req.headers.authorization ?? "", accept: String(req.headers.accept ?? "") };
    hits.push(hit);
    const { status, body, raw } = respond(hit);
    if (raw !== undefined) {
      // not the API: a maintenance or proxy page answering with HTTP 200
      res.writeHead(status, { "content-type": "text/html" });
      res.end(raw);
      return;
    }
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits, set: (fn: typeof respond) => { respond = fn; }, close: () => server.close() };
}
async function section5_ci() {
  note("check-ci.sh: the most recent CI run of the commit decides; red, running or absent means no deploy");
  const api = await fakeApi();
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const env = { GITHUB_TOKEN: GH_TOKEN, GITHUB_REPOSITORY: "example/wasfix-pro", GITHUB_API_URL: api.url };
  const runs = (list: Array<[string, string | null]>) => ({ status: 200, body: { total_count: list.length, workflow_runs: list.map(([status, conclusion], i) => ({ id: 100 - i, status, conclusion, name: "CI", path: ".github/workflows/ci.yml" })) } });
  try {
    api.set(() => runs([["completed", "success"]]));
    const green = await gate("check-ci.sh", [sha], env);
    check(green.code === 0 && /^green=true$/m.test(green.output), "latest run completed/success: exit 0, green=true", `exit ${green.code} ${green.out} ${green.err}`);
    const hit = api.hits[0];
    check(!!hit && hit.path === `/repos/example/wasfix-pro/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=20` && hit.auth === `Bearer ${GH_TOKEN}` && /application\/vnd\.github/.test(hit.accept), "the request lists the runs of ci.yml for exactly this commit, with the token in the Authorization header", JSON.stringify(hit));
    check(leaks(green.out + green.err + green.summary).length === 0, "...and the token is not printed");

    api.set(() => runs([["completed", "failure"], ["completed", "success"]]));
    const red = await gate("check-ci.sh", [sha], env);
    check(red.code === 1 && !/green=/.test(red.output) && /niet geslaagd/.test(red.summary) && /failure/.test(red.summary), "latest run failed (an older one succeeded): exit 1, no output, the summary says CI failed (the NEWEST run decides)", `exit ${red.code} ${red.summary} ${red.err}`);
    api.set(() => runs([["completed", "success"], ["completed", "failure"]]));
    const fixed = await gate("check-ci.sh", [sha], env);
    check(fixed.code === 0 && /green=true/.test(fixed.output), "latest run succeeded after an older failure (a re-run): green", `exit ${fixed.code}`);
    api.set(() => runs([["in_progress", null]]));
    const busy = await gate("check-ci.sh", [sha], env);
    check(busy.code === 1 && /nog bezig/.test(busy.summary) && /in_progress/.test(busy.summary), "a run still in progress: exit 1, 'nog bezig' (wait; the green run deploys by itself)", `exit ${busy.code} ${busy.summary}`);
    api.set(() => runs([]));
    const none = await gate("check-ci.sh", [sha], env);
    check(none.code === 1 && /geen CI-run/.test(none.summary) && !/Push de commit/.test(none.summary) && /wacht tot de CI-run er is/.test(none.summary) && /re-run/.test(none.summary), "no run at all for the commit: exit 1, 'geen CI-run', and the hint says to wait for CI or re-run it (not 'push the commit': the job only runs for a commit that IS on main)", `exit ${none.code} ${none.summary}`);
    api.set(() => ({ status: 403, body: { message: "Resource not accessible by integration" } }));
    const forbidden = await gate("check-ci.sh", [sha], env);
    check(forbidden.code === 1 && /GitHub API/.test(forbidden.summary) && /actions: read/.test(forbidden.summary) && leaks(forbidden.out + forbidden.err).length === 0, "API 403: exit 1, the summary points at the permission, the token stays out of the log", `exit ${forbidden.code} ${forbidden.summary} ${forbidden.err}`);
    const noToken = await gate("check-ci.sh", [sha], { ...env, GITHUB_TOKEN: undefined });
    check(noToken.code !== 0 && !/green=/.test(noToken.output), "without GITHUB_TOKEN: a failure, never green", `exit ${noToken.code}`);
    const MAINTENANCE = "<html><body><h1>Maintenance</h1></body></html>";
    api.set(() => ({ status: 200, raw: MAINTENANCE }));
    const html = await gate("check-ci.sh", [sha], env);
    check(html.code === 1 && !/green=/.test(html.output) && /geen geldig JSON/.test(html.summary) && /::error::/.test(html.err) && !/SyntaxError|node:internal/.test(html.err), "an HTTP 200 answer that is not JSON (maintenance or proxy page): exit 1 through fail(), with a summary and an annotation and no node stack trace; never green", `exit ${html.code} output ${html.output} summary ${html.summary} err ${html.err}`);
    api.set(() => ({ status: 200, body: null }));
    const nul = await gate("check-ci.sh", [sha], env);
    check(nul.code === 1 && !/green=/.test(nul.output) && /geen geldig JSON/.test(nul.summary), "a JSON body that is not an object (null): the same, through fail()", `exit ${nul.code} summary ${nul.summary} err ${nul.err}`);
    api.set(() => ({ status: 200, body: {} }));
    const emptyObj = await gate("check-ci.sh", [sha], env);
    check(emptyObj.code === 1 && !/green=/.test(emptyObj.output) && /geen geldig JSON/.test(emptyObj.summary) && !/geen CI-run/.test(emptyObj.summary), "a JSON object WITHOUT the workflow_runs array ({}, or {message: ...} with HTTP 200): invalid, through fail(), and never read as 'there is no CI run' (the API did not say that)", `exit ${emptyObj.code} summary ${emptyObj.summary} err ${emptyObj.err}`);

    note("check-ci.sh with STALE_RUN=true (the sha is the tip of main, standing in for this run's older commit): not green = step aside, not a red job");
    const staleEnv = { ...env, STALE_RUN: "true" };
    api.set(() => runs([["completed", "success"]]));
    const staleGreen = await gate("check-ci.sh", [sha], staleEnv);
    check(staleGreen.code === 0 && /^green=true$/m.test(staleGreen.output) && /top van main/.test(staleGreen.out), "the tip's CI succeeded: green=true, the log says this run deploys the tip", `exit ${staleGreen.code} ${staleGreen.out}`);
    api.set(() => runs([["completed", "failure"]]));
    const staleRed = await gate("check-ci.sh", [sha], staleEnv);
    check(staleRed.code === 0 && /^green=false$/m.test(staleRed.output) && /overgeslagen/.test(staleRed.summary) && /niet geslaagd/.test(staleRed.summary) && /Herstel CI eerst/.test(staleRed.summary) && /ook niet met de hand/.test(staleRed.summary) && /eerstvolgende groene CI-run/.test(staleRed.summary) && /geannuleerd/.test(staleRed.summary) && /met de hand \(Run workflow\)/.test(staleRed.summary) && !/::error::/.test(staleRed.err), "the tip's CI failed: exit 0, green=false; the summary says the run stood in for an older commit, to fix CI first (a red tip never deploys itself, nor by hand), that the next green CI run deploys, and to dispatch by hand only if that deploy run was cancelled", `exit ${staleRed.code} output ${staleRed.output} summary ${staleRed.summary} err ${staleRed.err}`);
    api.set(() => runs([["in_progress", null]]));
    const staleBusy = await gate("check-ci.sh", [sha], staleEnv);
    check(staleBusy.code === 0 && /^green=false$/m.test(staleBusy.output) && /nog bezig/.test(staleBusy.summary) && /Wacht tot CI klaar is/.test(staleBusy.summary) && !/Herstel CI/.test(staleBusy.summary), "the tip's CI still running: exit 0, green=false, 'nog bezig', wait (not 'fix CI')", `exit ${staleBusy.code} ${staleBusy.summary}`);
    api.set(() => runs([]));
    const staleNone = await gate("check-ci.sh", [sha], staleEnv);
    check(staleNone.code === 0 && /^green=false$/m.test(staleNone.output) && /geen CI-run/.test(staleNone.summary) && !/Push de commit/.test(staleNone.summary), "no CI run for the tip yet: exit 0, green=false (and not the 'push the commit' hint: the tip IS on main)", `exit ${staleNone.code} ${staleNone.summary}`);
    api.set(() => ({ status: 403, body: { message: "Resource not accessible by integration" } }));
    const staleForbidden = await gate("check-ci.sh", [sha], staleEnv);
    check(staleForbidden.code === 1 && !/green=/.test(staleForbidden.output), "an API failure is a failure even for a stand-in run (no answer, no deploy, the owner must see it)", `exit ${staleForbidden.code} ${staleForbidden.output}`);
    api.set(() => ({ status: 200, raw: MAINTENANCE }));
    const staleHtml = await gate("check-ci.sh", [sha], staleEnv);
    check(staleHtml.code === 1 && !/green=/.test(staleHtml.output) && /geen geldig JSON/.test(staleHtml.summary), "...and so is a non-JSON answer (never green=false, which would read as 'the tip is red')", `exit ${staleHtml.code} ${staleHtml.output} ${staleHtml.summary}`);
    api.set(() => ({ status: 200, body: {} }));
    const staleEmptyObj = await gate("check-ci.sh", [sha], staleEnv);
    check(staleEmptyObj.code === 1 && !/green=/.test(staleEmptyObj.output) && /geen geldig JSON/.test(staleEmptyObj.summary), "...and a JSON object without workflow_runs ({}): exit 1, never green=false (an undocumented 200 body must not make the stand-in step aside as 'no CI run for the tip')", `exit ${staleEmptyObj.code} ${staleEmptyObj.output} ${staleEmptyObj.summary}`);
    api.set(() => runs([["completed", "failure"]]));
    const notStale = await gate("check-ci.sh", [sha], { ...env, STALE_RUN: "false" });
    check(notStale.code === 1 && !/green=/.test(notStale.output), "STALE_RUN=false behaves like the default: red = exit 1", `exit ${notStale.code}`);
  } finally {
    api.close();
  }
}

// ── 6. the pipeline, with the fakes ───────────────────────────────────────────
const ORDER = ["pull", "migrate", "preflight", "build", "deploy", "preflight-url"];
async function section6_pipeline() {
  note("run.sh with a fake vercel and a fake npm: the order, the gates, the URL, the cleanup, the silence");
  const ok = await pipeline();
  check(ok.code === 0, "a good environment deploys: exit 0", describe(ok));
  check(JSON.stringify(ok.calls) === JSON.stringify(ORDER), `the exact order: ${ORDER.join(" -> ")}`, JSON.stringify(ok.calls));
  check(ok.log[0] === `vercel pull --yes --environment=production --token=${TOKEN}`, "vercel pull --yes --environment=production --token=<VERCEL_TOKEN>", ok.log[0]);
  check(ok.log[1] === "npm run db:migrate:deploy", "npm run db:migrate:deploy (scripts/migrate.ts, DIRECT_URL aware)", ok.log[1]);
  check(ok.log[2] === "npm run preflight -- --env-file .vercel/.env.production.local", "npm run preflight -- --env-file .vercel/.env.production.local (offline, before the build)", ok.log[2]);
  check(ok.log[3] === `vercel build --prod --token=${TOKEN}`, "vercel build --prod --token=<VERCEL_TOKEN>", ok.log[3]);
  check(ok.log[4] === `vercel deploy --prebuilt --prod --token=${TOKEN}`, "vercel deploy --prebuilt --prod --token=<VERCEL_TOKEN>", ok.log[4]);
  check(ok.log[5] === `npm run preflight -- --env-file .vercel/.env.production.local --url ${SITE}`, "npm run preflight -- --env-file ... --url <NEXT_PUBLIC_APP_URL> (the live site, after the deploy)", ok.log[5]);
  check(new RegExp(`^url=${DEPLOY_URL.replace(/[.]/g, "\\.")}$`, "m").test(ok.output), "the deployment URL from the CLI's stdout is the step output `url`", ok.output);
  check(ok.summary.includes(DEPLOY_URL) && /geslaagd/.test(ok.summary) && ok.summary.includes(SITE), "the job summary names the deployment URL and the probed site", ok.summary);
  check(ok.seen === `DATABASE_URL=${DATABASE_URL}\nDIRECT_URL=${DIRECT_URL}\n`, "the migration process received DATABASE_URL and DIRECT_URL from the pulled file (and nothing was sourced)", ok.seen);
  check(!ok.vercelLeft, ".vercel/ is removed after a successful run");
  check(leaks(ok.out + ok.err + ok.summary + ok.output).length === 0, "nothing the pipeline printed contains a secret value (token, ids, passwords, keys)", `leaked: ${leaks(ok.out + ok.err + ok.summary + ok.output).join(", ")}`);
  check((ok.out.match(/::group::/g) ?? []).length === 6 && (ok.out.match(/::endgroup::/g) ?? []).length === 6, "six log groups, each closed");

  const noDb = await pipeline({ envFile: envFileText({ DATABASE_URL: null }) });
  check(noDb.code !== 0 && JSON.stringify(noDb.calls) === JSON.stringify(["pull"]), "Production environment without DATABASE_URL: stop right after pull (no migrate, no preflight, no build, no deploy)", describe(noDb));
  check(/DATABASE_URL ontbreekt/.test(noDb.err) && /::error::DATABASE_URL/.test(noDb.err) && /niets gebouwd of gedeployed/i.test(noDb.summary) && /NIETS gedeployed/.test(noDb.summary), "...the error names DATABASE_URL and says nothing was deployed", noDb.err + noDb.summary);
  check(!noDb.vercelLeft, "...and .vercel/ is removed on that failure");

  const notReady = await pipeline({ fake: { FAKE_PREFLIGHT_EXIT: "1" } });
  check(notReady.code === 1 && JSON.stringify(notReady.calls) === JSON.stringify(["pull", "migrate", "preflight"]), "preflight NOT READY (exit 1): stop before the build; nothing is built or deployed", describe(notReady));
  check(/NIET KLAAR/.test(notReady.out) && /NIETS gedeployed/.test(notReady.summary) && /3\/6 preflight/.test(notReady.summary), "...the report is in the log and the summary says which step stopped it", notReady.summary);
  check(!notReady.vercelLeft && leaks(notReady.out + notReady.err).length === 0, "...cleanup and silence on that failure too");

  const migrateFail = await pipeline({ fake: { FAKE_MIGRATE_EXIT: "3" } });
  check(migrateFail.code === 3 && JSON.stringify(migrateFail.calls) === JSON.stringify(["pull", "migrate"]) && !migrateFail.vercelLeft, "a failing migration: stop, exit code passed on, no preflight/build/deploy, cleanup", describe(migrateFail));

  const buildFail = await pipeline({ fake: { FAKE_BUILD_EXIT: "2" } });
  check(buildFail.code === 2 && JSON.stringify(buildFail.calls) === JSON.stringify(["pull", "migrate", "preflight", "build"]) && !buildFail.vercelLeft && /NIETS gedeployed/.test(buildFail.summary), "a failing build: nothing deployed, the summary says so", describe(buildFail));

  const pullFail = await pipeline({ fake: { FAKE_PULL_EXIT: "1" } });
  check(pullFail.code === 1 && JSON.stringify(pullFail.calls) === JSON.stringify(["pull"]) && !pullFail.vercelLeft, "a failing pull: stop at once", describe(pullFail));
  const noFile = await pipeline({ fake: { FAKE_PULL_NO_FILE: "1" } });
  check(noFile.code === 1 && JSON.stringify(noFile.calls) === JSON.stringify(["pull"]) && /niet geschreven/.test(noFile.err) && /VERCEL_PROJECT_ID/.test(noFile.err), "pull that leaves no variables file: stop, pointing at the org/project ids", describe(noFile));

  const noUrl = await pipeline({ fake: { FAKE_DEPLOY_NO_URL: "1" } });
  check(noUrl.code === 1 && JSON.stringify(noUrl.calls) === JSON.stringify(["pull", "migrate", "preflight", "build", "deploy"]) && /geen deployment-URL/.test(noUrl.err) && !/^url=/m.test(noUrl.output), "vercel deploy without a URL on stdout: the job fails and says the outcome is unknown; no url output, no probe", describe(noUrl));
  const unknownState = (s: string) => /ONBEKEND/.test(s) && /dashboard/.test(s) && /5\/6 vercel deploy/.test(s) && !/NIETS gedeployed/.test(s) && !/WEL gedaan/.test(s);
  check(unknownState(noUrl.summary), "...the whole summary says the outcome is UNKNOWN and to check the dashboard; it does NOT also claim nothing was deployed", noUrl.summary);
  const deployFail = await pipeline({ fake: { FAKE_DEPLOY_EXIT: "1" } });
  check(deployFail.code === 1 && deployFail.calls[deployFail.calls.length - 1] === "deploy" && !deployFail.vercelLeft, "a failing deploy: no probe, cleanup", describe(deployFail));
  check(unknownState(deployFail.summary), "...a non-zero exit of vercel deploy (timeout, network error while it waits) is the same UNKNOWN state, never 'nothing deployed'", deployFail.summary);

  const probeFail = await pipeline({ fake: { FAKE_PREFLIGHT_URL_EXIT: "1" } });
  check(probeFail.code === 1 && JSON.stringify(probeFail.calls) === JSON.stringify(ORDER), "live probe NOT READY after the deploy: the job FAILS although the deploy happened (all six steps ran)", describe(probeFail));
  check(/WEL gedaan/.test(probeFail.summary) && probeFail.summary.includes(DEPLOY_URL) && /vorige deployment/.test(probeFail.summary) && new RegExp(`^url=${DEPLOY_URL.replace(/[.]/g, "\\.")}$`, "m").test(probeFail.output), "...the summary says so honestly, with the URL and the two ways out (redeploy, or promote the previous deployment)", probeFail.summary);
  check(!probeFail.vercelLeft && leaks(probeFail.out + probeFail.err + probeFail.summary).length === 0, "...cleanup and silence after that failure");

  const noSite = await pipeline({ envFile: envFileText({ NEXT_PUBLIC_APP_URL: null }) });
  check(noSite.code === 0 && noSite.log[5] === `npm run preflight -- --env-file .vercel/.env.production.local --url ${DEPLOY_URL}`, "no NEXT_PUBLIC_APP_URL in the environment (the real preflight would have blocked before this): the deployment URL is probed instead", describe(noSite));
  const noDirect = await pipeline({ envFile: envFileText({ DIRECT_URL: null }) });
  check(noDirect.code === 0 && noDirect.seen === `DATABASE_URL=${DATABASE_URL}\nDIRECT_URL=\n` && /DIRECT_URL staat niet/.test(noDirect.out), "no DIRECT_URL: the migration runs over DATABASE_URL with a warning that names DIRECT_URL", describe(noDirect) + noDirect.seen);

  const noSecrets = await pipeline({ secrets: { VERCEL_ORG_ID: undefined } });
  check(noSecrets.code !== 0 && noSecrets.calls.length === 0 && /VERCEL_ORG_ID/.test(noSecrets.err) && leaks(noSecrets.err).length === 0, "run.sh without VERCEL_ORG_ID: refuses before calling vercel at all (the workflow gate normally prevents this)", describe(noSecrets));
}

// ── 7. the real preflight through preflight-gate.sh ───────────────────────────
function iban(bank: string, account: string): string {
  const rearranged = `${bank}${account}NL00`;
  let digits = "";
  for (const ch of rearranged) digits += /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
  let r = 0;
  for (const d of digits) r = (r * 10 + Number(d)) % 97;
  return `NL${String(98 - r).padStart(2, "0")}${bank}${account}`;
}
const b64 = (host: string) => Buffer.from(`${host}$`).toString("base64").replace(/=+$/, "");
/** The READY environment of scripts/qa-preflight.ts, with recognisable secret values. */
const READY_ENV: Record<string, string> = {
  NEXT_PUBLIC_APP_URL: SITE,
  DATABASE_URL, DIRECT_URL,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_live_${b64("clerk.shop.example.nl")}`,
  CLERK_SECRET_KEY: ["sk", "live", "a".repeat(24)].join("_"),
  CLERK_WEBHOOK_SECRET: `whsec_${"g".repeat(16)}`,
  ADMIN_EMAILS: "owner@shop.example.nl",
  STRIPE_SECRET_KEY: STRIPE_KEY,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: `pk_live_${"b".repeat(16)}`,
  STRIPE_WEBHOOK_SECRET: `whsec_${"h".repeat(16)}`,
  STRIPE_PRICE_PARTICULIER: "price_1", STRIPE_PRICE_MONTEUR: "price_2", STRIPE_PRICE_BEDRIJF: "price_3",
  RESEND_API_KEY: RESEND,
  RESEND_FROM_EMAIL: "Shop <noreply@shop.example.nl>",
  SLACK_WEBHOOK_URL: `https://hooks.slack.test/services/T/B/${"i".repeat(24)}`,
  GEMINI_API_KEY: ["AIza", "SyD" + "D".repeat(32)].join(""),
  CRON_SECRET: CRON,
  UPSTASH_REDIS_REST_URL: "https://eu1-x.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: `tok_${"j".repeat(24)}`,
  COMPANY_NAME: "Shop Example B.V.", COMPANY_STREET: "Voorbeeldstraat 12", COMPANY_POSTAL_CODE: "1017 AB", COMPANY_CITY: "Amsterdam",
  COMPANY_KVK: "12345679", COMPANY_VAT: "NL001234567B01", COMPANY_IBAN: iban("RABO", "0123456789"), COMPANY_EMAIL: "info@shop.example.nl",
};
const REAL_SECRETS = ["CLERK_SECRET_KEY", "CLERK_WEBHOOK_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY", "SLACK_WEBHOOK_URL", "GEMINI_API_KEY", "CRON_SECRET", "UPSTASH_REDIS_REST_TOKEN"].map((k) => READY_ENV[k]).concat([DB_PW, DIRECT_PW]);

async function section7_realPreflight() {
  note("preflight-gate.sh with the REAL scripts/preflight.ts (offline): exit codes pass through, no secret value in the report");
  const write = (vars: Record<string, string>) => { const f = path.join(tmp, `real-${++seq}.env`); fs.writeFileSync(f, `# Created by Vercel CLI\n${Object.entries(vars).map(([k, v]) => `${k}="${v}"`).join("\n")}\n`); return f; };
  const realEnv = { PATH: realPath, HOME: process.env.HOME ?? tmp };
  const [ready, notReady, missing] = await Promise.all([
    run("bash", [path.join(DEPLOY, "preflight-gate.sh"), write(READY_ENV)], { cwd: ROOT, env: realEnv }),
    run("bash", [path.join(DEPLOY, "preflight-gate.sh"), write({ NEXT_PUBLIC_APP_URL: SITE, DATABASE_URL })], { cwd: ROOT, env: realEnv }),
    run("bash", [path.join(DEPLOY, "preflight-gate.sh"), path.join(tmp, "does-not-exist.env")], { cwd: ROOT, env: realEnv }),
  ]);
  check(ready.code === 0 && /UITSLAG: KLAAR/.test(ready.out), "a READY environment passes the gate (exit 0)", `exit ${ready.code} ${ready.out.slice(-400)} ${ready.err.slice(-300)}`);
  const seen = REAL_SECRETS.filter((v) => (ready.out + ready.err).includes(v));
  check(seen.length === 0 && ready.out.length > 500, "the real report (hosts, addresses, verdicts) contains none of the 11 secret values in the file", `found in the report: ${seen.join(", ")}`);
  check(/aws-0-eu-central-1\.pooler\.supabase\.com:6543\/postgres/.test(ready.out) && /clerk\.shop\.example\.nl/.test(ready.out), "...while it does name the database host and the Clerk host (so the owner can recognise the environment)");
  check(notReady.code === 1 && /UITSLAG: NIET KLAAR/.test(notReady.out) && /VOLGENDE STAP/.test(notReady.out), "a NOT READY environment fails the gate with exit 1 and the report (next step included) in the log", `exit ${notReady.code} ${notReady.out.slice(-300)}`);
  check(missing.code === 1 && /ontbreekt/.test(missing.err) && !/UITSLAG/.test(missing.out), "a missing variables file: exit 1 before preflight runs", `exit ${missing.code} ${missing.err}`);
}

// ── 8. the premise of migrate.sh: every migration is additive ─────────────────
/**
 * What "additive" means here: the code that is live while the migration runs keeps
 * working on the migrated schema. So a migration may not
 *   - drop, rename, retype or truncate anything, or delete rows;
 *   - add a NOT NULL column without a DEFAULT to an existing table (the live code's
 *     INSERTs do not supply it), or make an existing column NOT NULL;
 *   - put a unique index or a constraint (UNIQUE, PRIMARY KEY, FOREIGN KEY, CHECK)
 *     on columns the live code already writes.
 * A unique index or constraint on a table or column created in the SAME migration is
 * fine: the live code never writes it. NOT covered (a human reads the SQL): dropping
 * a DEFAULT, removing enum values, index locks on very large tables.
 */
// Postgres makes the COLUMN keyword optional (`ADD "x" INTEGER`, `ALTER "x" TYPE TEXT`) and a
// constraint name optional (`ADD UNIQUE ("email")`, `ADD PRIMARY KEY (...)`), and a table may be
// schema-qualified (`public."Order"`); the scanner reads every spelling the docs' rule covers.
const DESTRUCTIVE = /\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|TYPE|SEQUENCE|VIEW)\b|\bRENAME\b|\bALTER\s+(?:COLUMN\s+)?"?\w+"?\s+(?:SET\s+DATA\s+)?TYPE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i;
const unquote = (s: string) => s.trim().replace(/^"|"$/g, "");
/** An optionally schema-qualified, optionally quoted table name; the table part is the capture group. */
const NAME = '(?:"?\\w+"?\\.)?("?\\w+"?)';
/** After `ADD`, these words start a table constraint, not a column (a quoted name is always a column). */
const CONSTRAINT_WORDS = /^(CONSTRAINT|UNIQUE|PRIMARY|FOREIGN|CHECK|EXCLUDE)$/i;
/** Split on `sep` outside parentheses (a column type like DECIMAL(10,2) holds a comma). */
function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === sep && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  return parts;
}
/** An ALTER TABLE statement: its table and its actions (the comma-separated clauses after the table name). */
function alterTable(s: string): { table: string; clauses: string[] } | null {
  const m = new RegExp(`^ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:IF\\s+EXISTS\\s+)?${NAME}\\s*`, "i").exec(s);
  if (!m) return null;
  return { table: unquote(m[1]), clauses: splitTopLevel(s.slice(m[0].length), ",").map((c) => c.trim()).filter(Boolean) };
}
/** `ADD [COLUMN] [IF NOT EXISTS] name rest`: the column and what follows it; null for a constraint (`ADD CONSTRAINT ...`, `ADD UNIQUE (...)`, `ADD PRIMARY KEY ...`) or any other action. */
function addedColumn(clause: string): { name: string; rest: string } | null {
  const m = /^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?("?\w+"?)([\s\S]*)$/i.exec(clause);
  if (!m || (!m[1].startsWith('"') && CONSTRAINT_WORDS.test(m[1]))) return null;
  return { name: unquote(m[1]), rest: m[2] };
}
function scanMigration(sql: string): string[] {
  const stmts = splitTopLevel(sql.replace(/--[^\n]*/g, ""), ";").map((s) => s.trim()).filter(Boolean);
  const newTables = new Set<string>();
  const newCols = new Map<string, Set<string>>();
  for (const s of stmts) {
    const ct = new RegExp(`^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${NAME}`, "i").exec(s);
    if (ct) newTables.add(unquote(ct[1]));
    const at = alterTable(s);
    if (at) for (const clause of at.clauses) {
      const add = addedColumn(clause);
      if (!add) continue;
      if (!newCols.has(at.table)) newCols.set(at.table, new Set());
      newCols.get(at.table)!.add(add.name);
    }
  }
  const colsNew = (t: string, cols: string[]) => cols.length > 0 && cols.every((c) => newCols.get(t)?.has(c));
  const colList = (inner: string) => splitTopLevel(inner, ",").map(unquote).filter(Boolean);
  const offenders: string[] = [];
  for (const s of stmts) {
    const d = DESTRUCTIVE.exec(s);
    if (d) { offenders.push(d[0]); continue; }
    const at = alterTable(s);
    if (at && !newTables.has(at.table)) {
      const { table } = at;
      for (const clause of at.clauses) {
        const add = addedColumn(clause);
        if (add) {
          // A new column may carry an inline UNIQUE, CHECK or REFERENCES (the live code never writes it); only NOT NULL without a DEFAULT matters.
          if (/\bNOT\s+NULL\b/i.test(add.rest) && !/\bDEFAULT\b/i.test(add.rest)) offenders.push(`ADD COLUMN ${add.name} NOT NULL without DEFAULT on existing table ${table}`);
          continue;
        }
        const setNotNull = /^ALTER\s+(?:COLUMN\s+)?("?\w+"?)\s+SET\s+NOT\s+NULL\b/i.exec(clause);
        if (setNotNull) offenders.push(`SET NOT NULL on existing ${table}.${unquote(setNotNull[1])}`);
        const con = /^ADD\s+(?:CONSTRAINT\s+"?\w+"?\s+)?(UNIQUE|PRIMARY\s+KEY|FOREIGN\s+KEY|CHECK|EXCLUDE)\b\s*(?:\(([^)]*)\))?/i.exec(clause);
        if (con) {
          const kind = con[1].toUpperCase().replace(/\s+/g, " ");
          const cols = kind === "CHECK" || kind === "EXCLUDE" ? [] : colList(con[2] ?? "");
          if (!colsNew(table, cols)) offenders.push(`ADD CONSTRAINT ${kind} on existing column(s) of ${table}`);
        }
      }
    }
    const ui = new RegExp(`^CREATE\\s+UNIQUE\\s+INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?"?\\w+"?\\s+ON\\s+(?:ONLY\\s+)?${NAME}\\s*(?:USING\\s+\\w+\\s*)?\\(([^)]*)\\)`, "i").exec(s);
    if (ui) {
      const table = unquote(ui[1]);
      if (!newTables.has(table) && !colsNew(table, colList(ui[2]))) offenders.push(`CREATE UNIQUE INDEX on existing column(s) of ${table}`);
    }
  }
  return offenders;
}
function section8_migrations() {
  note("the additive-migration scanner itself, on SQL samples (what the premise of migrate.sh exactly covers)");
  const sample = (name: string, sql: string, expectOffence: RegExp | null) => {
    const got = scanMigration(sql);
    if (expectOffence) check(got.length > 0 && got.some((o) => expectOffence.test(o)), `flagged: ${name}`, `offenders: ${JSON.stringify(got)}`);
    else check(got.length === 0, `allowed: ${name}`, `offenders: ${JSON.stringify(got)}`);
  };
  sample("ADD COLUMN ... NOT NULL without DEFAULT on an existing table", 'ALTER TABLE "Order" ADD COLUMN "x" INTEGER NOT NULL;', /NOT NULL without DEFAULT/);
  sample("the same, hidden behind a type with a comma (DECIMAL(10,2))", 'ALTER TABLE "Order" ADD COLUMN "a" TEXT,\nADD COLUMN "x" DECIMAL(10,2) NOT NULL;', /NOT NULL without DEFAULT/);
  sample("ADD COLUMN ... NOT NULL DEFAULT 0 (the live code's INSERTs get the default)", 'ALTER TABLE "Order" ADD COLUMN "x" INTEGER NOT NULL DEFAULT 0,\nADD COLUMN "y" TEXT;', null);
  sample("ADD COLUMN NOT NULL on a table created in the same migration", 'CREATE TABLE "New" ("id" TEXT NOT NULL);\nALTER TABLE "New" ADD COLUMN "x" INTEGER NOT NULL;', null);
  sample("ALTER COLUMN ... SET NOT NULL on an existing column", 'ALTER TABLE "Order" ALTER COLUMN "phone" SET NOT NULL;', /SET NOT NULL/);
  sample("ALTER COLUMN ... DROP NOT NULL (relaxing is additive)", 'ALTER TABLE "Order" ALTER COLUMN "phone" DROP NOT NULL;', null);
  sample("CREATE UNIQUE INDEX on an existing column", 'CREATE UNIQUE INDEX "Order_email_key" ON "Order"("email");', /UNIQUE INDEX on existing/);
  sample("CREATE UNIQUE INDEX on a column added in the same migration (the live code never writes it)", 'ALTER TABLE "Order" ADD COLUMN "accessToken" TEXT;\nCREATE UNIQUE INDEX "Order_accessToken_key" ON "Order"("accessToken");', null);
  sample("CREATE UNIQUE INDEX on one new and one existing column", 'ALTER TABLE "Order" ADD COLUMN "tok" TEXT;\nCREATE UNIQUE INDEX "i" ON "Order"("tok", "email");', /UNIQUE INDEX on existing/);
  sample("CREATE UNIQUE INDEX on a new table", 'CREATE TABLE "CreditNote" ("id" TEXT NOT NULL, "number" TEXT NOT NULL);\nCREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number");', null);
  sample("CREATE INDEX (non-unique) on an existing column", 'CREATE INDEX "Order_status_idx" ON "Order"("status", "createdAt");', null);
  sample("FOREIGN KEY on an existing column", 'ALTER TABLE "RmaRequest" ADD CONSTRAINT "fk" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;', /CONSTRAINT FOREIGN KEY on existing/);
  sample("FOREIGN KEY on a column added in the same migration (as 20261008100000 does)", 'ALTER TABLE "RmaRequest" ADD COLUMN "linkedOrderId" TEXT;\nALTER TABLE "RmaRequest" ADD CONSTRAINT "fk" FOREIGN KEY ("linkedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;', null);
  sample("CHECK constraint on an existing table", 'ALTER TABLE "Order" ADD CONSTRAINT "c" CHECK ("totalEur" >= 0);', /CONSTRAINT CHECK on existing/);
  sample("UNIQUE constraint on existing columns", 'ALTER TABLE "User" ADD CONSTRAINT "u" UNIQUE ("email", "clerkId");', /CONSTRAINT UNIQUE on existing/);
  sample("DROP INDEX (a unique index the live code upserts on)", 'DROP INDEX "Invoice_number_key";', /DROP INDEX/);
  sample("DROP CONSTRAINT", 'ALTER TABLE "Order" DROP CONSTRAINT "Order_userId_fkey";', /DROP CONSTRAINT/);
  sample("DROP COLUMN, RENAME, retype, TRUNCATE, DELETE", 'ALTER TABLE "A" DROP COLUMN "x";\nALTER TABLE "A" RENAME COLUMN "y" TO "z";\nALTER TABLE "A" ALTER COLUMN "n" TYPE TEXT;\nTRUNCATE "B";\nDELETE FROM "C";', /DROP COLUMN|RENAME|TYPE|TRUNCATE|DELETE FROM/);
  sample("a backfill UPDATE, an enum value, a comment that mentions DROP TABLE", "-- this comment says DROP TABLE and is ignored\nUPDATE \"MonteurInvoice\" SET \"subtotal\" = 0 WHERE \"subtotal\" IS NULL;\nALTER TYPE \"Status\" ADD VALUE 'NEW';", null);
  note("...the spellings Postgres also accepts: ADD without COLUMN, ALTER without COLUMN, unnamed constraints, schema-qualified tables");
  sample("ADD \"x\" ... NOT NULL without DEFAULT (no COLUMN keyword)", 'ALTER TABLE "Order" ADD "x" INTEGER NOT NULL;', /NOT NULL without DEFAULT/);
  sample("ADD IF NOT EXISTS \"x\" ... NOT NULL without DEFAULT (the column name, not IF, is what is read)", 'ALTER TABLE "Order" ADD IF NOT EXISTS "x" INTEGER NOT NULL;', /ADD COLUMN x NOT NULL without DEFAULT/);
  sample("ADD COLUMN IF NOT EXISTS: the column counts as new, so a unique index on it is allowed", 'ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "tok" TEXT;\nCREATE UNIQUE INDEX "i" ON "Order"("tok");', null);
  sample("ALTER \"phone\" SET NOT NULL (no COLUMN keyword)", 'ALTER TABLE "Order" ALTER "phone" SET NOT NULL;', /SET NOT NULL/);
  sample("ALTER \"n\" TYPE TEXT (a retype without the COLUMN keyword)", 'ALTER TABLE "Order" ALTER "n" TYPE TEXT;', /TYPE/);
  sample("ALTER COLUMN ... SET DEFAULT 'TYPE' (a literal, not a retype)", "ALTER TABLE \"Order\" ALTER COLUMN \"kind\" SET DEFAULT 'TYPE';", null);
  sample("ADD UNIQUE (...) without a constraint name, on an existing column", 'ALTER TABLE "Order" ADD UNIQUE ("email");', /CONSTRAINT UNIQUE on existing/);
  sample("ADD PRIMARY KEY (...) without a name", 'ALTER TABLE "Order" ADD PRIMARY KEY ("id");', /CONSTRAINT PRIMARY KEY on existing/);
  sample("ADD FOREIGN KEY (...) without a name, on an existing column", 'ALTER TABLE "RmaRequest" ADD FOREIGN KEY ("orderId") REFERENCES "Order"("id");', /CONSTRAINT FOREIGN KEY on existing/);
  sample("ADD CHECK (...) without a name", 'ALTER TABLE "Order" ADD CHECK ("totalEur" >= 0);', /CONSTRAINT CHECK on existing/);
  sample("ADD \"linkedOrderId\" (no COLUMN keyword) and an unnamed FOREIGN KEY on it in the same migration", 'ALTER TABLE "RmaRequest" ADD "linkedOrderId" TEXT;\nALTER TABLE "RmaRequest" ADD FOREIGN KEY ("linkedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL;', null);
  sample("inline UNIQUE / CHECK / REFERENCES on columns added to an existing table (not a table constraint)", 'ALTER TABLE "Order" ADD COLUMN "x" INTEGER CHECK ("x" >= 0),\nADD "y" TEXT UNIQUE,\nADD COLUMN "z" TEXT REFERENCES "User"("id");', null);
  sample("schema-qualified: a new table public.\"New\" does not exempt public.\"Order\"", 'CREATE TABLE public."New" ("id" TEXT NOT NULL);\nALTER TABLE public."Order" ADD COLUMN "x" INTEGER NOT NULL;', /NOT NULL without DEFAULT on existing table Order/);
  sample("schema-qualified: a unique index on the new table public.\"New\"", 'CREATE TABLE public."New" ("id" TEXT NOT NULL);\nCREATE UNIQUE INDEX "New_id_key" ON public."New"("id");', null);

  note("prisma/migrations: additive only (the premise of migrating BEFORE the new code is live, see migrate.sh)");
  const dir = path.join(ROOT, "prisma", "migrations");
  const folders = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const offenders: string[] = [];
  for (const f of folders) for (const o of scanMigration(fs.readFileSync(path.join(dir, f, "migration.sql"), "utf8"))) offenders.push(`${f}: ${o}`);
  check(folders.length >= 4 && offenders.length === 0, `all ${folders.length} migrations pass the scanner (no drop/rename/retype/truncate/delete, no NOT NULL without DEFAULT or SET NOT NULL on an existing table, no unique index or constraint on columns the live code already writes)`, offenders.join(" | "));
}

// ── 9. wiring: CI runs this suite, git ignores .vercel/ ───────────────────────
async function section9_wiring() {
  note("wiring");
  const ci = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  check(/npx tsx scripts\/qa-deploy\.ts\s+\|\|\s+status=1/.test(ci) && ci.indexOf("scripts/qa-deploy.ts") > ci.indexOf("Offline QA suites"), "ci.yml runs scripts/qa-deploy.ts in the offline-suites step (no database needed)");
  check(/^\s*echo "::group::deploy"; npx tsx scripts\/qa-deploy\.ts \|\| status=1; echo "::endgroup::"/m.test(ci), "...inside a named log group, like the suites that go through suite()");
  const paths = [".vercel/.env.production.local", ".vercel/project.json", ".vercel/output/x"];
  const ignored = await run("git", ["check-ignore", ...paths], { cwd: ROOT, env: baseEnv() });
  check(ignored.code === 0 && paths.every((p) => ignored.out.split("\n").includes(p)), ".gitignore ignores .vercel/ (the pulled variables and the build output can never be committed by accident)", `git check-ignore exit ${ignored.code}: ${ignored.out} ${ignored.err}`);
}

async function main() {
  section1_static();
  await section2_envValue();
  await section3_secrets();
  await section4_ref();
  await section5_ci();
  await section6_pipeline();
  await section7_realPreflight();
  section8_migrations();
  await section9_wiring();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(finish());
}

void main();
