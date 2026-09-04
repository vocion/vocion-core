#!/usr/bin/env bash
# infra/aws/deploy-scripts.test.sh — integration tests for the deploy path.
#
# Covers apply-migrations.sh against a real Postgres container, update.sh
# against fake `docker`/`git` binaries, and static assertions on the
# shapes that regressed before: migrations running after the container
# roll, and migration failures being swallowed.
#
# Nothing here touches a real deployment. It starts its own throwaway
# pgvector container, works inside a temp directory, and removes both on
# exit.
#
#   bash infra/aws/deploy-scripts.test.sh
#
# Requires a working local Docker daemon and network access to pull
# pgvector/pgvector:pg16 the first time.

# Deliberately no `set -e`: most tests assert on a non-zero exit code.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_CONTAINER="vocion-deploy-scripts-test-pg"
TEST_IMAGE="pgvector/pgvector:pg16"
DB_NAME="vocion"
DB_USER="postgres"
REAL_DOCKER="$(command -v docker)"

WORK_DIR="$(mktemp -d)"
SHIM_DIR="${WORK_DIR}/shim"
FAKE_DOCKER_DIR="${WORK_DIR}/fake-docker-shim"
MIGRATIONS_FIXTURE="${WORK_DIR}/migrations"
FIXTURE_REPO="${WORK_DIR}/repo"
CALL_LOG="${WORK_DIR}/calls.log"

tests_passed=0
tests_failed=0
failed_names=()

# ----------------------------------------------------------------------
# Reporting
# ----------------------------------------------------------------------

pass() {
  tests_passed=$((tests_passed + 1))
  echo "  ok   $1"
}

fail() {
  tests_failed=$((tests_failed + 1))
  failed_names+=("$1")
  echo "  FAIL $1"
  if [ -n "${2:-}" ]; then
    echo "       $2"
  fi
}

check_exit_code() {
  local label="$1" expected="$2" actual="$3"
  if [ "${expected}" = "nonzero" ]; then
    if [ "${actual}" -ne 0 ]; then
      pass "${label}"
    else
      fail "${label}" "expected a non-zero exit, got 0"
    fi
  elif [ "${actual}" = "${expected}" ]; then
    pass "${label}"
  else
    fail "${label}" "expected exit ${expected}, got ${actual}"
  fi
}

check_contains() {
  local label="$1" haystack="$2" needle="$3"
  if printf '%s' "${haystack}" | grep -qF -- "${needle}"; then
    pass "${label}"
  else
    fail "${label}" "output is missing: ${needle}"
  fi
}

check_absent() {
  local label="$1" haystack="$2" needle="$3"
  if printf '%s' "${haystack}" | grep -qF -- "${needle}"; then
    fail "${label}" "output should not contain: ${needle}"
  else
    pass "${label}"
  fi
}

# Assert that `first` appears on an earlier line than `second`.
check_order() {
  local label="$1" haystack="$2" first="$3" second="$4"
  local first_line second_line
  first_line=$(printf '%s' "${haystack}" | grep -nF -- "${first}" | head -1 | cut -d: -f1)
  second_line=$(printf '%s' "${haystack}" | grep -nF -- "${second}" | head -1 | cut -d: -f1)
  if [ -z "${first_line}" ] || [ -z "${second_line}" ]; then
    fail "${label}" "one of the two markers never appeared"
    return
  fi
  if [ "${first_line}" -lt "${second_line}" ]; then
    pass "${label}"
  else
    fail "${label}" "'${first}' (line ${first_line}) did not precede '${second}' (line ${second_line})"
  fi
}

# ----------------------------------------------------------------------
# Test Postgres lifecycle
# ----------------------------------------------------------------------

start_test_postgres() {
  "${REAL_DOCKER}" rm -f "${TEST_CONTAINER}" >/dev/null 2>&1
  "${REAL_DOCKER}" run -d --name "${TEST_CONTAINER}" \
    -e POSTGRES_USER="${DB_USER}" \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB="${DB_NAME}" \
    "${TEST_IMAGE}" >/dev/null || return 1
  local attempt=1
  while [ "${attempt}" -le 60 ]; do
    if "${REAL_DOCKER}" exec "${TEST_CONTAINER}" \
      pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
  echo "test Postgres never became ready" >&2
  return 1
}

# Drop and recreate the database so each test starts from a known state.
reset_database() {
  "${REAL_DOCKER}" exec "${TEST_CONTAINER}" psql -U "${DB_USER}" -d postgres -q \
    -c "DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE);" \
    -c "CREATE DATABASE ${DB_NAME};" >/dev/null 2>&1
}

query_test_database() {
  "${REAL_DOCKER}" exec "${TEST_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -tA -c "$1" 2>/dev/null | tr -d '[:space:]'
}

clean_up() {
  "${REAL_DOCKER}" rm -f "${TEST_CONTAINER}" >/dev/null 2>&1
  rm -rf "${WORK_DIR}"
}

# ----------------------------------------------------------------------
# Fixtures
# ----------------------------------------------------------------------

# A passthrough `sudo`, since the deploy scripts call `sudo docker` and a
# test run must not need a password prompt.
write_sudo_shim() {
  mkdir -p "${SHIM_DIR}"
  printf '#!/bin/sh\nexec "$@"\n' > "${SHIM_DIR}/sudo"
  chmod +x "${SHIM_DIR}/sudo"
}

