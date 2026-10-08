#!/usr/bin/env bash
# vocion-deploy — bring this box to a pinned vocion-core release.
#
# Installed by the vocion-stack module's user-data at /usr/local/sbin/vocion-deploy
# and run once on first boot. Every later deploy is the same command, from an
# SSM session:
#
#   sudo vocion-deploy            # the release in /etc/vocion/deploy.env
#   sudo vocion-deploy v5.1.0     # move to another release (a tag or a full sha)
#
# In order, and why the order:
#   1. packages   docker, the compose plugin, git, jq
#   2. config     the module's SSM parameter: hostnames, secret ids, the RDS
#                 endpoint, the non-secret env. Read every run, so an apply
#                 that changes it reaches the box on its next deploy.
#   3. checkout   vocion-core at the release, detached. A branch is refused:
#                 a branch is not a pin.
#   4. env        the app-env secret, the module's env over it, DATABASE_URL
#                 built from the rds-app secret → .env.production (0600)
#   5. image      built here from the checkout (or pulled: VOCION_APP_IMAGE)
#   6. migrate    core's applier, against RDS, BEFORE the new container
#                 starts, so new code never serves an old schema
#   7. swap       compose up: core's files plus the module's overlay
#   8. check      the new container reports the commit that was built
#
# Nothing is printed from a secret. Secret values go to files under a 0700
# directory and reach docker by environment, never on a command line.
set -euo pipefail

readonly CONF=/etc/vocion/deploy.env
readonly ETC=/etc/vocion
# Exported: core's scripts resolve their checkout from it.
export REPO_DIR=/opt/vocion
readonly REPO_DIR
readonly CERTS_DIR=/opt/vocion-certs
readonly ARTIFACTS_DIR=/opt/vocion-data/artifacts
readonly STATE_DIR=/var/lib/vocion
readonly RDS_CA_URL=https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
readonly DB_CLIENT=vocion-db-client
# The app image runs as nextjs (uid 1001, packages/core/Dockerfile).
readonly APP_UID=1001

