#!/usr/bin/env bash
# infra/aws/update.sh — Vocion in-place deploy (Phase F).
#
# Run from the EC2 to pull a new git ref, rebuild the app image, and
# rolling-restart the app + worker containers. Zero-downtime (Caddy
# keeps connections open while the new app container starts; old one
# drains and exits).
#
#   ssh ec2-user@<host>
#   sudo bash /opt/vocion/infra/aws/update.sh [git-ref]
#
# Default: pull HEAD of the current branch. Pass a tag/branch/sha to
# switch revs.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/vocion}"
GIT_REF="${1:-}"

log() { echo "[update] $*"; }

cd "${REPO_DIR}"

if [ -n "${GIT_REF}" ]; then
  log "checking out ${GIT_REF}"
  git fetch --all
  git checkout "${GIT_REF}"
fi
log "pulling latest"
git pull --ff-only

log "rebuilding vocion-app image"
# NEXT_PUBLIC_* values are inlined into the client JS bundle at build
# time — they cannot be overridden at runtime. Source the real prod
# values from .env.production and pass them as --build-arg so each
# rebuild picks them up automatically (no Dockerfile edits required
# on key rotation).
# The env file lives at infra/aws/.env.production — that is where
# Terraform's user-data writes it, where bootstrap.sh reads it and what
# docker-compose.prod.yml loads. This script previously read
# ${REPO_DIR}/.env.production, one directory too high, so every rebuild
# passed empty NEXT_PUBLIC_* build args and shipped a client bundle with
# no Clerk publishable key. The repo-root path is still accepted as a
# fallback for a box that was set up by hand against the old location.
ENV_FILE="${REPO_DIR}/infra/aws/.env.production"
if [ ! -f "${ENV_FILE}" ] && [ -f "${REPO_DIR}/.env.production" ]; then
  ENV_FILE="${REPO_DIR}/.env.production"
fi
if [ ! -f "${ENV_FILE}" ]; then
  log "ERROR: no .env.production found at ${REPO_DIR}/infra/aws/ or ${REPO_DIR}/."
  log "  The client bundle inlines NEXT_PUBLIC_* at build time; without"
  log "  them the deployed app has no Clerk key and cannot sign anyone in."
  exit 1
fi
log "reading build-time env from ${ENV_FILE}"

# Read one KEY=value out of the env file, stripping surrounding quotes.
# `|| true` because grep exits 1 on no match, which under `set -e` would
# otherwise abort the deploy on any optional key.
get_env() {
  sudo grep "^$1=" "${ENV_FILE}" | head -1 | cut -d= -f2- \
    | sed 's/^"\(.*\)"$/\1/' || true
}

# Stop the deploy when a build-time value the client bundle needs is
# absent. Called at the top level, not inside a command substitution, so
# the exit actually leaves the script.
require_build_env() {
  local name="$1" value="$2"
  if [ -n "${value}" ]; then
    return 0
  fi
  log "ERROR: ${name} is missing from ${ENV_FILE}."
  log "  NEXT_PUBLIC_* values are inlined into the client bundle at build"
  log "  time and cannot be set at runtime, so rebuilding without this one"
  log "  ships an app that cannot sign anyone in."
  exit 1
}

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$(get_env NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
NEXT_PUBLIC_APP_URL=$(get_env NEXT_PUBLIC_APP_URL)
# Langfuse is optional — a deployment can run with tracing off — so only
# the two the app cannot boot usefully without are required.
NEXT_PUBLIC_LANGFUSE_BASE_URL=$(get_env NEXT_PUBLIC_LANGFUSE_BASE_URL)
NEXT_PUBLIC_LANGFUSE_PROJECT_ID=$(get_env NEXT_PUBLIC_LANGFUSE_PROJECT_ID)
require_build_env NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}"
require_build_env NEXT_PUBLIC_APP_URL "${NEXT_PUBLIC_APP_URL}"

docker build \
  --build-arg "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}" \
  --build-arg "NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}" \
  --build-arg "NEXT_PUBLIC_LANGFUSE_BASE_URL=${NEXT_PUBLIC_LANGFUSE_BASE_URL}" \
  --build-arg "NEXT_PUBLIC_LANGFUSE_PROJECT_ID=${NEXT_PUBLIC_LANGFUSE_PROJECT_ID}" \
  -t vocion-app:latest -f packages/core/Dockerfile .

# Migrations run BEFORE the containers roll. The other order gives every
# deploy a window where new application code serves requests against the
# old schema. A failure here aborts the deploy (set -e) with the old
# containers still serving, which is the safe end state.
log "applying any new migrations"
# Use the psql-based applier (drizzle-kit isn't in the runtime image —
# Next.js standalone trims devDeps). Its exit code is deliberately not
# swallowed: a failed migration must not be reported as a good deploy.
bash "${REPO_DIR}/infra/aws/apply-migrations.sh"

log "rolling app + worker"
docker compose \
  -f docker-compose.yml \
  -f infra/docker-compose.platform.yml \
  -f infra/aws/docker-compose.prod.yml \
  -p vocion up -d --no-deps app worker

# There is deliberately no workspace-apply step here. The script used to
# run `node src/scripts/apply-context.js` in the app container, which has
# not existed since the context-to-workspace rename: the script is
# `apply-workspace.ts`, it needs tsx plus src/ (both trimmed from the
# runtime image), and the runtime image ships no workspace tree at all —
# a deployment mounts its own and points WORKSPACE_PATH at it. The call
# failed on every deploy behind `|| true`. Workspace changes are applied
# by the operator against the mounted tree (`npm run workspace:apply`)
# or through the in-product workspace editor. See docs/workspace.md.

log "done."
docker compose -p vocion ps app worker
