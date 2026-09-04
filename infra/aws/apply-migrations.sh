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
#   sudo bash /opt/vocion/infra/aws/apply-migrations.sh --check
#   sudo bash /opt/vocion/infra/aws/apply-migrations.sh --baseline all
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
# Follows REPO_DIR, which update.sh and bootstrap.sh export, so a
# checkout somewhere other than /opt/vocion migrates from its own
# migration set rather than the default one.
MIGRATIONS_DIR="${MIGRATIONS_DIR:-${REPO_DIR:-/opt/vocion}/packages/core/migrations}"
# bootstrap.sh calls this right after `docker compose up -d`, so the
# Postgres container may still be initialising.
READINESS_ATTEMPTS="${POSTGRES_READINESS_ATTEMPTS:-30}"
# One-time escape hatch for a database whose schema predates this
# tracking table — see baseline_pre_existing_schema below. Settable as an
# environment variable or, preferably, with --baseline: `sudo VAR=value`
# is refused by the default sudoers env_reset, so a flag is one less
# thing for an operator to get wrong.
MIGRATIONS_BASELINE="${MIGRATIONS_BASELINE:-}"
# --check reports what would happen and writes nothing.
CHECK_ONLY=false

log() { echo "[apply-migrations] $*"; }

print_usage() {
  cat <<USAGE
Usage: apply-migrations.sh [--baseline <file|all>] [--check]

  --baseline <file>  treat every migration up to and including <file> as
                     already applied, for a database whose schema predates
                     the __pgsql_migrations table
  --baseline all     treat every migration file as already applied
  --check            report what would happen; write nothing
  -h, --help         this message

Environment: POSTGRES_CONTAINER, POSTGRES_DB, POSTGRES_USER,
MIGRATIONS_DIR, REPO_DIR, POSTGRES_READINESS_ATTEMPTS, MIGRATIONS_BASELINE
USAGE
}

parse_arguments() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --baseline)
        if [ "$#" -lt 2 ]; then
          log "ERROR: --baseline needs a migration file name, or 'all'."
          exit 1
        fi
        MIGRATIONS_BASELINE="$2"
        shift 2
        ;;
      --baseline=*)
        MIGRATIONS_BASELINE="${1#--baseline=}"
        shift
        ;;
      --check)
        CHECK_ONLY=true
        shift
        ;;
      -h | --help)
        print_usage
        exit 0
        ;;
      *)
        log "ERROR: unknown argument '$1'"
        print_usage
        exit 1
        ;;
    esac
  done
}

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
  if [ "${CHECK_ONLY}" = true ]; then
    return 0
  fi
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
  # `find`, not a glob: it exits 0 when nothing matches, where `ls` on an
  # unmatched glob exits 1 and takes the whole pipeline down under
  # `pipefail`.
  find "${MIGRATIONS_DIR}" -maxdepth 1 -name '[0-9]*.sql' 2>/dev/null | sort
}

# Stop before touching the database when there is nothing to apply from.
# A wrong MIGRATIONS_DIR would otherwise sail through as "0 applied" and
# hand back a green deploy on an unmigrated schema — the exact failure
# this script exists to prevent.
verify_migrations_directory() {
  if [ ! -d "${MIGRATIONS_DIR}" ]; then
    log "ERROR: no migrations directory at ${MIGRATIONS_DIR}"
    log "  Set MIGRATIONS_DIR, or REPO_DIR when the checkout lives"
    log "  somewhere other than /opt/vocion."
    exit 1
  fi
  local file_count
  file_count=$(list_migration_files | wc -l | tr -d ' ')
  if [ "${file_count}" -eq 0 ]; then
    log "ERROR: ${MIGRATIONS_DIR} holds no migration files."
    log "  packages/core/migrations is never empty, so this is a wrong"
    log "  path rather than an empty migration set. Refusing to report a"
    log "  successful migration run."
    exit 1
  fi
  log "${file_count} migration file(s) in ${MIGRATIONS_DIR}"
}

# 1-based position of a migration file in apply order, by exact name.
# Prints nothing and returns 1 when the name matches no file.
find_migration_position() {
  local wanted="$1"
  local position=0
  local sql_file
  while IFS= read -r sql_file; do
    position=$((position + 1))
    if [ "$(basename "${sql_file}")" = "${wanted}" ]; then
      printf '%s' "${position}"
      return 0
    fi
  done < <(list_migration_files)
  return 1
}

count_tracked_migrations() {
  local table_exists
  # Under --check the tracking table may not exist yet, since --check
  # does not create it. Same one-statement-at-a-time reason as the
  # drizzle probe below.
  table_exists=$(run_sql -tA -c \
    "SELECT to_regclass('public.__pgsql_migrations') IS NOT NULL;")
  if [ "${table_exists}" != "t" ]; then
    echo 0
    return 0
  fi
  run_sql -tA -c "SELECT count(*) FROM __pgsql_migrations;"
}

