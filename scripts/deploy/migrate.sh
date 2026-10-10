#!/usr/bin/env bash
# Pipeline step 2 of 6: apply the Prisma migrations to the production database,
# BEFORE the new code is built and deployed.
#
# Why before and not after: every migration in prisma/migrations is additive
# (new tables, new columns that are nullable or have a default, backfills;
# nothing is dropped, renamed or retyped). scripts/qa-deploy.ts scans the SQL
# and fails a future migration that drops, renames, retypes or truncates,
# deletes rows, adds a NOT NULL column without a DEFAULT to an existing table,
# makes an existing column NOT NULL, or puts a unique index or a constraint on
# columns the live code already writes (new tables and new columns are exempt).
# The scan is textual and statement-anchored. Not scanned: the same DDL inside a
# DO $$ ... $$ block, a function body or an EXECUTE string (only DROP, RENAME,
# TYPE, TRUNCATE and DELETE are seen there), dropping a DEFAULT, removing enum
# values; a human reads those.
# The code that is live right now therefore keeps working on the migrated schema, while the NEW
# build needs the migrated schema from its very first request: its health route
# (/api/v1/health) answers 503 "migrations pending" until every migration folder
# of the build is applied (next.config.ts, WASFIX_EXPECTED_MIGRATIONS), and a
# query on a column that does not exist yet would fail. Migrating first closes
# that window; migrating afterwards would open it on every deploy.
#
# What is passed on: only DATABASE_URL and DIRECT_URL from the pulled file, as
# environment of the migration process. scripts/migrate.ts then uses DIRECT_URL
# (a session or direct connection) when it is set and prints host:port/database,
# never the credentials. The variables file itself is not sourced and not shown.
#
# No DATABASE_URL in the Production environment means there is nothing to
# migrate and a shop that cannot store anything: stop here, before anything is
# built or deployed.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

[ -f "$ENV_FILE" ] || fail "$ENV_FILE ontbreekt: draai eerst pull.sh (vercel pull)."

db=$(env_value "$ENV_FILE" DATABASE_URL)
direct=$(env_value "$ENV_FILE" DIRECT_URL)

if [ -z "$db" ]; then
  fail "DATABASE_URL ontbreekt in de Production-omgeving van Vercel ($ENV_FILE): zonder database is er niets te migreren en kan de winkel niets opslaan. Zet DATABASE_URL (de transaction pooler) en DIRECT_URL (session pooler, poort 5432, voor de migraties) bij Vercel onder Settings, Environment Variables, Production, en start de deploy opnieuw. Er is niets gebouwd of gedeployed."
fi

if [ -n "$direct" ]; then
  echo "Migraties toepassen via DIRECT_URL (scripts/migrate.ts noemt host en database)."
  DATABASE_URL="$db" DIRECT_URL="$direct" npm run db:migrate:deploy
else
  echo "DIRECT_URL staat niet in de Production-omgeving: migraties lopen via DATABASE_URL. Is dat de transaction pooler (poort 6543), dan waarschuwt scripts/migrate.ts en kan dit vastlopen; zet dan DIRECT_URL (session pooler, poort 5432) in Vercel."
  DATABASE_URL="$db" npm run db:migrate:deploy
fi
