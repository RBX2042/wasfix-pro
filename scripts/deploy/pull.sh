#!/usr/bin/env bash
# Pipeline step 1 of 6: link the Vercel project without a prompt (VERCEL_ORG_ID
# and VERCEL_PROJECT_ID in the environment do that, per the Vercel CLI
# documentation for CI) and download the Production settings and variables into
# .vercel/. Afterwards .vercel/.env.production.local holds every Production
# variable, which migrate.sh and preflight-gate.sh read and `vercel build --prod`
# uses. The file is never printed; run.sh removes the directory on exit.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

: "${VERCEL_TOKEN:?VERCEL_TOKEN is not set}"
: "${VERCEL_ORG_ID:?VERCEL_ORG_ID is not set}"
: "${VERCEL_PROJECT_ID:?VERCEL_PROJECT_ID is not set}"

vercel pull --yes --environment=production --token="$VERCEL_TOKEN"

[ -f "$ENV_FILE" ] || fail "vercel pull heeft $ENV_FILE niet geschreven: zonder de Production-variabelen kan er niet gemigreerd, gecontroleerd of gebouwd worden. Controleer VERCEL_ORG_ID en VERCEL_PROJECT_ID (uit .vercel/project.json na 'vercel link') en de scope van VERCEL_TOKEN."
echo "Production-variabelen opgehaald: $(env_count "$ENV_FILE") variabelen in $ENV_FILE (inhoud wordt niet getoond)."