# Fakes for update.sh: `git` and image/compose work are recorded and
# skipped, while `docker exec` is forwarded to the real daemon so the
# migration step genuinely runs against the test container.
write_fake_docker_shim() {
  mkdir -p "${FAKE_DOCKER_DIR}"
  cp "${SHIM_DIR}/sudo" "${FAKE_DOCKER_DIR}/sudo"
  cat > "${FAKE_DOCKER_DIR}/docker" <<FAKE
#!/usr/bin/env bash
echo "docker \$*" >> "${CALL_LOG}"
if [ "\$1" = "exec" ]; then
  exec "${REAL_DOCKER}" "\$@"
fi
exit 0
FAKE
  cat > "${FAKE_DOCKER_DIR}/git" <<FAKE
#!/usr/bin/env bash
echo "git \$*" >> "${CALL_LOG}"
exit 0
FAKE
  # bootstrap.sh probes whether the data directory is a mount point.
  # Reporting "no" keeps it off the docker data-root migration path,
  # which would rewrite /etc/docker/daemon.json.
  printf '#!/bin/sh\nexit 1\n' > "${FAKE_DOCKER_DIR}/mountpoint"
  chmod +x "${FAKE_DOCKER_DIR}/docker" "${FAKE_DOCKER_DIR}/git" \
    "${FAKE_DOCKER_DIR}/mountpoint"
}

write_migration() {
  mkdir -p "${MIGRATIONS_FIXTURE}"
  printf '%s\n' "$2" > "${MIGRATIONS_FIXTURE}/$1"
}

clear_migrations() {
  rm -rf "${MIGRATIONS_FIXTURE}"
  mkdir -p "${MIGRATIONS_FIXTURE}"
}

# A repo-shaped directory update.sh can be pointed at with REPO_DIR.
build_fixture_repo() {
  mkdir -p "${FIXTURE_REPO}/infra/aws" "${FIXTURE_REPO}/packages/core/migrations"
  printf '%s\n' 'CREATE TABLE "from_repo_dir" ("id" text PRIMARY KEY NOT NULL);' \
    > "${FIXTURE_REPO}/packages/core/migrations/0000_from_repo_dir.sql"
  cp "${SCRIPT_DIR}/apply-migrations.sh" "${FIXTURE_REPO}/infra/aws/"
  cp "${SCRIPT_DIR}/update.sh" "${FIXTURE_REPO}/infra/aws/"
  cp "${SCRIPT_DIR}/bootstrap.sh" "${FIXTURE_REPO}/infra/aws/"
  # A .git directory so bootstrap.sh takes the "already cloned" path.
  mkdir -p "${FIXTURE_REPO}/.git"
  write_fixture_env_file
}

# The env file both scripts read. LANGFUSE_SELF_HOSTED_REPLICAS=0 puts
# bootstrap.sh on the Langfuse Cloud path, which skips its long
# self-hosting precondition check.
write_fixture_env_file() {
  cat > "${FIXTURE_REPO}/infra/aws/.env.production" <<ENV
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_fixture
NEXT_PUBLIC_APP_URL=https://fixture.example
VOCION_HOSTNAME=fixture.example
LANGFUSE_SELF_HOSTED_REPLICAS=0
LANGFUSE_BASE_URL=https://cloud.langfuse.example
LANGFUSE_PUBLIC_KEY=pk-lf-fixture
LANGFUSE_SECRET_KEY=sk-lf-fixture
ENV
}

# ----------------------------------------------------------------------
# Runners — capture combined output and exit code without tripping set -e
# ----------------------------------------------------------------------

APPLIER_OUTPUT=""
APPLIER_EXIT=0

# run_applier [VAR=value ...]
run_applier() {
  APPLIER_OUTPUT=$(
    env PATH="${SHIM_DIR}:${PATH}" \
      POSTGRES_CONTAINER="${TEST_CONTAINER}" \
      POSTGRES_DB="${DB_NAME}" \
      POSTGRES_USER="${DB_USER}" \
      MIGRATIONS_DIR="${MIGRATIONS_FIXTURE}" \
      "$@" \
      bash "${SCRIPT_DIR}/apply-migrations.sh" 2>&1
  )
  APPLIER_EXIT=$?
}

# run_applier_with_flags <script arguments...> — command-line flags
# rather than environment variables.
run_applier_with_flags() {
  APPLIER_OUTPUT=$(
    env PATH="${SHIM_DIR}:${PATH}" \
      POSTGRES_CONTAINER="${TEST_CONTAINER}" \
      POSTGRES_DB="${DB_NAME}" \
      POSTGRES_USER="${DB_USER}" \
      MIGRATIONS_DIR="${MIGRATIONS_FIXTURE}" \
      bash "${SCRIPT_DIR}/apply-migrations.sh" "$@" 2>&1
  )
  APPLIER_EXIT=$?
}

# Same, but without MIGRATIONS_DIR, so the applier falls back to its
# REPO_DIR-derived default.
run_applier_using_repo_dir() {
  APPLIER_OUTPUT=$(
    env PATH="${SHIM_DIR}:${PATH}" \
      POSTGRES_CONTAINER="${TEST_CONTAINER}" \
      POSTGRES_DB="${DB_NAME}" \
      POSTGRES_USER="${DB_USER}" \
      REPO_DIR="${FIXTURE_REPO}" \
      "$@" \
      bash "${SCRIPT_DIR}/apply-migrations.sh" 2>&1
  )
  APPLIER_EXIT=$?
}

