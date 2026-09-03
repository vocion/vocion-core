#!/usr/bin/env bash
# infra/aws/bootstrap.sh — Vocion single-EC2 cold start (Phase F).
#
# Run this once on a fresh Amazon Linux 2023 instance to bring up the
# full stack. Idempotent: re-running on an already-bootstrapped box
# updates code + restarts services without trashing data.
#
#   ssh ec2-user@<host>
#   sudo bash /opt/vocion/infra/aws/bootstrap.sh [git-ref]
#
# Default git-ref is `main`. Override to deploy a feature branch:
#
#   sudo bash bootstrap.sh feature/cool-thing
#
# Prerequisites BEFORE running:
#   1. EC2 instance type ≥ t3.large (8 GB RAM); 32 GB recommended for embedding throughput.
#   2. EBS volume mounted at /opt/vocion-data (100 GB gp3 recommended).
#   3. .env.production placed at /opt/vocion/infra/aws/.env.production
#      (operator copies secrets manually; never committed).
#   4. Security group: 22 (SSH from operator IP), 80 + 443 (Caddy).
#   5. DNS A record pointing the VOCION_HOSTNAME at the Elastic IP.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/vocion/core.git}"
GIT_REF="${1:-main}"
REPO_DIR="/opt/vocion"
DATA_DIR="/opt/vocion-data"
ENV_FILE="${REPO_DIR}/infra/aws/.env.production"

log() { echo "[bootstrap] $*"; }
require() { command -v "$1" >/dev/null 2>&1 || { log "missing: $1"; exit 1; }; }

# ----- 1. System prereqs -----
if ! command -v docker >/dev/null 2>&1; then
  log "installing docker + git + jq + rsync"
  # rsync is needed to move Docker's data-root onto the data volume.
  dnf install -y docker git jq rsync
  systemctl enable --now docker
  usermod -aG docker ec2-user
fi

if ! docker compose version >/dev/null 2>&1; then
  log "installing docker-compose plugin"
  DOCKER_CONFIG="${DOCKER_CONFIG:-/usr/local/lib/docker}"
  mkdir -p "${DOCKER_CONFIG}/cli-plugins"
  curl -sSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
    -o "${DOCKER_CONFIG}/cli-plugins/docker-compose"
  chmod +x "${DOCKER_CONFIG}/cli-plugins/docker-compose"
fi

require docker
require git

# ----- 1b. Keep Docker's data on the mounted data volume -----
# Named volumes live under Docker's data-root, which defaults to
# /var/lib/docker on the ROOT disk. Langfuse's ClickHouse, its own
# Postgres and its object store are all named volumes, so out of the box
# they grow on the root volume — filling it takes the app down with
# them, and the EBS snapshots of the data volume never covered them.
#
# Pointing data-root at ${DATA_DIR}/docker fixes both. On a box that
# already has containers the existing tree is copied across first;
# nothing is deleted, so a bad copy can be rolled back by editing
# /etc/docker/daemon.json and restarting Docker.
DOCKER_DATA_ROOT="${DATA_DIR}/docker"
if mountpoint -q "${DATA_DIR}"; then
  CURRENT_DATA_ROOT=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo '')
  if [ "${CURRENT_DATA_ROOT}" != "${DOCKER_DATA_ROOT}" ]; then
    log "moving docker data-root to ${DOCKER_DATA_ROOT} (was ${CURRENT_DATA_ROOT:-unset})"
    require rsync
    mkdir -p "${DOCKER_DATA_ROOT}" /etc/docker
    printf '{\n  "data-root": "%s"\n}\n' "${DOCKER_DATA_ROOT}" > /etc/docker/daemon.json
    if [ -n "${CURRENT_DATA_ROOT}" ] && [ -d "${CURRENT_DATA_ROOT}" ]; then
      log "stopping docker to copy ${CURRENT_DATA_ROOT} across"
      systemctl stop docker || true
      # -aHAX preserves ownership, hard links and extended attributes,
      # which overlay2 and the volume trees both depend on. The old tree
      # is left in place on purpose.
      rsync -aHAX "${CURRENT_DATA_ROOT}/" "${DOCKER_DATA_ROOT}/"
    fi
    systemctl restart docker
    log "docker data-root is now $(docker info --format '{{.DockerRootDir}}')"
  fi
else
  log "WARNING: ${DATA_DIR} is not a mount point; docker data stays on the root volume"
fi

# ----- 2. Clone or update the repo -----
if [ ! -d "${REPO_DIR}/.git" ]; then
  log "cloning ${REPO_URL} → ${REPO_DIR}"
  mkdir -p "${REPO_DIR}"
  git clone "${REPO_URL}" "${REPO_DIR}"
fi
log "checking out ${GIT_REF}"
git -C "${REPO_DIR}" fetch --all
git -C "${REPO_DIR}" checkout "${GIT_REF}"
git -C "${REPO_DIR}" pull --ff-only

# ----- 3. Verify the env file exists -----
if [ ! -f "${ENV_FILE}" ]; then
  log "ERROR: ${ENV_FILE} missing. Copy infra/aws/.env.production.example, fill in secrets, then re-run."
  exit 1
fi

# ----- 4. Data dir (Postgres + Caddy persist here) -----
mkdir -p "${DATA_DIR}"

# ----- 5. Network for cross-compose services -----
docker network inspect corecontext >/dev/null 2>&1 \
  || docker network create corecontext

# ----- 6. Build the Vocion app image -----
log "building vocion-app image"
docker build -t vocion-app:latest -f "${REPO_DIR}/packages/core/Dockerfile" "${REPO_DIR}"

# ----- 7. Bring up the Vocion stack -----
log "starting Vocion stack (app + worker + caddy + langfuse + postgres + otel)"
# Order matters. infra/docker-compose.platform.yml is the laptop stack:
# it publishes Langfuse on host port 3200 and hardcodes every Langfuse
# secret. The langfuse.prod overlay comes last so it wins, replacing the
# committed secrets with values from .env.production, dropping the
# published port and swapping MinIO for S3. Without it a client
# deployment runs Langfuse with credentials that are public in this
# repository. See docs/deployment/observability.md.
docker compose \
  --env-file "${ENV_FILE}" \
  -f "${REPO_DIR}/docker-compose.yml" \
  -f "${REPO_DIR}/infra/docker-compose.platform.yml" \
  -f "${REPO_DIR}/infra/aws/docker-compose.prod.yml" \
  -f "${REPO_DIR}/infra/docker-compose.langfuse.prod.yml" \
  -p vocion up -d

# ----- 8. One-shot DB migrations + context apply -----
log "applying database migrations"
docker compose -p vocion exec -T app sh -c 'cd packages/core && node node_modules/drizzle-kit/bin.cjs migrate' || true

log "seeding context (sales-assistant agent + operations + playbooks + learnings + evals)"
docker compose -p vocion exec -T app sh -c 'cd packages/core && node src/scripts/apply-context.js' || true

# ----- 9. Print status -----
log "containers running:"
docker compose -p vocion ps

VOCION_HOST=$(grep -E '^VOCION_HOSTNAME=' "${ENV_FILE}" | cut -d= -f2)
log "bootstrap complete. Visit: https://${VOCION_HOST}"
log "tail logs: docker compose -p vocion logs -f --tail=200"
