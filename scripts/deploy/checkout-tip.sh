#!/usr/bin/env bash
# Between gate 3 and the pipeline, only when check-ref.sh said current=false and
# check-ci.sh said green=true for the tip: make the working tree that tip, so
# that `npm ci`, the migrations, the preflight and the build all come from the
# commit that is deployed, not from this run's own, older commit.
#
#   checkout-tip.sh <sha>
#
# actions/checkout made a shallow clone at the older commit; the tip is fetched
# by its sha (the way actions/checkout itself fetches a commit) and HEAD is
# verified afterwards. Any failure here means nothing is deployed (exit 1).
set -euo pipefail
. "$(dirname "$0")/lib.sh"

sha="${1:?usage: checkout-tip.sh <sha>}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "checkout-tip.sh: '$sha' is geen volledige commit-sha; niet gedeployed."

git fetch -q --depth=1 origin "$sha" || fail "Commit $sha (de top van main) kon niet van origin worden opgehaald; niet gedeployed."
git checkout -q --detach "$sha" || fail "Commit $sha kon niet worden uitgecheckt; niet gedeployed."
head=$(git rev-parse HEAD)
[ "$head" = "$sha" ] || fail "Na het uitchecken staat HEAD op $head, niet op $sha; niet gedeployed."
echo "Werkmap staat nu op $sha, de huidige top van main."