UPDATE_OUTPUT=""
UPDATE_EXIT=0

run_update_script() {
  : > "${CALL_LOG}"
  UPDATE_OUTPUT=$(
    env PATH="${FAKE_DOCKER_DIR}:${PATH}" \
      REPO_DIR="${FIXTURE_REPO}" \
      POSTGRES_CONTAINER="${TEST_CONTAINER}" \
      POSTGRES_DB="${DB_NAME}" \
      POSTGRES_USER="${DB_USER}" \
      MIGRATIONS_DIR="${MIGRATIONS_FIXTURE}" \
      DEPLOY_CALL_LOG="${CALL_LOG}" \
      bash "${FIXTURE_REPO}/infra/aws/update.sh" 2>&1
  )
  UPDATE_EXIT=$?
}

BOOTSTRAP_OUTPUT=""
BOOTSTRAP_EXIT=0

run_bootstrap_script() {
  : > "${CALL_LOG}"
  BOOTSTRAP_OUTPUT=$(
    env PATH="${FAKE_DOCKER_DIR}:${PATH}" \
      REPO_DIR="${FIXTURE_REPO}" \
      DATA_DIR="${WORK_DIR}/data" \
      POSTGRES_CONTAINER="${TEST_CONTAINER}" \
      POSTGRES_DB="${DB_NAME}" \
      POSTGRES_USER="${DB_USER}" \
      MIGRATIONS_DIR="${MIGRATIONS_FIXTURE}" \
      DEPLOY_CALL_LOG="${CALL_LOG}" \
      bash "${FIXTURE_REPO}/infra/aws/bootstrap.sh" 2>&1
  )
  BOOTSTRAP_EXIT=$?
}

# ----------------------------------------------------------------------
# Migration fixture SQL. Deliberately non-idempotent `CREATE TABLE`,
# matching what drizzle-kit generates.
# ----------------------------------------------------------------------

FIRST_MIGRATION='CREATE TABLE "organization" ("id" text PRIMARY KEY NOT NULL);'
SECOND_MIGRATION='CREATE TABLE "todo" ("id" text PRIMARY KEY NOT NULL);'
THIRD_MIGRATION='CREATE TABLE "project" ("id" text PRIMARY KEY NOT NULL);'
# First statement succeeds, second collides — proves the whole file rolls back.
PARTIAL_FAILURE_MIGRATION='CREATE TABLE "half_applied" ("id" text PRIMARY KEY NOT NULL);
CREATE TABLE "organization" ("id" text PRIMARY KEY NOT NULL);'

seed_two_pending_migrations() {
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  write_migration 0001_second.sql "${SECOND_MIGRATION}"
}

# ----------------------------------------------------------------------
# apply-migrations.sh tests
# ----------------------------------------------------------------------

test_fresh_database_applies_every_migration() {
  echo "apply-migrations: fresh database"
  reset_database
  seed_two_pending_migrations
  run_applier
  check_exit_code "fresh apply exits 0" 0 "${APPLIER_EXIT}"
  check_contains "reports both applied" "${APPLIER_OUTPUT}" "2 applied · 0 already-applied · 0 failed"
  local tables
  tables=$(query_test_database "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('organization','todo');")
  if [ "${tables}" = "2" ]; then
    pass "both tables exist"
  else
    fail "both tables exist" "found ${tables} of 2"
  fi
}

# Deliberately continues from the previous test's database and files:
# idempotency, incremental apply, failure and retry are one sequence.
test_rerun_is_idempotent() {
  echo "apply-migrations: re-run"
  run_applier
  check_exit_code "re-run exits 0" 0 "${APPLIER_EXIT}"
  check_contains "skips already-applied files" "${APPLIER_OUTPUT}" "0 applied · 2 already-applied · 0 failed"
}

test_only_new_migration_is_applied() {
  echo "apply-migrations: one new file"
  write_migration 0002_third.sql "${THIRD_MIGRATION}"
  run_applier
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "applies only the new file" "${APPLIER_OUTPUT}" "1 applied · 2 already-applied · 0 failed"
  check_contains "names the file it applied" "${APPLIER_OUTPUT}" "applying 0002_third.sql"
}

test_failing_migration_aborts_and_rolls_back() {
  echo "apply-migrations: failing migration"
  write_migration 0003_broken.sql "${PARTIAL_FAILURE_MIGRATION}"
  run_applier
  check_exit_code "exits non-zero" nonzero "${APPLIER_EXIT}"
  check_contains "says which file failed" "${APPLIER_OUTPUT}" "0003_broken.sql FAILED"
  check_contains "surfaces the psql error" "${APPLIER_OUTPUT}" "already exists"
  local half
  half=$(query_test_database "SELECT count(*) FROM information_schema.tables WHERE table_name = 'half_applied';")
  if [ "${half}" = "0" ]; then
    pass "the successful half of the file rolled back"
  else
    fail "the successful half of the file rolled back" "half_applied table survived"
  fi
  local tracked
  tracked=$(query_test_database "SELECT count(*) FROM __pgsql_migrations WHERE name = '0003_broken.sql';")
  if [ "${tracked}" = "0" ]; then
    pass "the failed file is not recorded as applied"
  else
    fail "the failed file is not recorded as applied" "found a tracking row"
  fi
}

