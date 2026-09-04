#!/usr/bin/env bash
# infra/aws/apply-migrations.sh — psql-based migration applier for prod.
#
# Why this exists: the canonical migrator is `drizzle-kit migrate`, but
# drizzle-kit is a devDep trimmed out of the Next.js standalone Docker
# image. `npm run db:migrate` inside the prod container fails with
# MODULE_NOT_FOUND. Rather than ship a parallel TS migrator image, we
# apply migrations directly via psql against the in-VPC Postgres
# container.
#
# Idempotent — every migration is recorded in a `__pgsql_migrations`
# table (separate from drizzle's `__drizzle_migrations` since we're
# not pretending to be drizzle). Re-running this script after a deploy
# only applies new files.
#
# Exits non-zero the moment a migration fails, and stops rather than
# skipping ahead, so the caller can abort the deploy. Callers must NOT
# swallow that exit code: a deploy that rolls new app code against an
# unmigrated schema is the failure mode this script exists to prevent.
#
# Run from the EC2:
#
#   sudo bash /opt/vocion/infra/aws/apply-migrations.sh
#
# A database whose schema predates this tracking table needs a one-time
# baseline so the existing migrations aren't replayed — the script says
# so and stops. See baseline_pre_existing_schema below.
#
# Or pipe a single SQL file:
#
#   sudo docker exec -i vocion-postgres psql -U postgres \
#     -d vocion -v ON_ERROR_STOP=1 --single-transaction \
#     < /opt/vocion/packages/core/migrations/0099_new.sql

set -euo pipefail

# Container and database names match docker-compose.yml (`vocion-postgres`
# / POSTGRES_DB: vocion). Override only for a non-standard deployment.
CONTAINER="${POSTGRES_CONTAINER:-vocion-postgres}"
DB_NAME="${POSTGRES_DB:-vocion}"
DB_USER="${POSTGRES_USER:-postgres}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/opt/vocion/packages/core/migrations}"
# bootstrap.sh calls this right after `docker compose up -d`, so the
# Postgres container may still be initialising.
READINESS_ATTEMPTS="${POSTGRES_READINESS_ATTEMPTS:-30}"
# One-time escape hatch for a database whose schema predates this
# tracking table — see baseline_pre_existing_schema below.
MIGRATIONS_BASELINE="${MIGRATIONS_BASELINE:-}"

log() { echo "[apply-migrations] $*"; }

# Run a psql command inside the Postgres container. stdout is the
# caller's to handle; stderr is left alone so failures are visible in
# the deploy log.
run_sql() {
  sudo docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" \
    -v ON_ERROR_STOP=1 "$@"
}

# Block until Postgres accepts connections, or give up and fail.
wait_for_postgres() {
  local attempt=1
  while [ "${attempt}" -le "${READINESS_ATTEMPTS}" ]; do
    if sudo docker exec "${CONTAINER}" \
      pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; then
      return 0
    fi
    log "waiting for ${CONTAINER} (attempt ${attempt}/${READINESS_ATTEMPTS})"
    sleep 2
    attempt=$((attempt + 1))
  done
  log "ERROR: ${CONTAINER} never accepted connections."
  log "  Check: sudo docker logs ${CONTAINER} --tail=50"
  return 1
}

create_tracking_table() {
  run_sql -c "
    SET client_min_messages = warning;
    CREATE TABLE IF NOT EXISTS __pgsql_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  " >/dev/null
}

# Sorted list of migration file paths, newline-separated. Drizzle names
# files with a zero-padded ordinal prefix, so lexical sort is apply
# order — the same order as migrations/meta/_journal.json.
list_migration_files() {
  ls -1 "${MIGRATIONS_DIR}"/[0-9]*.sql 2>/dev/null | sort
}

count_tracked_migrations() {
  run_sql -tA -c "SELECT count(*) FROM __pgsql_migrations;"
}

