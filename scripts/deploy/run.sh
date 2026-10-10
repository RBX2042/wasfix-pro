#!/usr/bin/env bash
# The production deploy, in the only order that is safe:
#
#   1. vercel pull            Production settings + variables into .vercel/ (pull.sh)
#   2. migrate                prisma migrate deploy over DIRECT_URL (migrate.sh)
#   3. preflight (offline)    NOT READY stops everything, nothing built yet (preflight-gate.sh)
#   4. vercel build           on the runner, with the pulled variables (build.sh)
#   5. vercel deploy          --prebuilt --prod, the URL is captured (deploy.sh)
#   6. preflight --url        the live site is probed; a failure fails the job
#                             although the deploy has already happened (preflight-gate.sh)
#
# One script rather than six workflow steps, so that the ORDER is something
# scripts/qa-deploy.ts can run and assert with a fake `vercel` and a fake `npm`.
# Each step is its own small script so the gates can be tested one at a time.
#
# Honesty about step 6: after step 5 the new code is live. A red step 6 does not
# undo that (there is no automatic rollback here); it makes the problem visible
# to the owner in the job, with the deployment URL, so they can act (fix and
# redeploy, or promote the previous deployment in the Vercel dashboard).
#
# .vercel/ (settings, the production variables, the build output) is removed on
# EVERY exit of this script, success or failure. The workflow has a second
# `rm -rf .vercel` with `if: always()` for the case where the runner kills this
# process (timeout) and the trap never runs.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"

stage="(nog niet gestart)"
deployed_url=""
upload_started=0
url_file=$(mktemp)

# Three outcomes of a failure, told apart honestly in the job summary:
#   - steps 1-4 failed: nothing was uploaded, the live site is unchanged;
#   - step 5 failed (the CLI exited non-zero, or printed no URL): `vercel deploy`
#     had already started, so whether a deployment was created and promoted is
#     UNKNOWN from here (a timeout or a network error while the CLI waits for
#     READY does not mean the upload did not happen); the owner must look in the
#     Vercel dashboard before deploying again;
#   - step 6 failed: the deploy is done and live, the probe afterwards is red.
on_exit() {
  local code=$?
  rm -rf .vercel
  rm -f "$url_file"
  if [ "$code" -ne 0 ]; then
    if [ -n "$deployed_url" ]; then
      summary "LET OP: de deploy is WEL gedaan ($deployed_url), maar de controle van de live site daarna (stap '$stage') is niet geslaagd (exitcode $code). Lees het preflight-rapport hierboven; de site draait nu op de nieuwe versie. Herstel en deploy opnieuw, of zet in het Vercel-dashboard de vorige deployment terug op productie."
    elif [ "$upload_started" = 1 ]; then
      summary "Deploy gestopt in stap '$stage' (exitcode $code). Of er iets is gedeployed is ONBEKEND: 'vercel deploy' was al gestart. Controleer Deployments in het Vercel-dashboard (staat daar een nieuwe productie-deployment, dan is die live) voordat je opnieuw deployt. De reden staat hierboven in het log."
    else
      summary "Deploy gestopt in stap '$stage' (exitcode $code). Er is NIETS gedeployed; de live site is onveranderd. De reden staat hierboven in het log."
    fi
  fi
  exit "$code"
}
trap on_exit EXIT

# step NAME COMMAND...: a collapsible group in the GitHub log; the group is always closed.
step() {
  stage="$1"; shift
  echo "::group::$stage"
  local code=0
  "$@" || code=$?
  echo "::endgroup::"
  return "$code"
}

step "1/6 vercel pull (Production-variabelen ophalen)"         bash "$here/pull.sh"
step "2/6 migraties toepassen (vóór de nieuwe code live gaat)" bash "$here/migrate.sh"
step "3/6 preflight, offline (NIET KLAAR stopt alles)"         bash "$here/preflight-gate.sh" "$ENV_FILE"
step "4/6 vercel build (op de runner, nog niets geüpload)"     bash "$here/build.sh"
upload_started=1
step "5/6 vercel deploy --prebuilt --prod"                     bash "$here/deploy.sh" "$url_file"
deployed_url=$(cat "$url_file")

# Which address to probe: the public one from NEXT_PUBLIC_APP_URL when the
# Production environment has it (customers use that address, and the preflight
# compares every live check against it). Per the Vercel CLI documentation
# `vercel deploy --prod` waits until the deployment is READY and the production
# domain points at it, unless --no-wait is given; that was not observed from
# here (see README, "Deployen": what to watch in the first run). The
# deployment's own *.vercel.app address is the fallback, with the caveat that
# Vercel's deployment protection may put a login page in front of such an address.
site=$(env_value "$ENV_FILE" NEXT_PUBLIC_APP_URL)
case "$site" in
  https://*) probe="$site" ;;
  *) probe="$deployed_url" ;;
esac
step "6/6 preflight --url $probe (de live site)"                bash "$here/preflight-gate.sh" "$ENV_FILE" --url "$probe"

summary "Deploy geslaagd: $deployed_url is live en de live-controle van $probe gaf geen blokkades (waarschuwingen staan in het log)."