test_retry_after_fixing_the_migration() {
  echo "apply-migrations: retry after fix"
  write_migration 0003_broken.sql 'CREATE TABLE "now_valid" ("id" text PRIMARY KEY NOT NULL);'
  run_applier
  check_exit_code "exits 0 once the file is valid" 0 "${APPLIER_EXIT}"
  check_contains "applies the fixed file" "${APPLIER_OUTPUT}" "1 applied · 3 already-applied · 0 failed"
}

test_missing_migrations_directory_fails() {
  echo "apply-migrations: migrations directory does not exist"
  reset_database
  run_applier MIGRATIONS_DIR="${WORK_DIR}/no-such-directory"
  check_exit_code "exits non-zero" nonzero "${APPLIER_EXIT}"
  check_contains "names the path it looked at" "${APPLIER_OUTPUT}" \
    "no migrations directory at ${WORK_DIR}/no-such-directory"
  check_absent "does not claim a successful run" "${APPLIER_OUTPUT}" "0 failed"
}

test_empty_migrations_directory_fails() {
  echo "apply-migrations: migrations directory holds no files"
  reset_database
  clear_migrations
  run_applier
  check_exit_code "exits non-zero" nonzero "${APPLIER_EXIT}"
  check_contains "explains that this is a wrong path" "${APPLIER_OUTPUT}" \
    "holds no migration files"
  check_absent "does not claim a successful run" "${APPLIER_OUTPUT}" "0 failed"
}

test_migrations_directory_follows_repo_dir() {
  echo "apply-migrations: MIGRATIONS_DIR defaults from REPO_DIR"
  reset_database
  run_applier_using_repo_dir
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "reads the checkout's own migrations" "${APPLIER_OUTPUT}" \
    "1 migration file(s) in ${FIXTURE_REPO}/packages/core/migrations"
  check_contains "applies that file" "${APPLIER_OUTPUT}" "applying 0000_from_repo_dir.sql"
}

test_existing_schema_without_tracking_refuses() {
  echo "apply-migrations: pre-existing schema, no baseline"
  reset_database
  query_test_database 'CREATE TABLE "organization" ("id" text PRIMARY KEY NOT NULL);' >/dev/null
  seed_two_pending_migrations
  run_applier
  check_exit_code "exits non-zero" nonzero "${APPLIER_EXIT}"
  check_contains "explains why it stopped" "${APPLIER_OUTPUT}" "already has application tables"
  check_contains "names the escape hatch" "${APPLIER_OUTPUT}" "--baseline all"
  check_absent "does not replay the first migration" "${APPLIER_OUTPUT}" "applying 0000_first.sql"
}

test_baseline_all_marks_everything_applied() {
  echo "apply-migrations: MIGRATIONS_BASELINE=all"
  run_applier MIGRATIONS_BASELINE=all
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "baselines every file" "${APPLIER_OUTPUT}" "baselined 2 migration(s) as already applied"
  local tracked
  tracked=$(query_test_database "SELECT count(*) FROM __pgsql_migrations;")
  if [ "${tracked}" = "2" ]; then
    pass "both files are recorded"
  else
    fail "both files are recorded" "found ${tracked} tracking rows"
  fi
}

test_baseline_by_file_name_applies_the_rest() {
  echo "apply-migrations: MIGRATIONS_BASELINE=<file>"
  reset_database
  query_test_database 'CREATE TABLE "organization" ("id" text PRIMARY KEY NOT NULL);' >/dev/null
  seed_two_pending_migrations
  run_applier MIGRATIONS_BASELINE=0000_first.sql
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "baselines through the named file" "${APPLIER_OUTPUT}" "baselined 1 migration(s) as already applied"
  check_contains "applies what came after it" "${APPLIER_OUTPUT}" "applying 0001_second.sql"
  local todo_exists
  todo_exists=$(query_test_database "SELECT count(*) FROM information_schema.tables WHERE table_name = 'todo';")
  if [ "${todo_exists}" = "1" ]; then
    pass "the later migration really ran"
  else
    fail "the later migration really ran" "todo table is missing"
  fi
}

test_unknown_baseline_name_is_rejected() {
  echo "apply-migrations: unknown MIGRATIONS_BASELINE"
  reset_database
  query_test_database 'CREATE TABLE "organization" ("id" text PRIMARY KEY NOT NULL);' >/dev/null
  seed_two_pending_migrations
  run_applier MIGRATIONS_BASELINE=9999_nope.sql
  check_exit_code "exits non-zero" nonzero "${APPLIER_EXIT}"
  check_contains "says the name matched nothing" "${APPLIER_OUTPUT}" "matches no file"
}

test_drizzle_history_baselines_automatically() {
  echo "apply-migrations: baseline from drizzle history"
  reset_database
  query_test_database 'CREATE TABLE "organization" ("id" text PRIMARY KEY NOT NULL);' >/dev/null
  query_test_database "CREATE SCHEMA drizzle;
    CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text, created_at bigint);
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('hash-0000', 1);" >/dev/null
  seed_two_pending_migrations
  run_applier
  check_exit_code "exits 0 without an operator flag" 0 "${APPLIER_EXIT}"
  check_contains "reads drizzle's row count" "${APPLIER_OUTPUT}" "drizzle recorded 1 migration(s)"
  check_contains "applies the remaining file" "${APPLIER_OUTPUT}" "applying 0001_second.sql"
  check_absent "does not replay the baselined file" "${APPLIER_OUTPUT}" "applying 0000_first.sql"
}

