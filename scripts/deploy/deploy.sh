#!/usr/bin/env bash
# Pipeline step 5 of 6: upload the prebuilt output (.vercel/output) as the new
# PRODUCTION deployment and capture its URL.
#
#   deploy.sh [file-to-write-the-url-to]
#
# The Vercel CLI prints the deployment URL on stdout and its progress on stderr
# (that is the documented way to capture it in CI: url=$(vercel deploy ...)).
# Only stdout is captured here; stderr still reaches the log. The URL becomes the
# step output `url`, a line in the job summary and, when a path is given, the
# contents of that file (run.sh reads it for the final probe). No URL means the
# deploy cannot be considered done, whatever the exit code of the CLI was.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

: "${VERCEL_TOKEN:?VERCEL_TOKEN is not set}"
[ -d .vercel/output ] || fail ".vercel/output ontbreekt: draai eerst build.sh (vercel build), er is niets om te uploaden."

out=$(vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN")
url=$(printf '%s\n' "$out" | grep -E '^https://[^[:space:]]+$' | tail -n 1 || true)

[ -n "$url" ] || fail "vercel deploy gaf geen deployment-URL terug op stdout; of er iets is gedeployed is daarmee onbekend. Kijk in het Vercel-dashboard (Deployments) voordat je opnieuw deployt."

echo "Gedeployed naar productie: $url"
set_output url "$url"
summary "Productie-deployment: $url"
if [ -n "${1:-}" ]; then printf '%s\n' "$url" > "$1"; fi
