#!/usr/bin/env bash
# Gate 1 of .github/workflows/deploy.yml: are the three Vercel secrets set?
#
# GitHub does not allow `secrets.*` in a job-level `if:`, so this step decides and
# the later steps test its output (`steps.secrets.outputs.configured == 'true'`).
# A missing secret is not a failure: the repository simply is not wired to Vercel
# yet, so the workflow must skip with a plain note and exit 0, not go red on every
# merge. Names are printed, values never (GitHub masks them, this script does not
# rely on that).
set -euo pipefail
. "$(dirname "$0")/lib.sh"

missing=()
for name in VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID; do
  # Unset, empty and whitespace-only all count as missing: a token of spaces
  # would only fail later, inside `vercel pull`, with a confusing message.
  [[ "${!name:-}" == *[![:space:]]* ]] || missing+=("$name")
done

if [ ${#missing[@]} -eq 0 ]; then
  echo "Vercel-secrets aanwezig: VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID."
  set_output configured true
else
  summary "Deploy overgeslagen: de repository-secret(s) ${missing[*]} ontbreken. Zet ze in GitHub (Settings, Secrets and variables, Actions) zoals README.md beschrijft onder 'Deployen'; tot die tijd wordt er niets gedeployed en is dit geen fout."
  set_output configured false
fi
exit 0