test_explicit_baseline_overrides_drizzle_history() {
  echo "apply-migrations: MIGRATIONS_BASELINE beats drizzle history"
  reset_database
  query_test_database 'CREATE TABLE "organization" ("id" text PRIMARY KEY NOT NULL);' >/dev/null
  query_test_database 'CREATE TABLE "todo" ("id" text PRIMARY KEY NOT NULL);' >/dev/null
  query_test_database "CREATE SCHEMA drizzle;
    CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text, created_at bigint);
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('hash-0000', 1);" >/dev/null
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  write_migration 0001_second.sql "${SECOND_MIGRATION}"
  write_migration 0002_third.sql "${THIRD_MIGRATION}"
  # Drizzle stopped at 0000; a person applied 0001 by hand. Baselining
  # from drizzle's single row would replay 0001 and fail.
  run_applier MIGRATIONS_BASELINE=0001_second.sql
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "uses the operator's position" "${APPLIER_OUTPUT}" \
    "baselined 2 migration(s) as already applied"
  check_absent "ignores the drizzle row count" "${APPLIER_OUTPUT}" "drizzle recorded"
  check_contains "applies only what follows" "${APPLIER_OUTPUT}" "applying 0002_third.sql"
}

test_baseline_is_ignored_on_an_empty_database() {
  echo "apply-migrations: baseline flag on an empty database"
  reset_database
  seed_two_pending_migrations
  run_applier MIGRATIONS_BASELINE=all
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "applies everything instead of baselining" "${APPLIER_OUTPUT}" "2 applied · 0 already-applied · 0 failed"
}

test_baseline_flag_matches_the_env_var() {
  echo "apply-migrations: --baseline flag"
  reset_database
  query_test_database 'CREATE TABLE "organization" ("id" text PRIMARY KEY NOT NULL);' >/dev/null
  seed_two_pending_migrations
  run_applier_with_flags --baseline all
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "baselines every file" "${APPLIER_OUTPUT}" "treating all 2 file(s) as applied"
  local tracked
  tracked=$(query_test_database "SELECT count(*) FROM __pgsql_migrations;")
  if [ "${tracked}" = "2" ]; then
    pass "both files recorded"
  else
    fail "both files recorded" "found ${tracked} tracking rows"
  fi
}

test_baseline_flag_accepts_a_file_name() {
  echo "apply-migrations: --baseline <file>"
  reset_database
  query_test_database 'CREATE TABLE "organization" ("id" text PRIMARY KEY NOT NULL);' >/dev/null
  seed_two_pending_migrations
  run_applier_with_flags --baseline=0000_first.sql
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "baselines through the named file" "${APPLIER_OUTPUT}" \
    "baselined 1 migration(s) as already applied"
  check_contains "applies the rest" "${APPLIER_OUTPUT}" "applying 0001_second.sql"
}

test_baseline_flag_without_a_value_is_rejected() {
  echo "apply-migrations: --baseline with no value"
  run_applier_with_flags --baseline
  check_exit_code "exits non-zero" nonzero "${APPLIER_EXIT}"
  check_contains "explains what it wanted" "${APPLIER_OUTPUT}" "needs a migration file name"
}

test_unknown_flag_is_rejected() {
  echo "apply-migrations: unknown flag"
  run_applier_with_flags --nope
  check_exit_code "exits non-zero" nonzero "${APPLIER_EXIT}"
  check_contains "names the argument" "${APPLIER_OUTPUT}" "unknown argument '--nope'"
  check_contains "prints usage" "${APPLIER_OUTPUT}" "Usage: apply-migrations.sh"
}

test_check_mode_writes_nothing() {
  echo "apply-migrations: --check"
  reset_database
  seed_two_pending_migrations
  run_applier_with_flags --check
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "says it is reporting only" "${APPLIER_OUTPUT}" "nothing will be written"
  check_contains "reports what it would apply" "${APPLIER_OUTPUT}" "would apply 0000_first.sql"
  check_absent "does not apply anything" "${APPLIER_OUTPUT}" "applying 0000_first.sql"
  local created tracking
  created=$(query_test_database "SELECT count(*) FROM information_schema.tables WHERE table_name = 'organization';")
  tracking=$(query_test_database "SELECT to_regclass('public.__pgsql_migrations') IS NOT NULL;")
  if [ "${created}" = "0" ]; then
    pass "no migration was applied"
  else
    fail "no migration was applied" "organization table exists"
  fi
  if [ "${tracking}" = "f" ]; then
    pass "no tracking table was created"
  else
    fail "no tracking table was created" "__pgsql_migrations exists"
  fi
}

test_check_mode_reports_the_baseline_refusal() {
  echo "apply-migrations: --check on a schema needing a baseline"
  reset_database
  query_test_database 'CREATE TABLE "organization" ("id" text PRIMARY KEY NOT NULL);' >/dev/null
  seed_two_pending_migrations
  run_applier_with_flags --check
  check_exit_code "exits non-zero" nonzero "${APPLIER_EXIT}"
  check_contains "offers the flag form" "${APPLIER_OUTPUT}" "--baseline all"
  check_contains "shows how to locate the last applied file" "${APPLIER_OUTPUT}" "psql -U postgres"
}