# True when the database already holds application tables. Used to tell
# a genuinely empty database (safe to migrate from zero) apart from one
# that was migrated by some other route before this script existed.
database_has_application_tables() {
  local table_count
  table_count=$(run_sql -tA -c "
    SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name NOT LIKE '__%migrations';
  ")
  [ "${table_count}" -gt 0 ]
}

# How many migrations drizzle recorded, if the database was ever
# migrated by drizzle-kit. Prints 0 when drizzle's table is absent.
count_drizzle_migrations() {
  local table_exists
  # Existence has to be checked in its own statement: Postgres plans the
  # whole query up front, so naming a missing relation inside a CASE
  # still errors out.
  table_exists=$(run_sql -tA -c \
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL;")
  if [ "${table_exists}" != "t" ]; then
    echo 0
    return 0
  fi
  run_sql -tA -c "SELECT count(*) FROM drizzle.__drizzle_migrations;"
}

record_migration_as_applied() {
  local name="$1"
  run_sql -c \
    "INSERT INTO __pgsql_migrations (name) VALUES ('${name}')
     ON CONFLICT (name) DO NOTHING;" >/dev/null
}

# Mark the first N migration files as already applied without running
# them. Used only for baselining an existing schema.
record_first_n_as_applied() {
  local how_many="$1"
  local recorded=0
  local sql_file name
  while IFS= read -r sql_file; do
    if [ "${recorded}" -ge "${how_many}" ]; then
      break
    fi
    name=$(basename "${sql_file}")
    record_migration_as_applied "${name}"
    recorded=$((recorded + 1))
  done < <(list_migration_files)
  log "baselined ${recorded} migration(s) as already applied"
}

# A database that already has application tables but no rows in
# __pgsql_migrations would otherwise get every migration replayed —
# `CREATE TABLE "organization"` on an existing table fails on the first
# file. Two ways out:
#
#   1. The schema was migrated by drizzle-kit: its ordered
#      drizzle.__drizzle_migrations row count maps onto the first N
#      files of the same ordered migration set, so baseline from it.
#   2. Anything else (files piped in by hand): the operator states the
#      last applied migration once via
#      MIGRATIONS_BASELINE=<file name>, or MIGRATIONS_BASELINE=all.
#
# With neither, stop — replaying is worse than refusing.
baseline_pre_existing_schema() {
  local drizzle_count
  drizzle_count=$(count_drizzle_migrations)
  if [ "${drizzle_count}" -gt 0 ]; then
    log "schema exists and drizzle recorded ${drizzle_count} migration(s);"
    log "  treating the first ${drizzle_count} file(s) as already applied"
    record_first_n_as_applied "${drizzle_count}"
    return 0
  fi

  if [ "${MIGRATIONS_BASELINE}" = "all" ]; then
    local total
    total=$(list_migration_files | wc -l | tr -d ' ')
    log "MIGRATIONS_BASELINE=all — treating all ${total} file(s) as applied"
    record_first_n_as_applied "${total}"
    return 0
  fi

  if [ -n "${MIGRATIONS_BASELINE}" ]; then
    local through
    # `|| true` so a name that matches nothing falls through to the
    # error message below instead of tripping `set -e` silently.
    through=$(list_migration_files \
      | grep -n "/${MIGRATIONS_BASELINE}\$" | cut -d: -f1 || true)
    if [ -z "${through}" ]; then
      log "ERROR: MIGRATIONS_BASELINE='${MIGRATIONS_BASELINE}' matches no file"
      log "  in ${MIGRATIONS_DIR}. Pass a file name such as 0042_thing.sql."
      return 1
    fi
    log "MIGRATIONS_BASELINE=${MIGRATIONS_BASELINE} — treating the first"
    log "  ${through} file(s) as already applied"
    record_first_n_as_applied "${through}"
    return 0
  fi

  log "ERROR: database '${DB_NAME}' already has application tables but"
  log "  __pgsql_migrations is empty, so this script cannot tell which"
  log "  migrations ran. Replaying them all would fail on the first file."
  log "  Fix once, then re-run:"
  log "    - migrated by drizzle-kit? nothing to do, this script reads"
  log "      drizzle.__drizzle_migrations automatically."
  log "    - applied by hand? re-run with the last applied file name:"
  log "      sudo MIGRATIONS_BASELINE=0042_thing.sql bash $0"
  log "    - schema fully up to date? MIGRATIONS_BASELINE=all"
  return 1
}

apply_pending_migrations() {
  local applied=0
  local skipped=0
  local sql_file name already
  while IFS= read -r sql_file; do
    name=$(basename "${sql_file}")
    already=$(run_sql -tA -c \
      "SELECT 1 FROM __pgsql_migrations WHERE name = '${name}';")
    if [ "${already}" = "1" ]; then
      skipped=$((skipped + 1))
      continue
    fi
    log "applying ${name}"
    # --single-transaction so a mid-file error rolls the whole file
    # back; without it a failure leaves half a migration in place.
    if sudo docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" \
      -v ON_ERROR_STOP=1 --single-transaction < "${sql_file}" >/dev/null; then
      record_migration_as_applied "${name}"
      applied=$((applied + 1))
    else
      log "  x ${name} FAILED — nothing from this file was applied."
      log "${applied} applied · ${skipped} already-applied · 1 failed"
      return 1
    fi
  done < <(list_migration_files)
  log "${applied} applied · ${skipped} already-applied · 0 failed"
}

wait_for_postgres
create_tracking_table

if [ "$(count_tracked_migrations)" -eq 0 ] && database_has_application_tables; then
  baseline_pre_existing_schema
fi

apply_pending_migrations
