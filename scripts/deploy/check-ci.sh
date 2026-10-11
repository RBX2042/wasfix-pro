#!/usr/bin/env bash
# Gate 3 of .github/workflows/deploy.yml: did the CI workflow succeed for exactly
# the commit that is about to be deployed? Output green=true only then.
#
#   check-ci.sh <sha>
#   needs: GITHUB_TOKEN (permissions: actions: read), GITHUB_REPOSITORY, optionally GITHUB_API_URL
#   STALE_RUN=true: <sha> is the tip of main standing in for this run's own, older
#            commit (check-ref.sh said current=false). Not green then means
#            "step aside" (exit 0, green=false): the next GREEN CI run of the tip
#            (the running one when it finishes, or the one after a fix) triggers
#            its own deploy; a red run never does, and a dispatch of a red commit
#            is refused here. Otherwise not green means exit 1.
#
# The workflow_run trigger already guarantees a green CI run for the run's own
# commit, but workflow_dispatch does not, and neither does the tip of main when
# this run stands in for an older commit; "never deploy a red main" has to hold
# for those too. One rule for all: the MOST RECENT run of .github/workflows/ci.yml
# for the commit must be completed with conclusion success. A run that is still
# in progress means "not yet", a failed one means "no", no run at all means "no"
# (wait for CI, or re-run it; the commit is on main already). The token goes into a request
# header only. An API failure is always a failure (exit 1): without an answer
# nothing can be deployed, and the owner must see why.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

sha="${1:?usage: check-ci.sh <sha>}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN is not set (the workflow passes secrets.GITHUB_TOKEN)}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"
api="${GITHUB_API_URL:-https://api.github.com}"

body=$(curl -fsS \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "$api/repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs?head_sha=$sha&per_page=20") \
  || fail "De CI-runs van commit $sha konden niet worden opgevraagd bij de GitHub API (curl faalde; heeft de workflow 'actions: read'?). Niet gedeployed."

# The API lists runs newest first; the newest one decides. An answer that is not
# the documented JSON (an HTTP 200 maintenance or proxy page, a JSON null, an
# object without the workflow_runs array such as {} or {"message": ...}) is
# "invalid", so it ends in fail() below with a summary, not in a stack trace from
# node and never as "there is no CI run", which the API did not say.
verdict=$(printf '%s' "$body" | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    let o;
    try { o = JSON.parse(s); } catch { return console.log("invalid"); }
    if (!o || typeof o !== "object" || !Array.isArray(o.workflow_runs)) return console.log("invalid");
    const runs = o.workflow_runs;
    if (runs.length === 0) return console.log("none");
    const r = runs[0];
    console.log(r.status === "completed" ? String(r.conclusion) : `in_progress:${r.status}`);
  });
')

case "$verdict" in
  invalid)
    fail "De GitHub API gaf geen geldig JSON-antwoord op de vraag naar de CI-runs van commit $sha (onderhoudspagina of proxy?). Niet gedeployed; probeer het later opnieuw (Run workflow)."
    ;;
  success)
    if [ "${STALE_RUN:-false}" = true ]; then
      echo "CI (ci.yml) is geslaagd voor commit $sha, de huidige top van main: deze run deployt die commit."
    else
      echo "CI (ci.yml) is geslaagd voor commit $sha."
    fi
    set_output green true
    exit 0
    ;;
  none)
    reason="er is geen CI-run (ci.yml) voor commit $sha"
    # The job runs for github.sha of main only, so this commit IS on main: CI has not started for it (or was skipped).
    hint="CI heeft voor deze commit (nog) niet gedraaid: wacht tot de CI-run er is, of laat CI opnieuw lopen (re-run, of een nieuwe commit); de groene run start de deploy vanzelf."
    stale_hint="Zodra CI voor $sha op main slaagt, start die run zelf de deploy."
    ;;
  in_progress:*)
    reason="de laatste CI-run voor commit $sha is nog bezig (${verdict#in_progress:})"
    hint="Wacht tot CI klaar is; bij een geslaagde run op main start de deploy vanzelf."
    stale_hint="Wacht tot CI klaar is; slaagt hij, dan start die run zelf de deploy."
    ;;
  *)
    reason="de laatste CI-run voor commit $sha is niet geslaagd (uitslag: $verdict)"
    hint="Herstel CI eerst; een rode main wordt niet gedeployed."
    # A red run never triggers the deploy workflow, and a dispatch of a red commit is refused above (STALE_RUN=false): only a fix helps.
    stale_hint="Herstel CI eerst (een rode main wordt niet gedeployed, ook niet met de hand); de eerstvolgende groene CI-run op main start de deploy zelf."
    ;;
esac

if [ "${STALE_RUN:-false}" = true ]; then
  summary "Deploy overgeslagen: deze run stond in voor een oudere commit, en $reason. $stale_hint Staat de deploy-run van $sha daarna in Actions als geannuleerd (of ontbreekt hij), start Deploy dan met de hand (Run workflow). De live site is onveranderd."
  set_output green false
  exit 0
fi
fail "Niet gedeployed: $reason. $hint"