test_concurrently_migration_runs_without_a_transaction() {
  echo "apply-migrations: CREATE INDEX CONCURRENTLY"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  write_migration 0001_concurrent_index.sql \
    'CREATE INDEX CONCURRENTLY "organization_id_idx" ON "organization" ("id");'
  run_applier
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "says why the file ran unwrapped" "${APPLIER_OUTPUT}" \
    "uses CONCURRENTLY — applying without a transaction"
  check_contains "applies both files" "${APPLIER_OUTPUT}" "2 applied · 0 already-applied · 0 failed"
  local index_exists
  index_exists=$(query_test_database "SELECT count(*) FROM pg_indexes WHERE indexname = 'organization_id_idx';")
  if [ "${index_exists}" = "1" ]; then
    pass "the concurrent index really exists"
  else
    fail "the concurrent index really exists" "index is missing"
  fi
}

test_unreachable_container_fails_loudly() {
  echo "apply-migrations: unreachable container"
  run_applier POSTGRES_CONTAINER=vocion-no-such-container POSTGRES_READINESS_ATTEMPTS=2
  check_exit_code "exits non-zero" nonzero "${APPLIER_EXIT}"
  check_contains "retries before giving up" "${APPLIER_OUTPUT}" "attempt 2/2"
  check_contains "names the container" "${APPLIER_OUTPUT}" "never accepted connections"
}

test_default_container_and_database_match_compose() {
  echo "apply-migrations: defaults match docker-compose.yml"
  local compose_file="${SCRIPT_DIR}/../../docker-compose.yml"
  local compose_container compose_database
  compose_container=$(grep -A6 'image: pgvector/pgvector' "${compose_file}" | grep 'container_name:' | head -1 | awk '{print $2}')
  compose_database=$(grep -E '^\s+POSTGRES_DB:' "${compose_file}" | head -1 | awk '{print $2}')
  if grep -qF "POSTGRES_CONTAINER:-${compose_container}}" "${SCRIPT_DIR}/apply-migrations.sh"; then
    pass "container default is ${compose_container}"
  else
    fail "container default is ${compose_container}" "apply-migrations.sh defaults elsewhere"
  fi
  if grep -qF "POSTGRES_DB:-${compose_database}}" "${SCRIPT_DIR}/apply-migrations.sh"; then
    pass "database default is ${compose_database}"
  else
    fail "database default is ${compose_database}" "apply-migrations.sh defaults elsewhere"
  fi
}

# ----------------------------------------------------------------------
# update.sh tests
# ----------------------------------------------------------------------

test_update_migrates_before_rolling_containers() {
  echo "update.sh: happy path"
  reset_database
  seed_two_pending_migrations
  run_update_script
  check_exit_code "exits 0" 0 "${UPDATE_EXIT}"
  check_order "migrations run before the container roll" "${UPDATE_OUTPUT}" \
    "applying any new migrations" "rolling app + worker"
  check_order "the image is built before migrations run" "${UPDATE_OUTPUT}" \
    "rebuilding vocion-app image" "applying any new migrations"
  check_contains "reaches the end" "${UPDATE_OUTPUT}" "done."
  check_contains "rolls app and worker" "$(cat "${CALL_LOG}")" "up -d --no-deps app worker"
}

test_update_reads_env_from_infra_aws() {
  echo "update.sh: build-time env file"
  reset_database
  seed_two_pending_migrations
  run_update_script
  check_exit_code "exits 0" 0 "${UPDATE_EXIT}"
  check_contains "reports the env file it read" "${UPDATE_OUTPUT}" \
    "reading build-time env from ${FIXTURE_REPO}/infra/aws/.env.production"
  check_contains "passes the Clerk key as a build arg" "$(cat "${CALL_LOG}")" \
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_fixture"
}

test_update_aborts_on_migration_failure() {
  echo "update.sh: failing migration"
  reset_database
  seed_two_pending_migrations
  run_update_script >/dev/null
  write_migration 0002_broken.sql "${PARTIAL_FAILURE_MIGRATION}"
  run_update_script
  check_exit_code "exits non-zero" nonzero "${UPDATE_EXIT}"
  check_absent "never reports success" "${UPDATE_OUTPUT}" "done."
  check_absent "never rolls the containers" "${UPDATE_OUTPUT}" "rolling app + worker"
  check_absent "no compose roll was issued" "$(cat "${CALL_LOG}")" "up -d --no-deps app worker"
}

test_update_with_no_pending_migrations_still_rolls() {
  echo "update.sh: nothing to migrate"
  rm -f "${MIGRATIONS_FIXTURE}/0002_broken.sql"
  run_update_script
  check_exit_code "exits 0" 0 "${UPDATE_EXIT}"
  check_contains "reports nothing pending" "${UPDATE_OUTPUT}" "0 applied · 2 already-applied · 0 failed"
  check_contains "still rolls the containers" "${UPDATE_OUTPUT}" "rolling app + worker"
  check_contains "reaches the end" "${UPDATE_OUTPUT}" "done."
}