# True when the database already holds application tables. Used to tell
# a genuinely empty database (safe to migrate from zero) apart from one
# that was migrated by some other route before this script existed.
database_has_application_tables() {
  local table_count query_status
  # Exact name, not `NOT LIKE '__%migrations'` — `_` is a LIKE wildcard,
  # so that pattern also excluded real tables such as `db_migrations`.
  table_count=$(run_sql -tA -c "
    SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name <> '__pgsql_migrations';
  ")
  query_status=$?
  # This function is called as the right operand of `&&`, where `set -e`
  # is suspended, so a failed query has to be handled here or the script
  # would decide the schema is empty without having read it.
  if [ "${query_status}" -ne 0 ] || [ -z "${table_count}" ]; then
    log "ERROR: could not read the table list of database '${DB_NAME}'."
    exit 1
  fi
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
  if [ "${CHECK_ONLY}" = true ]; then
    return 0
  fi
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
  # The operator's explicit position is read first. Drizzle's history is
  # only a floor: a database migrated by drizzle through 0010 and then
  # by hand through 0042 would otherwise be baselined at 10 and die
  # replaying 0011, with the operator's MIGRATIONS_BASELINE ignored.
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
    through=$(find_migration_position "${MIGRATIONS_BASELINE}" || true)
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

  local drizzle_count
  drizzle_count=$(count_drizzle_migrations)
  if [ "${drizzle_count}" -gt 0 ]; then
    log "schema exists and drizzle recorded ${drizzle_count} migration(s);"
    log "  treating the first ${drizzle_count} file(s) as already applied"
    record_first_n_as_applied "${drizzle_count}"
    return 0
  fi

  log "ERROR: database '${DB_NAME}' already has application tables but"
  log "  __pgsql_migrations is empty, so this script cannot tell which"
  log "  migrations ran. Replaying them all would fail on the first file."
  log ""
  log "  Work out where the schema stands, then say so once:"
  log "    - the app is healthy on the current checkout, so the schema is"
  log "      up to date:   sudo bash $0 --baseline all"
  log "    - migrations were applied by hand up to a known file:"
  log "                    sudo bash $0 --baseline 0042_thing.sql"
  log ""
  log "  To find that file, open the newest migrations in ${MIGRATIONS_DIR}"
  log "  and check whether what they create already exists:"
  log "    sudo docker exec ${CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} \\"
  log "      -c '\\d <table the migration creates>'"
  log ""
  log "  'sudo bash $0 --check' reports what any of this would do without"
  log "  writing anything."
  return 1
}

apply_pending_migrations() {
  local applied=0
  local skipped=0
  local sql_file name already
  # --check does not create the tracking table, so it may legitimately be
  # absent here; then nothing is recorded and every file counts as pending.
  local tracking_present
  tracking_present=$(run_sql -tA -c \
    "SELECT to_regclass('public.__pgsql_migrations') IS NOT NULL;")
  while IFS= read -r sql_file; do
    name=$(basename "${sql_file}")
    already=""
    if [ "${tracking_present}" = "t" ]; then
      already=$(run_sql -tA -c \
        "SELECT 1 FROM __pgsql_migrations WHERE name = '${name}';")
    fi
    if [ "${already}" = "1" ]; then
      skipped=$((skipped + 1))
      continue
    fi
    if [ "${CHECK_ONLY}" = true ]; then
      log "would apply ${name}"
      applied=$((applied + 1))
      continue
    fi
    log "applying ${name}"
    # --single-transaction so a mid-file error rolls the whole file
    # back; without it a failure leaves half a migration in place.
    #
    # CREATE INDEX CONCURRENTLY is the exception: Postgres refuses to run
    # it inside a transaction block, so such a file is applied unwrapped.
    # ON_ERROR_STOP still halts it on the first error, but a later
    # statement failing leaves the earlier ones in place — the log says
    # so, because recovery then needs a human.
    local transaction_flag="--single-transaction"
    if grep -qiE '\bCONCURRENTLY\b' "${sql_file}"; then
      transaction_flag=""
      log "  ${name} uses CONCURRENTLY — applying without a transaction;"
      log "  a partial failure in this file will not roll back"
    fi
    if sudo docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" \
      -v ON_ERROR_STOP=1 ${transaction_flag} < "${sql_file}" >/dev/null; then
      record_migration_as_applied "${name}"
      applied=$((applied + 1))
    else
      if [ -n "${transaction_flag}" ]; then
        log "  x ${name} FAILED — nothing from this file was applied."
      else
        log "  x ${name} FAILED — it ran without a transaction, so check"
        log "    which statements landed before re-running."
      fi
      log "${applied} applied · ${skipped} already-applied · 1 failed"
      return 1
    fi
  done < <(list_migration_files)
  log "${applied} applied · ${skipped} already-applied · 0 failed"
}

parse_arguments "$@"

if [ "${CHECK_ONLY}" = true ]; then
  log "--check: reporting only, nothing will be written"
fi

verify_migrations_directory
wait_for_postgres
create_tracking_table

if [ "$(count_tracked_migrations)" -eq 0 ] && database_has_application_tables; then
  baseline_pre_existing_schema
fi

apply_pending_migrations
