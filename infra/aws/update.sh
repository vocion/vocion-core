#!/usr/bin/env bash
# infra/aws/update.sh — Vocion in-place deploy (Phase F).
#
# Run from the EC2 to pull a new git ref, get the app image, and
# rolling-restart the app + worker containers. Zero-downtime (Caddy
# keeps connections open while the new app container starts; old one
# drains and exits).
#
#   ssh ec2-user@<host>
#   sudo VOCION_APP_IMAGE=<registry>/<repository>:<tag> bash /opt/vocion/infra/aws/update.sh [git-ref]
#
# Default: pull HEAD of the current branch. Pass a tag/branch/sha to
# switch revs.
#
# VOCION_APP_IMAGE names an image CI built with push-app-image.sh; the
# deploy pulls it and compiles nothing here (#670). Left unset, the deploy
# builds the image on this box, as it always has. That build competes with
# the running stack for memory, so it's the fallback, not the way to deploy.

set -euo pipefail

# Exported so apply-migrations.sh resolves its migrations directory
# against this checkout rather than the hardcoded default.
export REPO_DIR="${REPO_DIR:-/opt/vocion}"
GIT_REF="${1:-}"

log() { echo "[update] $*"; }

cd "${REPO_DIR}"

if [ -n "${GIT_REF}" ]; then
  log "checking out ${GIT_REF}"
  git fetch --all
  git checkout "${GIT_REF}"
fi
# A tag or a commit leaves HEAD detached, with no branch to pull; that's how
# a rollback deploys an older commit.
if git symbolic-ref -q HEAD >/dev/null; then
  log "pulling latest"
  git pull --ff-only
fi

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
LEGACY_ENV_FILE="${REPO_DIR}/.env.production"
if [ -f "${ENV_FILE}" ] && [ -f "${LEGACY_ENV_FILE}" ]; then
  log "WARNING: two env files exist and they may disagree."
  log "  using:    ${ENV_FILE}"
  log "  ignoring: ${LEGACY_ENV_FILE}"
  log "  Delete the second one once you have confirmed the first is current."
elif [ ! -f "${ENV_FILE}" ] && [ -f "${LEGACY_ENV_FILE}" ]; then
  ENV_FILE="${LEGACY_ENV_FILE}"
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

NEXT_PUBLIC_APP_URL=$(get_env NEXT_PUBLIC_APP_URL)

if [ -n "${VOCION_APP_IMAGE:-}" ]; then
  log "pulling prebuilt image ${VOCION_APP_IMAGE}"
  # A ref from before prebuilt images has no pull script. Stop rather than
  # build: the caller asked for a particular image.
  if [ ! -f "${REPO_DIR}/infra/aws/pull-app-image.sh" ]; then
    log "ERROR: ${GIT_REF:-this checkout} has no infra/aws/pull-app-image.sh."
    log "  Deploy it without VOCION_APP_IMAGE to build the image on the box."
    exit 1
  fi
  # The image carries the app URL it was built for; one built for another
  # environment would break sign-in here. Without this box's own URL there is
  # nothing to check it against, so stop rather than skip the check.
  require_build_env NEXT_PUBLIC_APP_URL "${NEXT_PUBLIC_APP_URL}"
  EXPECTED_APP_URL="${NEXT_PUBLIC_APP_URL}" \
    bash "${REPO_DIR}/infra/aws/pull-app-image.sh" "${VOCION_APP_IMAGE}"
else
  log "rebuilding vocion-app image on this box (no VOCION_APP_IMAGE given)"
  log "  This build competes with the running stack for memory (#670)."
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$(get_env NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
  # Langfuse is optional — a deployment can run with tracing off — so only
  # the two the app cannot boot usefully without are required.
  NEXT_PUBLIC_LANGFUSE_BASE_URL=$(get_env NEXT_PUBLIC_LANGFUSE_BASE_URL)
  NEXT_PUBLIC_LANGFUSE_PROJECT_ID=$(get_env NEXT_PUBLIC_LANGFUSE_PROJECT_ID)
  require_build_env NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}"
  require_build_env NEXT_PUBLIC_APP_URL "${NEXT_PUBLIC_APP_URL}"

  # The image's build step keeps Turbopack's build cache in a BuildKit cache
  # mount (#670), so a deploy recompiles only what changed, and `docker build`
  # runs BuildKit only through the buildx plugin. Boxes bootstrapped before
  # #670 may not have it. A ref from before #670 has neither the script nor the
  # cache mount, so a rollback to one skips this and builds as it always did.
  if [ -f "${REPO_DIR}/infra/aws/install-buildx.sh" ]; then
    bash "${REPO_DIR}/infra/aws/install-buildx.sh"
  fi

  docker build \
    --build-arg "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}" \
    --build-arg "NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}" \
    --build-arg "NEXT_PUBLIC_LANGFUSE_BASE_URL=${NEXT_PUBLIC_LANGFUSE_BASE_URL}" \
    --build-arg "NEXT_PUBLIC_LANGFUSE_PROJECT_ID=${NEXT_PUBLIC_LANGFUSE_PROJECT_ID}" \
    -t vocion-app:latest -f packages/core/Dockerfile .
fi

# Migrations run BEFORE the containers roll, and a failure here aborts
# the deploy (set -e) with the old containers still serving.
#
# This order does not remove the schema-skew window, it picks which side
# of it to take: the outgoing release serves against the new schema for
# the length of the roll. That is the safe half only if migrations stay
# backward-compatible with the release being replaced — expand now,
# contract in a later deploy. A `DROP COLUMN` or rename shipped in one
# step breaks the running app the moment it is applied, and keeps it
# broken if the roll below then fails.
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