test_update_fails_without_an_env_file() {
  echo "update.sh: missing env file"
  local saved="${WORK_DIR}/saved.env"
  mv "${FIXTURE_REPO}/infra/aws/.env.production" "${saved}"
  run_update_script
  check_exit_code "exits non-zero" nonzero "${UPDATE_EXIT}"
  check_contains "explains what is missing" "${UPDATE_OUTPUT}" "no .env.production found"
  check_absent "does not build a keyless image" "$(cat "${CALL_LOG}")" "docker build"
  mv "${saved}" "${FIXTURE_REPO}/infra/aws/.env.production"
}

test_update_fails_when_a_required_build_value_is_missing() {
  echo "update.sh: env file without the Clerk key"
  local env_file="${FIXTURE_REPO}/infra/aws/.env.production"
  local saved="${WORK_DIR}/saved-complete.env"
  cp "${env_file}" "${saved}"
  printf 'NEXT_PUBLIC_APP_URL=https://fixture.example\n' > "${env_file}"
  run_update_script
  check_exit_code "exits non-zero" nonzero "${UPDATE_EXIT}"
  check_contains "names the missing value" "${UPDATE_OUTPUT}" \
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is missing"
  check_absent "does not build a keyless image" "$(cat "${CALL_LOG}")" "docker build"
  cp "${saved}" "${env_file}"
}

test_update_tolerates_missing_optional_values() {
  echo "update.sh: env file without the optional Langfuse values"
  run_update_script
  check_exit_code "exits 0" 0 "${UPDATE_EXIT}"
  check_contains "still builds" "$(cat "${CALL_LOG}")" "docker build"
  check_contains "reaches the end" "${UPDATE_OUTPUT}" "done."
}

test_update_warns_when_both_env_files_exist() {
  echo "update.sh: two env files present"
  cp "${FIXTURE_REPO}/infra/aws/.env.production" "${FIXTURE_REPO}/.env.production"
  reset_database
  seed_two_pending_migrations
  run_update_script
  check_exit_code "exits 0" 0 "${UPDATE_EXIT}"
  check_contains "warns about the ambiguity" "${UPDATE_OUTPUT}" "two env files exist"
  check_contains "says which one won" "${UPDATE_OUTPUT}" \
    "using:    ${FIXTURE_REPO}/infra/aws/.env.production"
  rm -f "${FIXTURE_REPO}/.env.production"
}

test_update_accepts_the_legacy_env_location() {
  echo "update.sh: legacy env file location"
  mv "${FIXTURE_REPO}/infra/aws/.env.production" "${FIXTURE_REPO}/.env.production"
  run_update_script
  check_exit_code "exits 0" 0 "${UPDATE_EXIT}"
  check_contains "falls back to the repo root" "${UPDATE_OUTPUT}" \
    "reading build-time env from ${FIXTURE_REPO}/.env.production"
  mv "${FIXTURE_REPO}/.env.production" "${FIXTURE_REPO}/infra/aws/.env.production"
}

# ----------------------------------------------------------------------
# bootstrap.sh tests. Its system-prereq and docker-data-root sections are
# skipped by the fakes (docker already "present", data directory not a
# mount point); everything from the stack bring-up onward really runs.
# ----------------------------------------------------------------------

test_bootstrap_applies_migrations_and_completes() {
  echo "bootstrap.sh: happy path"
  reset_database
  seed_two_pending_migrations
  run_bootstrap_script
  check_exit_code "exits 0" 0 "${BOOTSTRAP_EXIT}"
  check_contains "applies the migrations" "${BOOTSTRAP_OUTPUT}" \
    "2 applied · 0 already-applied · 0 failed"
  check_order "the stack comes up before migrations run" "${BOOTSTRAP_OUTPUT}" \
    "starting Vocion stack" "applying database migrations"
  check_contains "reports completion" "${BOOTSTRAP_OUTPUT}" "bootstrap complete"
  check_contains "says how to apply workspace content" "${BOOTSTRAP_OUTPUT}" \
    "WORKSPACE_PATH"
  local todo_exists
  todo_exists=$(query_test_database "SELECT count(*) FROM information_schema.tables WHERE table_name = 'todo';")
  if [ "${todo_exists}" = "1" ]; then
    pass "the migration really ran against the database"
  else
    fail "the migration really ran against the database" "todo table is missing"
  fi
}

test_bootstrap_aborts_on_migration_failure() {
  echo "bootstrap.sh: failing migration"
  reset_database
  seed_two_pending_migrations
  write_migration 0002_broken.sql "${PARTIAL_FAILURE_MIGRATION}"
  run_bootstrap_script
  check_exit_code "exits non-zero" nonzero "${BOOTSTRAP_EXIT}"
  check_contains "names the failing file" "${BOOTSTRAP_OUTPUT}" "0002_broken.sql FAILED"
  check_absent "never reports completion" "${BOOTSTRAP_OUTPUT}" "bootstrap complete"
  rm -f "${MIGRATIONS_FIXTURE}/0002_broken.sql"
}

test_bootstrap_aborts_without_an_env_file() {
  echo "bootstrap.sh: missing env file"
  local saved="${WORK_DIR}/saved-bootstrap.env"
  mv "${FIXTURE_REPO}/infra/aws/.env.production" "${saved}"
  run_bootstrap_script
  check_exit_code "exits non-zero" nonzero "${BOOTSTRAP_EXIT}"
  check_contains "says which file is missing" "${BOOTSTRAP_OUTPUT}" ".env.production missing"
  check_absent "never reports completion" "${BOOTSTRAP_OUTPUT}" "bootstrap complete"
  mv "${saved}" "${FIXTURE_REPO}/infra/aws/.env.production"
}

