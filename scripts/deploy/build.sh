#!/usr/bin/env bash
# Pipeline step 4 of 6: build the production bundle on the runner with the pulled
# project settings and Production variables (.vercel/, from pull.sh). Nothing is
# uploaded yet: a build that fails leaves the live site untouched. The output
# lands in .vercel/output, which deploy.sh uploads as-is (--prebuilt).
set -euo pipefail
. "$(dirname "$0")/lib.sh"

: "${VERCEL_TOKEN:?VERCEL_TOKEN is not set}"
[ -f "$ENV_FILE" ] || fail "$ENV_FILE ontbreekt: draai eerst pull.sh (vercel pull)."

vercel build --prod --token="$VERCEL_TOKEN"
