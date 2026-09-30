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

exec node /opt/vocion-runner/src/runner.mjs "$@"