# ----------------------------------------------------------------------
# Static assertions — the regressions this ticket fixed
# ----------------------------------------------------------------------

test_scripts_do_not_swallow_migration_failures() {
  echo "static: migration exit codes are not swallowed"
  local update_line bootstrap_line
  update_line=$(grep -n 'apply-migrations.sh' "${SCRIPT_DIR}/update.sh" | grep -v '^\s*#' | grep 'bash ')
  bootstrap_line=$(grep -n 'apply-migrations.sh' "${SCRIPT_DIR}/bootstrap.sh" | grep 'bash ')
  check_absent "update.sh does not use || on the migration call" "${update_line}" "||"
  check_absent "bootstrap.sh does not use || on the migration call" "${bootstrap_line}" "||"
  check_contains "bootstrap.sh calls the applier" "${bootstrap_line}" "apply-migrations.sh"
}

test_bootstrap_no_longer_uses_drizzle_kit() {
  echo "static: bootstrap.sh drops the drizzle-kit call"
  check_absent "no drizzle-kit invocation" "$(cat "${SCRIPT_DIR}/bootstrap.sh")" "drizzle-kit/bin.cjs"
}

test_scripts_do_not_call_the_missing_context_script() {
  echo "static: the dead workspace-apply call is gone"
  local update_calls bootstrap_calls
  update_calls=$(grep -F 'apply-context.js' "${SCRIPT_DIR}/update.sh" | grep -v '^#' | grep 'node ')
  bootstrap_calls=$(grep -F 'apply-context.js' "${SCRIPT_DIR}/bootstrap.sh" | grep -v '^#' | grep 'node ')
  if [ -z "${update_calls}" ]; then
    pass "update.sh does not run apply-context.js"
  else
    fail "update.sh does not run apply-context.js" "${update_calls}"
  fi
  if [ -z "${bootstrap_calls}" ]; then
    pass "bootstrap.sh does not run apply-context.js"
  else
    fail "bootstrap.sh does not run apply-context.js" "${bootstrap_calls}"
  fi
}

test_all_scripts_parse() {
  echo "static: every deploy script parses"
  local script
  for script in apply-migrations.sh update.sh bootstrap.sh; do
    if bash -n "${SCRIPT_DIR}/${script}" 2>/dev/null; then
      pass "${script} parses"
    else
      fail "${script} parses" "bash -n reported a syntax error"
    fi
  done
}

# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------

main() {
  if ! "${REAL_DOCKER}" info >/dev/null 2>&1; then
    echo "Docker is not available; these tests need a running daemon." >&2
    exit 1
  fi

  trap clean_up EXIT
  write_sudo_shim
  write_fake_docker_shim
  build_fixture_repo

  echo "starting throwaway Postgres (${TEST_IMAGE})"
  if ! start_test_postgres; then
    echo "could not start the test database" >&2
    exit 1
  fi

  test_fresh_database_applies_every_migration
  test_rerun_is_idempotent
  test_only_new_migration_is_applied
  test_failing_migration_aborts_and_rolls_back
  test_retry_after_fixing_the_migration
  test_missing_migrations_directory_fails
  test_empty_migrations_directory_fails
  test_migrations_directory_follows_repo_dir
  test_existing_schema_without_tracking_refuses
  test_baseline_all_marks_everything_applied
  test_baseline_by_file_name_applies_the_rest
  test_unknown_baseline_name_is_rejected
  test_drizzle_history_baselines_automatically
  test_explicit_baseline_overrides_drizzle_history
  test_baseline_is_ignored_on_an_empty_database
  test_baseline_flag_matches_the_env_var
  test_baseline_flag_accepts_a_file_name
  test_baseline_flag_without_a_value_is_rejected
  test_unknown_flag_is_rejected
  test_check_mode_writes_nothing
  test_check_mode_reports_the_baseline_refusal
  test_concurrently_migration_runs_without_a_transaction
  test_unreachable_container_fails_loudly
  test_default_container_and_database_match_compose

  test_update_migrates_before_rolling_containers
  test_update_reads_env_from_infra_aws
  test_update_aborts_on_migration_failure
  test_update_with_no_pending_migrations_still_rolls
  test_update_fails_without_an_env_file
  test_update_fails_when_a_required_build_value_is_missing
  test_update_tolerates_missing_optional_values
  test_update_warns_when_both_env_files_exist
  test_update_accepts_the_legacy_env_location

  test_bootstrap_applies_migrations_and_completes
  test_bootstrap_aborts_on_migration_failure
  test_bootstrap_aborts_without_an_env_file

  test_scripts_do_not_swallow_migration_failures
  test_bootstrap_no_longer_uses_drizzle_kit
  test_scripts_do_not_call_the_missing_context_script
  test_all_scripts_parse

  echo ""
  echo "${tests_passed} passed · ${tests_failed} failed"
  if [ "${tests_failed}" -gt 0 ]; then
    local name
    for name in "${failed_names[@]}"; do
      echo "  - ${name}"
    done
    return 1
  fi
  return 0
}

main "$@"
