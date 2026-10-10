# shellcheck shell=bash
# Shared helpers for the deploy scripts in this directory. Sourced, never executed.
#
# Rules every script here follows:
#   - no `set -x`, no `cat` (or `source`) of the pulled variables file: its
#     contents are the production secrets, and the workflow log is readable by
#     everyone who can see the repository's Actions tab;
#   - what IS printed: step names, variable NAMES, hosts, the deployment URL;
#   - every message the owner must act on goes through `summary` (the GitHub
#     job summary and the log) or `fail` (an error annotation, the summary, exit 1).

# Where `vercel pull --environment=production` writes the Production variables
# (and `vercel build --prod` reads them). Relative to the repository root, which
# is the working directory of every workflow step.
ENV_FILE=".vercel/.env.production.local"

# set_output NAME VALUE: a step output the workflow can test in an `if:`.
# Outside GitHub Actions (tests, a local run) it is only echoed.
set_output() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"; fi
  echo "$1=$2"
}

# summary TEXT: one owner-facing paragraph, in the job summary and in the log.
summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n\n' "$1" >> "$GITHUB_STEP_SUMMARY"; fi
  echo "$1"
}

# fail TEXT: stop this step with the reason visible in three places (annotation,
# summary, log). The message must be one line: an annotation cuts at a newline.
fail() {
  summary "$1" >&2
  echo "::error::$1" >&2
  exit 1
}

# env_value FILE NAME: the value of NAME in a dotenv-style file, as `vercel pull`
# writes it (NAME="value", one per line), WITHOUT sourcing the file: sourcing
# would execute whatever is in it. Prints the value with its surrounding quotes
# removed, or nothing when NAME is absent. The last occurrence wins, like
# parseEnvFile in scripts/preflight.ts. Values are taken literally (no unescaping):
# the only values these scripts read are URLs and an address, which contain
# neither quotes nor newlines.
env_value() {
  local file="$1" name="$2" line value found=""
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    [[ "$line" == "export "* ]] && line="${line#export }"
    [[ "$line" == "$name="* ]] || continue
    value="${line#*=}"
    if [[ ${#value} -ge 2 && "$value" == \"*\" ]]; then value="${value:1:${#value}-2}"
    elif [[ ${#value} -ge 2 && "$value" == \'*\' ]]; then value="${value:1:${#value}-2}"
    fi
    found="$value"
  done < "$file"
  printf '%s' "$found"
}

# env_count FILE: how many variables the file defines (a number is safe to print; names are not needed).
env_count() {
  grep -c -E '^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=' "$1" || true
}