log() { printf '[vocion-deploy] %s\n' "$*"; }
die() {
  log "ERROR: $*"
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "run as root: sudo vocion-deploy"
[ -r "${CONF}" ] || die "${CONF} is missing; this box was not built by the vocion-stack module"
# shellcheck source=/dev/null
. "${CONF}"
: "${REGION:?REGION missing from ${CONF}}" "${CONFIG_PARAM:?}" "${CORE_REPO:?}" "${CORE_REF:?}"
REF="${1:-${CORE_REF}}"
# cloud-init runs this with no HOME; git and the docker CLI both want one.
export HOME="${HOME:-/root}"

WORK="$(mktemp -d)"
chmod 700 "${WORK}"
cleanup() {
  rm -rf "${WORK}"
  docker rm -f "${DB_CLIENT}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ----- 1. packages -----

if ! command -v docker >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
  log "installing docker, git, jq"
  dnf install -y -q docker git jq
fi
command -v aws >/dev/null 2>&1 || dnf install -y -q awscli-2
systemctl enable --now docker >/dev/null
if ! docker compose version >/dev/null 2>&1; then
  log "installing the docker compose plugin"
  install -d -m 755 /usr/local/lib/docker/cli-plugins
  curl -fsSL --retry 3 \
    "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod 755 /usr/local/lib/docker/cli-plugins/docker-compose
fi

# ----- 2. config -----

aws ssm get-parameter --region "${REGION}" --name "${CONFIG_PARAM}" \
  --query Parameter.Value --output text >"${WORK}/config.json" ||
  die "could not read ${CONFIG_PARAM}"
jq -e 'type == "object" and (.env | type == "object")' "${WORK}/config.json" >/dev/null ||
  die "${CONFIG_PARAM} is not the module's deploy config"
cfg() { jq -r "$1 // empty" "${WORK}/config.json"; }

PUBLIC_HOST="$(cfg .hostname)"
BEHIND_ALB="$(jq -r '.behind_alb == true' "${WORK}/config.json")"
APP_SECRET_ID="$(cfg .app_secret_id)"
DB_SECRET_ID="$(cfg .db_secret_id)"
DB_HOST="$(cfg .db.host)"
DB_PORT="$(cfg .db.port)"
DB_NAME="$(cfg .db.name)"
DB_MAJOR="$(cfg .db.major)"
RUNNERS_PARAM="$(cfg .runners_param)"
RUNNER_SECRET_ID="$(cfg .runner_secret_id)"
log "deploying ${PUBLIC_HOST} (behind ALB: ${BEHIND_ALB})"

# ----- 3. checkout -----

if [ ! -d "${REPO_DIR}/.git" ]; then
  log "cloning ${CORE_REPO}"
  git clone --quiet --no-checkout "${CORE_REPO}" "${REPO_DIR}"
fi
git -C "${REPO_DIR}" remote set-url origin "${CORE_REPO}"
# --force: a re-pointed tag upstream replaces the stale local one.
git -C "${REPO_DIR}" fetch --quiet --force --tags origin
if [[ "${REF}" =~ ^[0-9a-f]{40}$ ]]; then
  git -C "${REPO_DIR}" cat-file -e "${REF}^{commit}" 2>/dev/null ||
    git -C "${REPO_DIR}" fetch --quiet origin "${REF}" ||
    die "commit ${REF} is not in ${CORE_REPO}"
  SHA="${REF}"
elif SHA="$(git -C "${REPO_DIR}" rev-parse -q --verify "refs/tags/${REF}^{commit}")"; then
  :
else
  die "${REF} is neither a tag nor a full commit sha of ${CORE_REPO}"
fi
git -C "${REPO_DIR}" -c advice.detachedHead=false checkout --quiet --force --detach "${SHA}"
DESCRIBE="$(git -C "${REPO_DIR}" describe --tags --long 2>/dev/null || true)"
SUBJECT="$(git -C "${REPO_DIR}" log -1 --format=%s)"
log "core ${REF} = ${SHA:0:12} (${DESCRIBE:-no tag})"

# ----- 4. env -----

aws secretsmanager get-secret-value --region "${REGION}" --secret-id "${APP_SECRET_ID}" \
  --query SecretString --output text >"${WORK}/app.json" ||
  die "could not read the app-env secret ${APP_SECRET_ID}; put its value first (README: First deploy)"
jq -e 'type == "object" and length > 0' "${WORK}/app.json" >/dev/null ||
  die "the app-env secret is not a non-empty JSON object"

aws secretsmanager get-secret-value --region "${REGION}" --secret-id "${DB_SECRET_ID}" \
  --query SecretString --output text >"${WORK}/db.json" ||
  die "could not read the rds-app secret ${DB_SECRET_ID}; create the app's database login first (README: First deploy)"
jq -e '(.username // "" | length > 0) and (.password // "" | length > 0)' "${WORK}/db.json" >/dev/null ||
  die "the rds-app secret needs {\"username\", \"password\"}"
DB_USER="$(jq -r .username "${WORK}/db.json")"

if jq -e 'has("DATABASE_URL")' "${WORK}/app.json" >/dev/null; then
  log "WARN: DATABASE_URL in the app-env secret is ignored; it is built from the rds-app secret"
fi

# TLS to RDS, verified against Amazon's RDS CA bundle (mounted read-only into
# the app at /etc/vocion/certs by compose.cloud.yml).
jq -n --slurpfile db "${WORK}/db.json" --arg host "${DB_HOST}" --arg port "${DB_PORT}" --arg name "${DB_NAME}" '{
  DATABASE_URL: ("postgresql://" + ($db[0].username | @uri) + ":" + ($db[0].password | @uri)
    + "@" + $host + ":" + $port + "/" + $name
    + "?sslmode=verify-full&sslrootcert=/etc/vocion/certs/rds-global-bundle.pem")
}' >"${WORK}/dburl.json"

# The engineering runners' targets and token, when the module created them.
echo '{}' >"${WORK}/runners.json"
if [ -n "${RUNNERS_PARAM}" ]; then
  aws ssm get-parameter --region "${REGION}" --name "${RUNNERS_PARAM}" \
    --query Parameter.Value --output text >"${WORK}/runners-param.json" ||
    die "could not read ${RUNNERS_PARAM}"
  if aws secretsmanager get-secret-value --region "${REGION}" --secret-id "${RUNNER_SECRET_ID}" \
    --query SecretString --output text >"${WORK}/runner-secret.json" 2>/dev/null &&
    jq -e '.VOCION_RUNNER_TOKEN // "" | length > 0' "${WORK}/runner-secret.json" >/dev/null; then
    jq -n --slurpfile p "${WORK}/runners-param.json" --slurpfile s "${WORK}/runner-secret.json" \
      '{VOCION_RUNNERS: ($p[0] | tojson), VOCION_RUNNER_TOKEN: $s[0].VOCION_RUNNER_TOKEN}' >"${WORK}/runners.json"
    log "runner targets from ${RUNNERS_PARAM}"
  else
    log "WARN: the runner secret has no VOCION_RUNNER_TOKEN yet; runners stay off for this deploy"
  fi
fi

# Precedence, lowest first: the secret, the module's env (app_env included),
# the runners, DATABASE_URL.
jq -s '.[0] + .[1].env + .[2] + .[3] | with_entries(.value |= tostring)' \
  "${WORK}/app.json" "${WORK}/config.json" "${WORK}/runners.json" "${WORK}/dburl.json" >"${WORK}/env.json"
BAD_KEYS="$(jq -r 'to_entries[] | select((.key | test("^[A-Za-z_][A-Za-z0-9_]*$") | not) or (.value | test("[\n\r]"))) | .key' "${WORK}/env.json")"
[ -z "${BAD_KEYS}" ] || die "these env entries have an invalid name or a multi-line value: ${BAD_KEYS//$'\n'/ }"
# Compose reads this file as dotenv: an unquoted value is interpolated ($VAR)
# and loses anything after " #". Such a value is written single-quoted, which
# compose takes literally; one that would also need a single quote inside is
# refused rather than written wrong.
QUOTE_TEST='test("[$]|\\s#|^[\\s\"\u0027]|\\s$")'
BAD_QUOTES="$(jq -r "to_entries[] | select((.value | ${QUOTE_TEST}) and (.value | test(\"\u0027\"))) | .key" "${WORK}/env.json")"
[ -z "${BAD_QUOTES}" ] || die "these env values need quoting but contain a single quote: ${BAD_QUOTES//$'\n'/ }"
jq -r "to_entries[] | if (.value | ${QUOTE_TEST}) then \"\\(.key)='\\(.value)'\" else \"\\(.key)=\\(.value)\" end" \
  "${WORK}/env.json" >"${WORK}/env"
# Compose resolves env_file against the project directory (the checkout root)
# as well as core's prod overlay directory, so the file goes in both.
install -m 600 "${WORK}/env" "${REPO_DIR}/infra/aws/.env.production"
install -m 600 "${WORK}/env" "${REPO_DIR}/.env.production"
readonly ENV_FILE="${REPO_DIR}/infra/aws/.env.production"
APP_URL="$(jq -r '.NEXT_PUBLIC_APP_URL // empty' "${WORK}/env.json")"
log "env: $(jq 'length' "${WORK}/env.json") variables"

# The RDS CA bundle (public certificates). A failed refresh keeps the one on disk.
install -d -m 755 "${CERTS_DIR}"
if curl -fsS --retry 3 --max-time 30 -o "${WORK}/rds.pem" "${RDS_CA_URL}" &&
  grep -q 'BEGIN CERTIFICATE' "${WORK}/rds.pem"; then
  install -m 644 "${WORK}/rds.pem" "${CERTS_DIR}/rds-global-bundle.pem"
elif [ -s "${CERTS_DIR}/rds-global-bundle.pem" ]; then
  log "WARN: could not refresh the RDS CA bundle; keeping the one on disk"
else
  die "no RDS CA bundle: ${RDS_CA_URL} unreachable and none on disk"
fi

# Caddy's config for this mode, and the artifact directory the app writes.
if [ "${BEHIND_ALB}" = "true" ]; then
  install -m 644 "${ETC}/Caddyfile.alb" "${ETC}/Caddyfile"
else
  install -m 644 "${ETC}/Caddyfile.tls" "${ETC}/Caddyfile"
fi
install -d -m 750 -o "${APP_UID}" -g "${APP_UID}" "${ARTIFACTS_DIR}"

# ----- 5. image -----

if [ -n "${VOCION_APP_IMAGE:-}" ]; then
  log "pulling ${VOCION_APP_IMAGE}"
  EXPECTED_APP_URL="${APP_URL}" bash "${REPO_DIR}/infra/aws/pull-app-image.sh" "${VOCION_APP_IMAGE}"
else
  if [ -f "${REPO_DIR}/infra/aws/install-buildx.sh" ]; then
    bash "${REPO_DIR}/infra/aws/install-buildx.sh"
  fi
  # Every build leaves cache behind; keep enough for a warm rebuild, no more.
  docker builder prune -af --keep-storage 6GB >/dev/null 2>&1 || true
  log "building the app image for ${APP_URL} (core ${SHA:0:12})"
  docker build --progress=plain -t vocion-app:latest \
    --build-arg NEXT_PUBLIC_APP_URL="${APP_URL}" \
    --build-arg VOCION_DEPLOY_PIN="${SHA}" \
    --build-arg VOCION_BUILD_SHA="${SHA}" \
    --build-arg VOCION_BUILD_REF="${REF}" \
    --build-arg VOCION_BUILD_DESCRIBE="${DESCRIBE}" \
    --build-arg VOCION_BUILD_SUBJECT="${SUBJECT}" \
    -f "${REPO_DIR}/packages/core/Dockerfile" "${REPO_DIR}"
fi

# ----- 6. migrate (while the previous container, if any, still serves) -----

# Core's applier runs psql through `docker exec` into a container. Point it at
# a client container whose libpq environment names RDS: same script, same
# tracking table, same concurrent-index handling as every other install.
docker rm -f "${DB_CLIENT}" >/dev/null 2>&1 || true
PGPASSWORD="$(jq -r .password "${WORK}/db.json")" docker run -d --name "${DB_CLIENT}" \
  --network host \
  -e PGHOST="${DB_HOST}" -e PGPORT="${DB_PORT}" -e PGPASSWORD \
  -e PGSSLMODE=verify-full -e PGSSLROOTCERT=/certs/rds-global-bundle.pem \
  -v "${CERTS_DIR}:/certs:ro" \
  --entrypoint tail "public.ecr.aws/docker/library/postgres:${DB_MAJOR:-16}-alpine" -f /dev/null >/dev/null
log "migrations against ${DB_HOST}/${DB_NAME}"
POSTGRES_CONTAINER="${DB_CLIENT}" POSTGRES_USER="${DB_USER}" POSTGRES_DB="${DB_NAME}" \
  bash "${REPO_DIR}/infra/aws/apply-migrations.sh"
docker rm -f "${DB_CLIENT}" >/dev/null 2>&1 || true

# ----- 7. swap -----

compose() {
  docker compose --env-file "${ENV_FILE}" \
    -f "${REPO_DIR}/docker-compose.yml" \
    -f "${REPO_DIR}/infra/docker-compose.platform.yml" \
    -f "${REPO_DIR}/infra/aws/docker-compose.prod.yml" \
    -f "${REPO_DIR}/infra/docker-compose.langfuse.prod.yml" \
    -f "${ETC}/compose.cloud.yml" \
    -p vocion "$@"
}
# Core's prod overlay joins an external network, vocion_default, that only
# the base compose creates. On a fresh box, create it that way first, starting
# only `postgres` (which core's app service depends on): the base file
# includes the platform stack, and pulling its images is not this step's job.
if ! docker network inspect vocion_default >/dev/null 2>&1; then
  docker compose --env-file "${ENV_FILE}" -f "${REPO_DIR}/docker-compose.yml" -p vocion up -d --no-recreate postgres
fi
docker network inspect corecontext >/dev/null 2>&1 || docker network create corecontext >/dev/null
log "starting the stack"
compose up -d --remove-orphans

# ----- 8. check -----

pin=""
for _ in $(seq 1 60); do
  pin="$(docker exec vocion-app wget -qO- http://127.0.0.1:3000/version.txt 2>/dev/null | awk '$1 == "deploy-pin" { print $2 }' || true)"
  [ "${pin}" = "${SHA}" ] && break
  sleep 3
done
[ "${pin}" = "${SHA}" ] ||
  die "the app is not serving ${SHA:0:12} (it reports '${pin:-nothing}'); see: docker compose -p vocion logs app"
if [ "${BEHIND_ALB}" = "true" ]; then
  curl -fsS -o /dev/null -H "Host: ${PUBLIC_HOST}" http://127.0.0.1/version.txt ||
    die "the app is up but Caddy does not serve it on :80"
fi

install -d -m 755 "${STATE_DIR}"
printf 'ref=%s\nsha=%s\ndeployed_at=%s\n' "${REF}" "${SHA}" "$(date -u +%FT%TZ)" >"${STATE_DIR}/deployed"
docker image prune -f >/dev/null 2>&1 || true
log "done: ${APP_URL} serves core ${REF} (${SHA:0:12})"
