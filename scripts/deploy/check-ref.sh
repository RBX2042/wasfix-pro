#!/usr/bin/env bash
# Gate 2 of .github/workflows/deploy.yml: which commit does this run deploy?
#
#   check-ref.sh <sha> <branch>
#   outputs: current=true|false   is <sha> still the tip of <branch> at origin?
#            sha=<commit>         the commit to deploy: <sha> itself, or the tip
#
# Why: deploys wait for each other (one concurrency group) and CI runs do not
# finish in push order. Without this check a run for an OLDER commit, queued
# behind the run for a newer one, would deploy that older commit on top of the
# newer deployment: a silent rollback of main. When the branch has moved on, this
# run does NOT deploy its own commit; it deploys the current tip instead
# (check-ci.sh then requires the tip's CI to be green, checkout-tip.sh checks the
# tip out). Simply skipping would not do: GitHub keeps one waiting run per
# concurrency group and cancels the older waiting one, and because CI runs finish
# in any order the cancelled run can be the TIP's own deploy run; a green skip
# would then leave main undeployed until the next push. The price is that the tip
# may be deployed twice (by this run and by its own run, when that one was not
# cancelled): harmless, the migrations are a no-op the second time.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

sha="${1:?usage: check-ref.sh <sha> <branch>}"
branch="${2:?usage: check-ref.sh <sha> <branch>}"

# The remote's view, not the local clone's: the checkout was made at <sha> and
# knows nothing newer. (git ls-remote uses the credentials actions/checkout left behind.)
# A failing ls-remote (origin unreachable) must end in fail(), with a summary and an
# annotation, not in `set -e` killing the script with only git's message in the log.
tip=$(git ls-remote origin "refs/heads/$branch" | cut -f1) \
  || fail "Kon de huidige top van '$branch' niet opvragen bij origin (git ls-remote faalde; de melding van git staat hierboven in het log). Niet gedeployed."
[ -n "$tip" ] || fail "Kon de huidige top van '$branch' niet opvragen bij origin (git ls-remote gaf niets terug: bestaat de branch?). Niet gedeployed."

if [ "$tip" = "$sha" ]; then
  echo "Commit $sha is de huidige top van $branch."
  set_output current true
  set_output sha "$sha"
else
  summary "Commit $sha is niet meer de top van $branch (die is nu $tip). Deze run deployt daarom niet $sha (een oudere commit over een nieuwere zetten is een stille rollback) maar de huidige top $tip, mits CI daarvoor geslaagd is. De eigen deploy-run van $tip kan door de wachtrij geannuleerd zijn: GitHub bewaart één wachtende run per concurrency-groep."
  set_output current false
  set_output sha "$tip"
fi
exit 0
