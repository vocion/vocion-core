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

REPO_DIR="/opt/vocion"
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
ENV_FILE="/opt/vocion/.env.production"
get_env() {
  if [ -f "${ENV_FILE}" ]; then
    sudo grep "^$1=" "${ENV_FILE}" | head -1 | cut -d= -f2- | sed 's/^"\(.*\)"$/\1/'
  fi
}
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$(get_env NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
NEXT_PUBLIC_APP_URL=$(get_env NEXT_PUBLIC_APP_URL)
NEXT_PUBLIC_LANGFUSE_BASE_URL=$(get_env NEXT_PUBLIC_LANGFUSE_BASE_URL)
NEXT_PUBLIC_LANGFUSE_PROJECT_ID=$(get_env NEXT_PUBLIC_LANGFUSE_PROJECT_ID)
docker build \
  --build-arg "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}" \
  --build-arg "NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}" \
  --build-arg "NEXT_PUBLIC_LANGFUSE_BASE_URL=${NEXT_PUBLIC_LANGFUSE_BASE_URL}" \
  --build-arg "NEXT_PUBLIC_LANGFUSE_PROJECT_ID=${NEXT_PUBLIC_LANGFUSE_PROJECT_ID}" \
  -t vocion-app:latest -f packages/core/Dockerfile .

log "rolling app + worker"
docker compose \
  -f docker-compose.yml \
  -f infra/docker-compose.platform.yml \
  -f infra/aws/docker-compose.prod.yml \
  -p vocion up -d --no-deps app worker

log "applying any new migrations"
# Use the psql-based applier (drizzle-kit isn't in the runtime image —
# Next.js standalone trims devDeps).
bash /opt/vocion/infra/aws/apply-migrations.sh || log "WARN: migrations failed; check above"

log "applying latest context"
docker compose -p vocion exec -T app sh -c 'cd packages/core && node src/scripts/apply-context.js' || true

log "done."
docker compose -p vocion ps app worker
