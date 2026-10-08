#!/usr/bin/env bash
# Container entrypoint for the Vocion runner. One process, one task (or one poll window), then exit 0.
set -uo pipefail
umask 077
export HOME="${HOME:-/home/runner}"
mkdir -p /workspace/logs /workspace/scratch "$HOME/.claude"

# Claude Code: no auto-update, no telemetry chatter, no interactive onboarding.
export DISABLE_AUTOUPDATER=1
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
export DISABLE_TELEMETRY=1
export CI=1
# gh reads GH_TOKEN; git reads GITHUB_TOKEN through the runner's credential helper. Same token.
if [ -n "${GITHUB_TOKEN:-}" ]; then export GH_TOKEN="$GITHUB_TOKEN"; fi
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-Vocion Runner}"
export GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-runner@vocion.invalid}"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
git config --global init.defaultBranch main
git config --global advice.detachedHead false
git config --global user.name "$GIT_AUTHOR_NAME"
git config --global user.email "$GIT_AUTHOR_EMAIL"

RUNNER="${RUNNER_HOME:-/opt/vocion-runner}/src/runner.mjs"

# THE HANDOFF (Vocion 5.1, src/handoff.mjs). Whatever can claim a run (a runner token, a start
# token, a workspace token) or push to a repository is held only by a process that never runs beside
# the repository's code: the first stage claims and writes what the claim handed back to a private
# file, then this shell replaces itself with the runner proper, started with those variables unset,
# so not even /proc/1/environ has them. The runner reads the file and deletes it before it clones.
# LONG_LIVED below is handoff.mjs LONG_LIVED_ENV; src/handoff.test.mjs holds the two equal.
LONG_LIVED="VOCION_RUNNER_TOKEN VOCION_RUN_TOKEN VOCION_TOKEN GITHUB_TOKEN GH_TOKEN"
if [ -z "${LOCAL_TASK:-}${LOCAL_TASK_JSON:-}${VOCION_CLAIM_FILE:-}" ] && [ -n "${VOCION_URL:-}" ] \
  && [ -n "${VOCION_RUN_TOKEN:-}${VOCION_RUNNER_TOKEN:-}${VOCION_TOKEN:-}" ]; then
  handoff_dir="$(mktemp -d "${TMPDIR:-/tmp}/vocion-claim.XXXXXX")"
  node "$RUNNER" --claim-to "$handoff_dir/claim.json" "$@"
  if [ ! -s "$handoff_dir/claim.json" ]; then
    # Nothing to take (the first stage said why on stdout): one claim window per container.
    rm -rf "$handoff_dir"
    exit 0
  fi
  unset_args=()
  for k in $LONG_LIVED; do unset_args+=(-u "$k"); done
  exec env "${unset_args[@]}" VOCION_CLAIM_FILE="$handoff_dir/claim.json" node "$RUNNER" "$@"
fi

exec node "$RUNNER" "$@"
