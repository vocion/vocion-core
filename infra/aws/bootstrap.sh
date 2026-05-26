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
  log "installing docker + git + jq"
  dnf install -y docker git jq
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
docker compose \
  -f "${REPO_DIR}/docker-compose.yml" \
  -f "${REPO_DIR}/infra/docker-compose.platform.yml" \
  -f "${REPO_DIR}/infra/aws/docker-compose.prod.yml" \
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
