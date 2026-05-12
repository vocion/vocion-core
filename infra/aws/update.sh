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
docker build -t vocion-app:latest -f packages/core/Dockerfile .

log "rolling app + worker"
docker compose \
  -f docker-compose.yml \
  -f infra/docker-compose.platform.yml \
  -f infra/aws/docker-compose.prod.yml \
  -p vocion up -d --no-deps app worker

log "applying any new migrations"
docker compose -p vocion exec -T app sh -c 'cd packages/core && node node_modules/drizzle-kit/bin.cjs migrate' || true

log "applying latest context"
docker compose -p vocion exec -T app sh -c 'cd packages/core && node src/scripts/apply-context.js' || true

log "done."
docker compose -p vocion ps app worker
