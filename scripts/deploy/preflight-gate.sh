#!/usr/bin/env bash
# Pipeline step 3 of 6 (before the build, offline) and step 6 of 6 (after the
# deploy, with --url): the go-live check, exactly as the owner runs it by hand.
#
#   preflight-gate.sh <variables-file> [--url https://...]
#
# scripts/preflight.ts exit codes: 0 = READY or READY WITH WARNINGS (a warning
# is reported, not blocking), 1 = NOT READY (at least one BLOCK; every one names
# its fix), 2 = the script itself crashed. This step passes that code on, so a
# NOT READY environment stops the pipeline before anything is built or deployed,
# with the full report in the log. The report names hosts, addresses, variable
# names and verdicts; it never prints a secret value (scripts/preflight.ts reads
# the file through --env-file and prints derived facts only; scripts/qa-deploy.ts
# runs it on a file full of recognisable fake secrets and checks that none of
# them comes out). With --url the check also probes the live site, which implies
# the network checks (--live-checks: database and migrations, Stripe, Resend,
# Clerk, Upstash, Gemini; all reads).
set -euo pipefail
. "$(dirname "$0")/lib.sh"

file="${1:?usage: preflight-gate.sh <variables-file> [--url https://...]}"
shift
[ -f "$file" ] || fail "Variabelenbestand $file ontbreekt: de preflight kan niets controleren."

npm run preflight -- --env-file "$file" "$@"
