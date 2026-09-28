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
FAKE_CURL_DIR="${WORK_DIR}/fake-curl-shim"
FAKE_DOCKER_NO_BUILDX_DIR="${WORK_DIR}/fake-docker-without-buildx"
MIGRATIONS_FIXTURE="${WORK_DIR}/migrations"
FIXTURE_REPO="${WORK_DIR}/repo"
CALL_LOG="${WORK_DIR}/calls.log"
# What the fake `curl` serves as the buildx release.
FAKE_BUILDX_BODY='#!/bin/sh
exit 0
'

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
# FAKE_DOCKER_BUILDX_MISSING plays a box whose Docker has no buildx plugin,
# until install-buildx.sh puts an executable one where the CLI looks.
if [ "\$1" = "buildx" ] && [ -n "\${FAKE_DOCKER_BUILDX_MISSING:-}" ] \\
  && [ ! -x "\${DOCKER_CONFIG:-}/cli-plugins/docker-buildx" ]; then
  exit 1
fi
# FAKE_BUILDER_MISSING plays a CI runner that has never made the
# vocion-app-builder, and FAKE_BUILDX_BUILD_FAIL a build that fails.
if [ "\$1" = "buildx" ] && [ "\$2" = "inspect" ] && [ -n "\${FAKE_BUILDER_MISSING:-}" ]; then
  exit 1
fi
if [ "\$1" = "buildx" ] && [ "\$2" = "build" ] && [ -n "\${FAKE_BUILDX_BUILD_FAIL:-}" ]; then
  exit 1
fi
# The registry password arrives on stdin; record only that it came.
if [ "\$1" = "login" ]; then
  if [ -n "\$(cat)" ]; then
    echo "docker login read a password from stdin" >> "${CALL_LOG}"
  fi
  exit 0
fi
# FAKE_PULL_FAILURES fails that many pulls before one succeeds, and
# FAKE_PULL_FAILURES=always fails them all. The log already holds this call.
if [ "\$1" = "pull" ]; then
  pulls_so_far=\$(grep -c '^docker pull ' "${CALL_LOG}")
  if [ "\${FAKE_PULL_FAILURES:-0}" = "always" ] \\
    || [ "\${pulls_so_far}" -le "\${FAKE_PULL_FAILURES:-0}" ]; then
    exit 1
  fi
  exit 0
fi
# The one label pull-app-image.sh reads: the app URL the image was built for.
if [ "\$1" = "image" ] && [ "\$2" = "inspect" ]; then
  echo "\${FAKE_IMAGE_APP_URL:-}"
  exit 0
fi
exit 0
FAKE
  # An `aws` that hands out a fixed ECR password, or fails the way a box
  # without ECR permissions does when FAKE_AWS_FAIL is set.
  cat > "${FAKE_DOCKER_DIR}/aws" <<FAKE
#!/usr/bin/env bash
echo "aws \$*" >> "${CALL_LOG}"
if [ -n "\${FAKE_AWS_FAIL:-}" ]; then
  echo "An error occurred (AccessDeniedException) when calling the GetAuthorizationToken operation" >&2
  exit 255
fi
echo "fake-ecr-password"
FAKE
  chmod +x "${FAKE_DOCKER_DIR}/aws"
  # A `curl` that records its arguments and writes FAKE_BUILDX_BODY to its -o
  # path, so the buildx install runs without touching the network.
  # FAKE_CURL_TAMPERED writes something else, so the checksum can't match, and
  # FAKE_CURL_FAIL fails the way `curl -f` does on a 404. A `uname` answers
  # FAKE_UNAME_MACHINE (x86_64 by default), so the release picked doesn't
  # depend on the machine running these tests. Both live in their own
  # directory, put on PATH only by the tests that expect a download.
  mkdir -p "${FAKE_CURL_DIR}"
  cat > "${FAKE_CURL_DIR}/curl" <<FAKE
#!/usr/bin/env bash
echo "curl \$*" >> "${CALL_LOG}"
if [ -n "\${FAKE_CURL_FAIL:-}" ]; then
  echo "curl: (22) The requested URL returned error: 404" >&2
  exit 22
fi
output_path=""
while [ "\$#" -gt 0 ]; do
  if [ "\$1" = "-o" ]; then
    output_path="\$2"
    shift
  fi
  shift
done
if [ -n "\${output_path}" ]; then
  if [ -n "\${FAKE_CURL_TAMPERED:-}" ]; then
    printf 'not the release\n' > "\${output_path}"
  else
    printf '%s' '${FAKE_BUILDX_BODY}' > "\${output_path}"
  fi
fi
exit 0
FAKE
  # A `docker` whose buildx never loads, even once the plugin file is there.
  mkdir -p "${FAKE_DOCKER_NO_BUILDX_DIR}"
  cat > "${FAKE_DOCKER_NO_BUILDX_DIR}/docker" <<FAKE
#!/usr/bin/env bash
echo "docker \$*" >> "${CALL_LOG}"
[ "\$1" = "buildx" ] && exit 1
exit 0
FAKE
  chmod +x "${FAKE_DOCKER_NO_BUILDX_DIR}/docker"
  cat > "${FAKE_CURL_DIR}/uname" <<FAKE
#!/bin/sh
echo "\${FAKE_UNAME_MACHINE:-x86_64}"
FAKE
  chmod +x "${FAKE_CURL_DIR}/curl" "${FAKE_CURL_DIR}/uname"
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

# A production-only concurrent index build — see
# packages/core/migrations/CONVENTIONS.md.
write_concurrent_migration() {
  mkdir -p "${MIGRATIONS_FIXTURE}/concurrent"
  printf '%s\n' "$2" > "${MIGRATIONS_FIXTURE}/concurrent/$1"
}

# A repo-shaped directory update.sh can be pointed at with REPO_DIR.
build_fixture_repo() {
  mkdir -p "${FIXTURE_REPO}/infra/aws" "${FIXTURE_REPO}/packages/core/migrations"
  printf '%s\n' 'CREATE TABLE "from_repo_dir" ("id" text PRIMARY KEY NOT NULL);' \
    > "${FIXTURE_REPO}/packages/core/migrations/0000_from_repo_dir.sql"
  cp "${SCRIPT_DIR}/apply-migrations.sh" "${FIXTURE_REPO}/infra/aws/"
  cp "${SCRIPT_DIR}/update.sh" "${FIXTURE_REPO}/infra/aws/"
  cp "${SCRIPT_DIR}/bootstrap.sh" "${FIXTURE_REPO}/infra/aws/"
  cp "${SCRIPT_DIR}/pull-app-image.sh" "${FIXTURE_REPO}/infra/aws/"
  cp "${SCRIPT_DIR}/push-app-image.sh" "${FIXTURE_REPO}/infra/aws/"
  # The fixture's copy pins the fake release's checksum in place of the real
  # ones, so the install can pass its checksum check without the network.
  # Everything else in the script is what ships.
  local fake_sha256
  fake_sha256="$(printf '%s' "${FAKE_BUILDX_BODY}" | sha256sum | cut -d ' ' -f 1)"
  sed -E "s/^(BUILDX_SHA256_(AMD64|ARM64))=.*/\\1=\"${fake_sha256}\"/" \
    "${SCRIPT_DIR}/install-buildx.sh" > "${FIXTURE_REPO}/infra/aws/install-buildx.sh"
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

# Extra NAME=value arguments are passed to update.sh's environment and win
# over the defaults here, including PATH.
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
      "$@" \
      bash "${FIXTURE_REPO}/infra/aws/update.sh" 2>&1
  )
  UPDATE_EXIT=$?
}

BOOTSTRAP_OUTPUT=""
BOOTSTRAP_EXIT=0

# Extra NAME=value arguments work as they do for run_update_script.
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
      "$@" \
      bash "${FIXTURE_REPO}/infra/aws/bootstrap.sh" 2>&1
  )
  BOOTSTRAP_EXIT=$?
}

INSTALL_BUILDX_OUTPUT=""
INSTALL_BUILDX_EXIT=0
BUILDX_PLUGIN_ROOT="${WORK_DIR}/docker-cli-config"

# Runs install-buildx.sh on a box with no buildx plugin, installing into a
# fresh BUILDX_PLUGIN_ROOT. Extra NAME=value arguments go to its environment.
run_install_buildx() {
  : > "${CALL_LOG}"
  rm -rf "${BUILDX_PLUGIN_ROOT}"
  INSTALL_BUILDX_OUTPUT=$(
    env PATH="${FAKE_CURL_DIR}:${FAKE_DOCKER_DIR}:${PATH}" \
      FAKE_DOCKER_BUILDX_MISSING=1 \
      DOCKER_CONFIG="${BUILDX_PLUGIN_ROOT}" \
      "$@" \
      bash "${FIXTURE_REPO}/infra/aws/install-buildx.sh" 2>&1
  )
  INSTALL_BUILDX_EXIT=$?
}

PUSH_OUTPUT=""
PUSH_EXIT=0
PUSH_STEP_OUTPUTS="${WORK_DIR}/github-step-outputs"

# push-app-image.sh as a CI job runs it, with GITHUB_OUTPUT pointed at a
# fresh file. Leading NAME=value arguments go to its environment; the rest,
# after a `--`, are its own arguments.
run_push_script() {
  : > "${CALL_LOG}"
  : > "${PUSH_STEP_OUTPUTS}"
  local environment=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    environment+=("$1")
    shift
  done
  [ "${1:-}" = "--" ] && shift
  # The ${name[@]+...} form: bash 3.2 (macOS) calls an empty array unbound.
  PUSH_OUTPUT=$(
    env PATH="${FAKE_DOCKER_DIR}:${PATH}" \
      GITHUB_OUTPUT="${PUSH_STEP_OUTPUTS}" \
      GITHUB_SHA= \
      ${environment[@]+"${environment[@]}"} \
      bash "${FIXTURE_REPO}/infra/aws/push-app-image.sh" "$@" 2>&1
  )
  PUSH_EXIT=$?
}

# Passes when the plugin directory holds nothing: no plugin, and no
# half-downloaded file left beside it.
check_no_buildx_plugin_left() {
  local leftovers
  leftovers="$(ls -A "${BUILDX_PLUGIN_ROOT}/cli-plugins" 2>/dev/null)"
  if [ -z "${leftovers}" ]; then
    pass "$1"
  else
    fail "$1" "found in cli-plugins: ${leftovers}"
  fi
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

test_concurrently_only_in_line_comment_uses_a_transaction() {
  echo "apply-migrations: CONCURRENTLY mentioned only in a -- comment"
  reset_database
  clear_migrations
  write_migration 0000_widget.sql \
    '-- this migration does not actually use CONCURRENTLY, only mentions it here
CREATE TABLE "widget" ("id" text PRIMARY KEY NOT NULL);'
  run_applier
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_absent "does not treat the comment mention as real usage" "${APPLIER_OUTPUT}" "uses CONCURRENTLY"
  check_contains "still applies the file" "${APPLIER_OUTPUT}" "1 applied · 0 already-applied · 0 failed"
}

test_concurrently_only_in_block_comment_uses_a_transaction() {
  echo "apply-migrations: CONCURRENTLY mentioned only in a /* */ comment"
  reset_database
  clear_migrations
  write_migration 0000_gadget.sql \
    '/* CONCURRENTLY is not used below, just discussed */
CREATE TABLE "gadget" ("id" text PRIMARY KEY NOT NULL);'
  run_applier
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_absent "does not treat the comment mention as real usage" "${APPLIER_OUTPUT}" "uses CONCURRENTLY"
  check_contains "still applies the file" "${APPLIER_OUTPUT}" "1 applied · 0 already-applied · 0 failed"
}

test_concurrently_comment_and_real_statement_still_detected() {
  echo "apply-migrations: CONCURRENTLY named in prose alongside a real statement"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  write_migration 0001_concurrent_index.sql \
    '-- CONCURRENTLY mentioned here in prose, and used for real below
CREATE INDEX CONCURRENTLY "organization_id_idx" ON "organization" ("id");'
  run_applier
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "says why the file ran unwrapped" "${APPLIER_OUTPUT}" \
    "uses CONCURRENTLY — applying without a transaction"
  check_contains "applies both files" "${APPLIER_OUTPUT}" "2 applied · 0 already-applied · 0 failed"
}

test_concurrent_directory_applies_after_its_migration() {
  echo "apply-migrations: migrations/concurrent/ index build"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  write_concurrent_migration 0000_organization_index.sql \
    'DROP INDEX IF EXISTS "organization_id_concurrent_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "organization_id_concurrent_idx" ON "organization" ("id");'
  run_applier
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "applies the numbered migration and the index build" "${APPLIER_OUTPUT}" \
    "2 applied · 0 already-applied · 0 failed"
  check_contains "runs the index build unwrapped" "${APPLIER_OUTPUT}" \
    "uses CONCURRENTLY — applying without a transaction"

  local index_exists recorded
  index_exists=$(query_test_database "SELECT count(*) FROM pg_indexes WHERE indexname = 'organization_id_concurrent_idx';")
  if [ "${index_exists}" = "1" ]; then
    pass "the concurrent index exists"
  else
    fail "the concurrent index exists" "index is missing"
  fi

  # Recorded with its directory, so a concurrent build can never be mistaken
  # for a numbered migration that happens to share a filename.
  recorded=$(query_test_database "SELECT count(*) FROM __pgsql_migrations WHERE name = 'concurrent/0000_organization_index.sql';")
  if [ "${recorded}" = "1" ]; then
    pass "recorded under its directory"
  else
    fail "recorded under its directory" "no concurrent/ row in __pgsql_migrations"
  fi

  run_applier
  check_contains "a re-run skips it" "${APPLIER_OUTPUT}" "0 applied · 2 already-applied · 0 failed"
}

test_concurrent_build_needs_its_numbered_migration_first() {
  echo "apply-migrations: concurrent build ordered after its migration"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  # The column this indexes only exists after 0001 runs, so an index build
  # ordered before it would fail outright.
  write_migration 0001_add_column.sql 'ALTER TABLE "organization" ADD COLUMN "slug" text;'
  write_concurrent_migration 0001_organization_slug_index.sql \
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "organization_slug_idx" ON "organization" ("slug");'
  run_applier
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "applies all three" "${APPLIER_OUTPUT}" "3 applied · 0 already-applied · 0 failed"
  local index_exists
  index_exists=$(query_test_database "SELECT count(*) FROM pg_indexes WHERE indexname = 'organization_slug_idx';")
  if [ "${index_exists}" = "1" ]; then
    pass "the index on the new column exists"
  else
    fail "the index on the new column exists" "index is missing"
  fi
}

test_baseline_all_leaves_concurrent_builds_pending() {
  echo "apply-migrations: --baseline all covers only the numbered migrations"
  reset_database
  clear_migrations
  # A pre-existing schema with no tracking rows: baselining marks the numbered
  # migrations as applied. The index builds are production-only and may never
  # have run there, so they stay pending and build concurrently on the next run.
  query_test_database 'CREATE TABLE "organization" ("id" text PRIMARY KEY NOT NULL);' >/dev/null
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  write_concurrent_migration 0000_organization_index.sql \
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "organization_baselined_idx" ON "organization" ("id");'
  run_applier_with_flags --baseline all
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "baselines the numbered migration only" "${APPLIER_OUTPUT}" "baselined 1 migration(s)"
  check_contains "then applies the index build" "${APPLIER_OUTPUT}" "1 applied · 1 already-applied · 0 failed"
  local index_exists
  index_exists=$(query_test_database "SELECT count(*) FROM pg_indexes WHERE indexname = 'organization_baselined_idx';")
  if [ "${index_exists}" = "1" ]; then
    pass "the concurrent index was built on the baselined database"
  else
    fail "the concurrent index was built on the baselined database" "index is missing"
  fi
}

test_orphan_concurrent_build_is_left_alone() {
  echo "apply-migrations: concurrent build with no matching migration number"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  # Numbered 0009, but there is no 0009 migration to hang it off. The applier
  # cannot place it, so it never runs — which is why check:migrations refuses
  # to let one be committed.
  write_concurrent_migration 0009_orphan_index.sql \
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "organization_orphan_idx" ON "organization" ("id");'
  run_applier
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "applies only the numbered migration" "${APPLIER_OUTPUT}" \
    "1 applied · 0 already-applied · 0 failed"
  local index_exists
  index_exists=$(query_test_database "SELECT count(*) FROM pg_indexes WHERE indexname = 'organization_orphan_idx';")
  if [ "${index_exists}" = "0" ]; then
    pass "the orphan build did not run"
  else
    fail "the orphan build did not run" "the index exists, so ordering is not number-driven"
  fi
}

test_concurrently_inside_a_string_literal_keeps_the_transaction() {
  echo "apply-migrations: CONCURRENTLY only inside a string literal"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  # Prose about a concurrent build, not a concurrent build. Dropping
  # --single-transaction here would cost this file its rollback for nothing.
  write_migration 0001_comment_on_index.sql \
    'CREATE INDEX IF NOT EXISTS "organization_prose_idx" ON "organization" ("id");
COMMENT ON INDEX "organization_prose_idx" IS '"'"'rebuilt CONCURRENTLY in 0002'"'"';'
  run_applier
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_absent "keeps the transaction" "${APPLIER_OUTPUT}" \
    "uses CONCURRENTLY — applying without a transaction"
}

test_two_concurrent_builds_share_one_number() {
  echo "apply-migrations: two concurrent builds under one migration number"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  write_concurrent_migration 0000_a_index.sql \
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "organization_a_idx" ON "organization" ("id");'
  write_concurrent_migration 0000_b_index.sql \
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "organization_b_idx" ON "organization" ("id");'
  run_applier
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "applies both builds" "${APPLIER_OUTPUT}" "3 applied · 0 already-applied · 0 failed"
  local both
  both=$(query_test_database "SELECT count(*) FROM pg_indexes WHERE indexname IN ('organization_a_idx', 'organization_b_idx');")
  if [ "${both}" = "2" ]; then
    pass "both indexes exist"
  else
    fail "both indexes exist" "found ${both} of 2"
  fi
}

test_failing_concurrent_build_stops_the_run() {
  echo "apply-migrations: a concurrent build that fails"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  # No such column, so the build fails outright.
  write_concurrent_migration 0000_broken_index.sql \
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "organization_missing_idx" ON "organization" ("no_such_column");'
  write_migration 0001_second.sql "${SECOND_MIGRATION}"
  run_applier
  check_exit_code "exits non-zero" nonzero "${APPLIER_EXIT}"
  check_contains "names the failing build" "${APPLIER_OUTPUT}" "concurrent/0000_broken_index.sql FAILED"
  check_contains "says nothing rolled back" "${APPLIER_OUTPUT}" "it ran without a transaction"
  local later_table recorded
  later_table=$(query_test_database "SELECT count(*) FROM information_schema.tables WHERE table_name = 'todo';")
  if [ "${later_table}" = "0" ]; then
    pass "stops before the next migration"
  else
    fail "stops before the next migration" "0001 ran anyway"
  fi
  recorded=$(query_test_database "SELECT count(*) FROM __pgsql_migrations WHERE name = 'concurrent/0000_broken_index.sql';")
  if [ "${recorded}" = "0" ]; then
    pass "the failed build is not recorded"
  else
    fail "the failed build is not recorded" "it was recorded as applied"
  fi
}

test_check_mode_reports_concurrent_builds_without_running_them() {
  echo "apply-migrations: --check with a concurrent build"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  write_concurrent_migration 0000_organization_index.sql \
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "organization_checkmode_idx" ON "organization" ("id");'
  run_applier_with_flags --check
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "reports the numbered migration" "${APPLIER_OUTPUT}" "would apply 0000_first.sql"
  check_contains "reports the concurrent build" "${APPLIER_OUTPUT}" \
    "would apply concurrent/0000_organization_index.sql"
  local index_exists
  index_exists=$(query_test_database "SELECT count(*) FROM pg_indexes WHERE indexname = 'organization_checkmode_idx';")
  if [ "${index_exists}" = "0" ]; then
    pass "builds nothing"
  else
    fail "builds nothing" "the index was created under --check"
  fi
}

test_verify_indexes_passes_when_the_build_landed() {
  echo "apply-migrations: --verify-indexes, index present"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  write_concurrent_migration 0000_organization_index.sql \
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "organization_verified_idx" ON "organization" ("id");'
  run_applier
  check_exit_code "the apply run exits 0" 0 "${APPLIER_EXIT}"
  run_applier_with_flags --verify-indexes
  check_exit_code "verify exits 0" 0 "${APPLIER_EXIT}"
  check_contains "says what it checked" "${APPLIER_OUTPUT}" \
    "all 1 concurrent index build(s) present and valid"
}

test_verify_indexes_catches_a_skipped_directory() {
  echo "apply-migrations: --verify-indexes, build never applied"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  run_applier
  # The directory appears only after the migrations ran, standing in for a
  # parent project whose own applier never looked at it.
  write_concurrent_migration 0000_organization_index.sql \
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "organization_never_built_idx" ON "organization" ("id");'
  run_applier_with_flags --verify-indexes
  check_exit_code "verify exits non-zero" nonzero "${APPLIER_EXIT}"
  check_contains "names the missing index" "${APPLIER_OUTPUT}" "organization_never_built_idx — MISSING"
  check_contains "points at the convention" "${APPLIER_OUTPUT}" "CONVENTIONS.md"
}

test_verify_indexes_catches_an_invalid_index() {
  echo "apply-migrations: --verify-indexes, INVALID index left by a failed build"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  run_applier
  # Mark a real index invalid, which is the state a concurrent build that dies
  # partway leaves behind: present, never used, and skipped by IF NOT EXISTS.
  query_test_database 'CREATE INDEX "organization_half_built_idx" ON "organization" ("id");' >/dev/null
  query_test_database "UPDATE pg_index SET indisvalid = false WHERE indexrelid = '\"organization_half_built_idx\"'::regclass;" >/dev/null
  write_concurrent_migration 0000_organization_index.sql \
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "organization_half_built_idx" ON "organization" ("id");'
  run_applier_with_flags --verify-indexes
  check_exit_code "verify exits non-zero" nonzero "${APPLIER_EXIT}"
  check_contains "names the invalid index" "${APPLIER_OUTPUT}" "organization_half_built_idx — INVALID"
}

test_verify_indexes_with_nothing_declared() {
  echo "apply-migrations: --verify-indexes with no concurrent directory"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  run_applier
  run_applier_with_flags --verify-indexes
  check_exit_code "verify exits 0" 0 "${APPLIER_EXIT}"
  check_contains "says there is nothing to check" "${APPLIER_OUTPUT}" "nothing to verify"
}

test_verify_indexes_writes_nothing() {
  echo "apply-migrations: --verify-indexes creates no tracking table"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  # A database this script has never touched. Verification must read it and
  # stop, not baseline it or apply anything.
  run_applier_with_flags --verify-indexes
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  local tracking organization
  tracking=$(query_test_database "SELECT count(*) FROM information_schema.tables WHERE table_name = '__pgsql_migrations';")
  organization=$(query_test_database "SELECT count(*) FROM information_schema.tables WHERE table_name = 'organization';")
  if [ "${tracking}" = "0" ]; then
    pass "no tracking table was created"
  else
    fail "no tracking table was created" "__pgsql_migrations exists"
  fi
  if [ "${organization}" = "0" ]; then
    pass "no migration was applied"
  else
    fail "no migration was applied" "0000 ran under --verify-indexes"
  fi
}

test_verify_indexes_names_the_file_and_the_command() {
  echo "apply-migrations: --verify-indexes output is actionable"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  run_applier
  write_concurrent_migration 0000_organization_index.sql \
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "organization_actionable_idx" ON "organization" ("id");'
  run_applier_with_flags --verify-indexes
  check_contains "names the file that declares it" "${APPLIER_OUTPUT}" "0000_organization_index.sql"
  check_contains "gives a runnable build command" "${APPLIER_OUTPUT}" "psql -U postgres -d vocion"
  check_contains "says it is slow, not down" "${APPLIER_OUTPUT}" "slower, not down"
}

test_verify_indexes_ignores_a_name_in_a_comment() {
  echo "apply-migrations: --verify-indexes, index named only in a comment"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  write_concurrent_migration 0000_organization_index.sql \
    '-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "organization_commented_idx" ON "organization" ("id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "organization_real_idx" ON "organization" ("id");'
  run_applier
  run_applier_with_flags --verify-indexes
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "counts only the real one" "${APPLIER_OUTPUT}" "verifying 1 concurrent index build(s)"
  check_absent "does not report the commented name" "${APPLIER_OUTPUT}" "organization_commented_idx"
}

test_verify_indexes_with_a_drop_only_file() {
  echo "apply-migrations: --verify-indexes, concurrent file that only drops"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  write_concurrent_migration 0000_drop_only.sql 'DROP INDEX IF EXISTS "organization_retired_idx";'
  run_applier
  run_applier_with_flags --verify-indexes
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "says the directory declares nothing" "${APPLIER_OUTPUT}" "declares no index builds"
}

test_verify_indexes_counts_a_repeated_name_once() {
  echo "apply-migrations: --verify-indexes, same index named by two files"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  write_concurrent_migration 0000_a.sql \
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "organization_shared_idx" ON "organization" ("id");'
  write_concurrent_migration 0000_b.sql \
    'DROP INDEX IF EXISTS "organization_shared_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "organization_shared_idx" ON "organization" ("id");'
  run_applier
  run_applier_with_flags --verify-indexes
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "counts the name once" "${APPLIER_OUTPUT}" "verifying 1 concurrent index build(s)"
}

test_verify_indexes_checks_a_unique_build() {
  echo "apply-migrations: --verify-indexes, UNIQUE concurrent build"
  reset_database
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  # check:migrations refuses UNIQUE in this directory, but verification reports
  # on whatever is actually present.
  write_concurrent_migration 0000_unique_index.sql \
    'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "organization_unique_idx" ON "organization" ("id");'
  run_applier
  run_applier_with_flags --verify-indexes
  check_exit_code "exits 0" 0 "${APPLIER_EXIT}"
  check_contains "verified the unique build" "${APPLIER_OUTPUT}" "1 concurrent index build(s) present and valid"
}

test_verify_indexes_refuses_to_be_combined() {
  echo "apply-migrations: --verify-indexes is not combinable"
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  run_applier_with_flags --verify-indexes --check
  check_exit_code "with --check, exits non-zero" nonzero "${APPLIER_EXIT}"
  check_contains "says why" "${APPLIER_OUTPUT}" "cannot be combined with --check"
  run_applier_with_flags --verify-indexes --baseline all
  check_exit_code "with --baseline, exits non-zero" nonzero "${APPLIER_EXIT}"
  check_contains "says why" "${APPLIER_OUTPUT}" "cannot be combined with --baseline"
}

test_verify_indexes_on_an_unreachable_container() {
  echo "apply-migrations: --verify-indexes against an unreachable container"
  clear_migrations
  write_migration 0000_first.sql "${FIRST_MIGRATION}"
  write_concurrent_migration 0000_organization_index.sql \
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "organization_unreachable_idx" ON "organization" ("id");'
  APPLIER_OUTPUT=$(
    env PATH="${SHIM_DIR}:${PATH}" \
      POSTGRES_CONTAINER="no-such-container-here" \
      POSTGRES_DB="${DB_NAME}" \
      POSTGRES_USER="${DB_USER}" \
      MIGRATIONS_DIR="${MIGRATIONS_FIXTURE}" \
      POSTGRES_READINESS_ATTEMPTS=1 \
      bash "${SCRIPT_DIR}/apply-migrations.sh" --verify-indexes 2>&1
  )
  APPLIER_EXIT=$?
  check_exit_code "exits non-zero rather than reporting success" nonzero "${APPLIER_EXIT}"
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
  check_absent "leaves an installed buildx plugin alone" "${UPDATE_OUTPUT}" \
    "installing docker-buildx plugin"
}

# The image's build step uses a BuildKit cache mount (#670), which fails on
# Docker's legacy builder. A box bootstrapped before #670 may have no buildx
# plugin, so update.sh has to install it before it builds.
test_update_installs_buildx_before_building() {
  echo "update.sh: box without the buildx plugin"
  reset_database
  seed_two_pending_migrations
  rm -rf "${BUILDX_PLUGIN_ROOT}"
  run_update_script \
    PATH="${FAKE_CURL_DIR}:${FAKE_DOCKER_DIR}:${PATH}" \
    FAKE_DOCKER_BUILDX_MISSING=1 \
    DOCKER_CONFIG="${BUILDX_PLUGIN_ROOT}"
  check_exit_code "exits 0" 0 "${UPDATE_EXIT}"
  check_contains "says it is installing buildx" "${UPDATE_OUTPUT}" \
    "installing docker-buildx plugin"
  check_order "downloads the pinned buildx release before building the image" \
    "$(cat "${CALL_LOG}")" \
    "releases/download/v0.37.1/buildx-v0.37.1.linux-amd64" "docker build --build-arg"
  if [ -x "${BUILDX_PLUGIN_ROOT}/cli-plugins/docker-buildx" ]; then
    pass "installs the plugin where the Docker CLI looks for it"
  else
    fail "installs the plugin where the Docker CLI looks for it" \
      "no executable at ${BUILDX_PLUGIN_ROOT}/cli-plugins/docker-buildx"
  fi
}

# A failed download must stop the deploy before it builds or migrates, with
# the old containers still serving.
test_update_stops_when_buildx_cannot_be_installed() {
  echo "update.sh: buildx download fails"
  reset_database
  seed_two_pending_migrations
  rm -rf "${BUILDX_PLUGIN_ROOT}"
  run_update_script \
    PATH="${FAKE_CURL_DIR}:${FAKE_DOCKER_DIR}:${PATH}" \
    FAKE_DOCKER_BUILDX_MISSING=1 \
    FAKE_CURL_FAIL=1 \
    DOCKER_CONFIG="${BUILDX_PLUGIN_ROOT}"
  check_exit_code "exits non-zero" nonzero "${UPDATE_EXIT}"
  check_contains "says the download failed" "${UPDATE_OUTPUT}" \
    "ERROR: could not download"
  # Not just "docker build", which `docker buildx version` also contains.
  check_absent "never builds the image" "$(cat "${CALL_LOG}")" "docker build --build-arg"
  check_absent "never applies migrations" "${UPDATE_OUTPUT}" "applying any new migrations"
  check_absent "never rolls the containers" "$(cat "${CALL_LOG}")" "up -d --no-deps"
}

# Rolling back to a ref from before #670 checks out a tree with no
# install-buildx.sh and no cache mount. The deploy must still build.
test_update_rolls_back_to_a_ref_without_the_installer() {
  echo "update.sh: ref from before install-buildx.sh"
  reset_database
  seed_two_pending_migrations
  local saved="${WORK_DIR}/saved-install-buildx.sh"
  mv "${FIXTURE_REPO}/infra/aws/install-buildx.sh" "${saved}"
  run_update_script FAKE_DOCKER_BUILDX_MISSING=1
  mv "${saved}" "${FIXTURE_REPO}/infra/aws/install-buildx.sh"
  check_exit_code "exits 0" 0 "${UPDATE_EXIT}"
  check_contains "still builds the image" "$(cat "${CALL_LOG}")" "docker build --build-arg"
}

# ----------------------------------------------------------------------
# update.sh with a CI-built image (VOCION_APP_IMAGE, #670)
# ----------------------------------------------------------------------

ECR_IMAGE="123456789012.dkr.ecr.us-west-2.amazonaws.com/vocion-app:abc1234"

# The point of a prebuilt image: the box pulls it and never compiles, so it
# never needs buildx either, even on a box that has none.
test_update_pulls_a_prebuilt_image_instead_of_building() {
  echo "update.sh: prebuilt image from ECR"
  reset_database
  seed_two_pending_migrations
  run_update_script \
    VOCION_APP_IMAGE="${ECR_IMAGE}" \
    FAKE_IMAGE_APP_URL=https://fixture.example \
    FAKE_DOCKER_BUILDX_MISSING=1
  local calls
  calls="$(cat "${CALL_LOG}")"
  check_exit_code "exits 0" 0 "${UPDATE_EXIT}"
  check_contains "asks ECR for a password in the registry's own region" "${calls}" \
    "aws ecr get-login-password --region us-west-2"
  check_contains "logs in to the registry with the password on stdin" "${calls}" \
    "docker login read a password from stdin"
  check_absent "never puts the password on a command line" "${calls}" "fake-ecr-password"
  check_order "pulls the image before migrations run" "${UPDATE_OUTPUT}" \
    "pulled ${ECR_IMAGE}" "applying any new migrations"
  check_order "tags it as the image compose runs, before the roll" "${calls}" \
    "docker tag ${ECR_IMAGE} vocion-app:latest" "up -d --no-deps app worker"
  check_absent "never builds on the box" "${calls}" "docker build"
  check_absent "never installs buildx" "${UPDATE_OUTPUT}" "installing docker-buildx plugin"
}

# A pull that keeps failing must stop the deploy with the old containers
# still serving, and must not run migrations the old image can't handle.
test_update_stops_when_the_image_cannot_be_pulled() {
  echo "update.sh: image pull keeps failing"
  reset_database
  seed_two_pending_migrations
  run_update_script \
    VOCION_APP_IMAGE="${ECR_IMAGE}" \
    FAKE_PULL_FAILURES=always \
    PULL_RETRY_SECONDS=0
  local calls pulls
  calls="$(cat "${CALL_LOG}")"
  pulls="$(printf '%s\n' "${calls}" | grep -c '^docker pull ')"
  check_exit_code "exits non-zero" nonzero "${UPDATE_EXIT}"
  check_contains "says how many times it tried" "${UPDATE_OUTPUT}" "after 3 tries"
  if [ "${pulls}" = "3" ]; then
    pass "tries the pull three times"
  else
    fail "tries the pull three times" "saw ${pulls} pulls"
  fi
  check_absent "never falls back to building" "${calls}" "docker build"
  check_absent "never applies migrations" "${UPDATE_OUTPUT}" "applying any new migrations"
  check_absent "never rolls the containers" "${calls}" "up -d --no-deps"
}

test_update_retries_a_pull_that_fails_once() {
  echo "update.sh: image pull fails once"
  reset_database
  seed_two_pending_migrations
  run_update_script \
    VOCION_APP_IMAGE="${ECR_IMAGE}" \
    FAKE_IMAGE_APP_URL=https://fixture.example \
    FAKE_PULL_FAILURES=1 \
    PULL_RETRY_SECONDS=0
  check_exit_code "exits 0" 0 "${UPDATE_EXIT}"
  check_contains "says it is retrying" "${UPDATE_OUTPUT}" "pull failed (try 1 of 3)"
  check_contains "rolls the containers" "$(cat "${CALL_LOG}")" "up -d --no-deps app worker"
}

# Next bakes NEXT_PUBLIC_APP_URL into the client bundle. Dev's image on the
# production box would send every sign-in to dev.
test_update_refuses_an_image_built_for_another_url() {
  echo "update.sh: image built for another environment"
  reset_database
  seed_two_pending_migrations
  run_update_script \
    VOCION_APP_IMAGE="${ECR_IMAGE}" \
    FAKE_IMAGE_APP_URL=https://dev.fixture.example
  local calls
  calls="$(cat "${CALL_LOG}")"
  check_exit_code "exits non-zero" nonzero "${UPDATE_EXIT}"
  check_contains "names both URLs" "${UPDATE_OUTPUT}" \
    "built for 'https://dev.fixture.example', but this box serves https://fixture.example"
  check_absent "never retags it as the running image" "${calls}" "vocion-app:latest"
  check_absent "never applies migrations" "${UPDATE_OUTPUT}" "applying any new migrations"
  check_absent "never rolls the containers" "${calls}" "up -d --no-deps"
}

# An image built before the label existed says nothing about its URL, which
# is no proof it fits this box.
test_update_refuses_an_image_without_the_url_label() {
  echo "update.sh: image with no app-url label"
  reset_database
  seed_two_pending_migrations
  run_update_script VOCION_APP_IMAGE="${ECR_IMAGE}" FAKE_IMAGE_APP_URL=
  check_exit_code "exits non-zero" nonzero "${UPDATE_EXIT}"
  check_contains "says the URL is unknown" "${UPDATE_OUTPUT}" "built for 'an unknown URL'"
  check_absent "never rolls the containers" "$(cat "${CALL_LOG}")" "up -d --no-deps"
}

# Without a tag Docker pulls :latest, whatever was pushed last, so neither
# the deploy nor a rollback would know what it ran.
test_update_refuses_an_image_without_a_tag() {
  echo "update.sh: image with no tag"
  run_update_script \
    VOCION_APP_IMAGE="localhost:5000/vocion-app" \
    FAKE_IMAGE_APP_URL=https://fixture.example
  check_exit_code "exits non-zero" nonzero "${UPDATE_EXIT}"
  check_contains "says the tag is missing" "${UPDATE_OUTPUT}" "has no tag"
  check_absent "never pulls" "$(cat "${CALL_LOG}")" "docker pull"
}

# A registry other than ECR brings its own login; asking AWS for an ECR
# password would fail on a box with no AWS role.
test_update_skips_the_ecr_login_for_another_registry() {
  echo "update.sh: prebuilt image from a registry other than ECR"
  reset_database
  seed_two_pending_migrations
  run_update_script \
    VOCION_APP_IMAGE="localhost:5000/vocion-app:abc1234" \
    FAKE_IMAGE_APP_URL=https://fixture.example
  check_exit_code "exits 0" 0 "${UPDATE_EXIT}"
  check_absent "never calls aws" "$(cat "${CALL_LOG}")" "aws ecr"
  check_contains "pulls the image" "$(cat "${CALL_LOG}")" \
    "docker pull --quiet localhost:5000/vocion-app:abc1234"
}

test_update_stops_when_the_ecr_login_fails() {
  echo "update.sh: box role can't log in to ECR"
  run_update_script VOCION_APP_IMAGE="${ECR_IMAGE}" FAKE_AWS_FAIL=1
  check_exit_code "exits non-zero" nonzero "${UPDATE_EXIT}"
  check_contains "names the permission the role needs" "${UPDATE_OUTPUT}" \
    "ecr:GetAuthorizationToken"
  check_absent "never pulls" "$(cat "${CALL_LOG}")" "docker pull"
}

# With no app URL in the env file there is nothing to check the image
# against, and skipping the check would let any environment's image through.
test_update_refuses_an_image_when_the_box_has_no_app_url() {
  echo "update.sh: prebuilt image, no NEXT_PUBLIC_APP_URL on the box"
  local env_file="${FIXTURE_REPO}/infra/aws/.env.production"
  sed -i.with-url '/^NEXT_PUBLIC_APP_URL=/d' "${env_file}"
  run_update_script VOCION_APP_IMAGE="${ECR_IMAGE}" FAKE_IMAGE_APP_URL=https://fixture.example
  mv "${env_file}.with-url" "${env_file}"
  check_exit_code "exits non-zero" nonzero "${UPDATE_EXIT}"
  check_contains "names the missing value" "${UPDATE_OUTPUT}" "NEXT_PUBLIC_APP_URL is missing"
  check_absent "never pulls" "$(cat "${CALL_LOG}")" "docker pull"
}

# Rolling back to a ref from before prebuilt images leaves no pull script.
# Building instead would quietly do the risky thing the caller opted out of.
test_update_with_an_image_on_a_ref_without_the_pull_script() {
  echo "update.sh: prebuilt image on a ref from before pull-app-image.sh"
  local saved="${WORK_DIR}/saved-pull-app-image.sh"
  mv "${FIXTURE_REPO}/infra/aws/pull-app-image.sh" "${saved}"
  run_update_script VOCION_APP_IMAGE="${ECR_IMAGE}"
  mv "${saved}" "${FIXTURE_REPO}/infra/aws/pull-app-image.sh"
  check_exit_code "exits non-zero" nonzero "${UPDATE_EXIT}"
  check_contains "says to deploy that ref without an image" "${UPDATE_OUTPUT}" \
    "Deploy it without VOCION_APP_IMAGE"
  check_absent "never builds on the box" "$(cat "${CALL_LOG}")" "docker build"
}

# ----------------------------------------------------------------------
# install-buildx.sh tests
# ----------------------------------------------------------------------

test_install_buildx_does_nothing_when_present() {
  echo "install-buildx.sh: plugin already there"
  run_install_buildx FAKE_DOCKER_BUILDX_MISSING=
  check_exit_code "exits 0" 0 "${INSTALL_BUILDX_EXIT}"
  check_absent "downloads nothing" "$(cat "${CALL_LOG}")" "curl"
  check_no_buildx_plugin_left "installs nothing"
}

test_install_buildx_picks_the_release_for_the_machine() {
  echo "install-buildx.sh: arm64 box"
  run_install_buildx FAKE_UNAME_MACHINE=aarch64
  check_exit_code "exits 0" 0 "${INSTALL_BUILDX_EXIT}"
  check_contains "downloads the arm64 release" "$(cat "${CALL_LOG}")" \
    "releases/download/v0.37.1/buildx-v0.37.1.linux-arm64"
  check_contains "reports the install" "${INSTALL_BUILDX_OUTPUT}" \
    "docker-buildx v0.37.1 installed"
}

# A download that doesn't match the pinned checksum is never installed: a
# swapped release or a proxy's error page must not end up run as root.
test_install_buildx_rejects_a_checksum_mismatch() {
  echo "install-buildx.sh: checksum mismatch"
  run_install_buildx FAKE_CURL_TAMPERED=1
  check_exit_code "exits non-zero" nonzero "${INSTALL_BUILDX_EXIT}"
  check_contains "names the mismatch" "${INSTALL_BUILDX_OUTPUT}" "ERROR: checksum mismatch"
  check_no_buildx_plugin_left "leaves no plugin and no partial download"
}

test_install_buildx_leaves_nothing_after_a_failed_download() {
  echo "install-buildx.sh: download fails"
  run_install_buildx FAKE_CURL_FAIL=1
  check_exit_code "exits non-zero" nonzero "${INSTALL_BUILDX_EXIT}"
  check_no_buildx_plugin_left "leaves no plugin and no partial download"
}

test_install_buildx_refuses_an_unknown_machine() {
  echo "install-buildx.sh: unsupported machine"
  run_install_buildx FAKE_UNAME_MACHINE=riscv64
  check_exit_code "exits non-zero" nonzero "${INSTALL_BUILDX_EXIT}"
  check_contains "names the machine" "${INSTALL_BUILDX_OUTPUT}" "uname -m: riscv64"
  check_absent "downloads nothing" "$(cat "${CALL_LOG}")" "curl"
}

# The Docker CLI can still fail to load a plugin that downloaded and matched,
# say one built for another libc. The install says so rather than letting the
# build fall through to the legacy builder's "--mount option requires BuildKit".
test_install_buildx_checks_the_plugin_loads() {
  echo "install-buildx.sh: plugin installed but not loadable"
  run_install_buildx \
    PATH="${FAKE_CURL_DIR}:${FAKE_DOCKER_NO_BUILDX_DIR}:${FAKE_DOCKER_DIR}:${PATH}"
  check_exit_code "exits non-zero" nonzero "${INSTALL_BUILDX_EXIT}"
  check_contains "says the plugin still doesn't load" "${INSTALL_BUILDX_OUTPUT}" \
    "still fails"
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

# bootstrap.sh builds the image too, so a fresh box needs buildx before that.
test_bootstrap_installs_buildx_before_building() {
  echo "bootstrap.sh: box without the buildx plugin"
  reset_database
  seed_two_pending_migrations
  rm -rf "${BUILDX_PLUGIN_ROOT}"
  run_bootstrap_script \
    PATH="${FAKE_CURL_DIR}:${FAKE_DOCKER_DIR}:${PATH}" \
    FAKE_DOCKER_BUILDX_MISSING=1 \
    DOCKER_CONFIG="${BUILDX_PLUGIN_ROOT}"
  check_exit_code "exits 0" 0 "${BOOTSTRAP_EXIT}"
  check_order "downloads the pinned buildx release before building the image" \
    "$(cat "${CALL_LOG}")" \
    "releases/download/v0.37.1/buildx-v0.37.1.linux-amd64" "docker build -t vocion-app:latest"
}

# A fresh box pulls its first image too, so it never compiles at all.
test_bootstrap_pulls_a_prebuilt_image_instead_of_building() {
  echo "bootstrap.sh: prebuilt image from ECR"
  reset_database
  seed_two_pending_migrations
  run_bootstrap_script \
    VOCION_APP_IMAGE="${ECR_IMAGE}" \
    FAKE_IMAGE_APP_URL=https://fixture.example
  local calls
  calls="$(cat "${CALL_LOG}")"
  check_exit_code "exits 0" 0 "${BOOTSTRAP_EXIT}"
  check_order "pulls the image before the stack comes up" "${BOOTSTRAP_OUTPUT}" \
    "pulled ${ECR_IMAGE}" "starting Vocion stack"
  check_absent "never builds on the box" "${calls}" "docker build"
  check_contains "reports completion" "${BOOTSTRAP_OUTPUT}" "bootstrap complete"
}

# The env file may quote its values; bootstrap.sh must compare the URL
# itself, not the quotes, or a correct image is refused.
test_bootstrap_reads_a_quoted_app_url() {
  echo "bootstrap.sh: quoted NEXT_PUBLIC_APP_URL"
  reset_database
  seed_two_pending_migrations
  local env_file="${FIXTURE_REPO}/infra/aws/.env.production"
  sed -i.unquoted 's|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL="https://fixture.example"|' "${env_file}"
  run_bootstrap_script \
    VOCION_APP_IMAGE="${ECR_IMAGE}" \
    FAKE_IMAGE_APP_URL=https://fixture.example
  mv "${env_file}.unquoted" "${env_file}"
  check_exit_code "exits 0" 0 "${BOOTSTRAP_EXIT}"
}

test_bootstrap_refuses_an_image_when_the_box_has_no_app_url() {
  echo "bootstrap.sh: prebuilt image, no NEXT_PUBLIC_APP_URL on the box"
  local env_file="${FIXTURE_REPO}/infra/aws/.env.production"
  sed -i.with-url '/^NEXT_PUBLIC_APP_URL=/d' "${env_file}"
  run_bootstrap_script VOCION_APP_IMAGE="${ECR_IMAGE}" FAKE_IMAGE_APP_URL=https://fixture.example
  mv "${env_file}.with-url" "${env_file}"
  check_exit_code "exits non-zero" nonzero "${BOOTSTRAP_EXIT}"
  check_contains "names the missing value" "${BOOTSTRAP_OUTPUT}" "NEXT_PUBLIC_APP_URL is empty"
  check_absent "never pulls" "$(cat "${CALL_LOG}")" "docker pull"
}

test_bootstrap_refuses_an_image_built_for_another_url() {
  echo "bootstrap.sh: image built for another environment"
  run_bootstrap_script \
    VOCION_APP_IMAGE="${ECR_IMAGE}" \
    FAKE_IMAGE_APP_URL=https://dev.fixture.example
  check_exit_code "exits non-zero" nonzero "${BOOTSTRAP_EXIT}"
  check_contains "names both URLs" "${BOOTSTRAP_OUTPUT}" \
    "built for 'https://dev.fixture.example', but this box serves https://fixture.example"
  check_absent "never starts the stack" "${BOOTSTRAP_OUTPUT}" "starting Vocion stack"
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
# push-app-image.sh tests — `docker buildx build` itself is faked; the
# real build, push and pull are exercised in CI (see infra/aws/README.md).
# ----------------------------------------------------------------------

ECR_REPOSITORY="123456789012.dkr.ecr.us-east-1.amazonaws.com/vocion-app"

test_push_builds_and_pushes_one_tagged_image() {
  echo "push-app-image.sh: CI build to ECR"
  run_push_script \
    APP_IMAGE_REPOSITORY="${ECR_REPOSITORY}" \
    IMAGE_TAG=abc1234 \
    -- \
    --build-arg NEXT_PUBLIC_APP_URL=https://app.example \
    --build-arg NEXT_PUBLIC_BRAND_NAME=Fixture
  local build_call
  build_call="$(grep '^docker buildx build ' "${CALL_LOG}")"
  check_exit_code "exits 0" 0 "${PUSH_EXIT}"
  check_contains "logs in to ECR in the repository's own region" "$(cat "${CALL_LOG}")" \
    "aws ecr get-login-password --region us-east-1"
  check_contains "tags the image with the commit" "${build_call}" \
    "--tag ${ECR_REPOSITORY}:abc1234"
  check_contains "stamps the app URL on the image for the pull to check" "${build_call}" \
    "--label org.vocion.app-url=https://app.example"
  check_contains "reads the cache from the repository" "${build_call}" \
    "--cache-from type=registry,ref=${ECR_REPOSITORY}:buildcache"
  # ECR rejects a registry cache in any other form.
  check_contains "writes every layer to the cache in the form ECR stores" "${build_call}" \
    "--cache-to type=registry,ref=${ECR_REPOSITORY}:buildcache,mode=max,image-manifest=true,oci-mediatypes=true"
  check_contains "pushes the image" "${build_call}" "--push"
  check_contains "passes the other build arguments through" "${build_call}" \
    "--build-arg NEXT_PUBLIC_BRAND_NAME=Fixture"
  check_contains "builds the core Dockerfile" "${build_call}" \
    "--file ${FIXTURE_REPO}/packages/core/Dockerfile"
  check_contains "hands the image to the deploy job" "$(cat "${PUSH_STEP_OUTPUTS}")" \
    "image=${ECR_REPOSITORY}:abc1234"
}

test_push_tags_with_the_github_commit_by_default() {
  echo "push-app-image.sh: tag from GITHUB_SHA"
  run_push_script \
    APP_IMAGE_REPOSITORY=localhost:5000/vocion-app \
    GITHUB_SHA=0123456789abcdef \
    -- \
    --build-arg=NEXT_PUBLIC_APP_URL=https://app.example
  local build_call
  build_call="$(grep '^docker buildx build ' "${CALL_LOG}")"
  check_exit_code "exits 0" 0 "${PUSH_EXIT}"
  check_contains "tags the image with GITHUB_SHA" "${build_call}" \
    "--tag localhost:5000/vocion-app:0123456789abcdef"
  check_contains "reads the --build-arg=NAME=value form" "${build_call}" \
    "--label org.vocion.app-url=https://app.example"
  check_absent "never calls aws for another registry" "$(cat "${CALL_LOG}")" "aws ecr"
}

# The default `docker` builder can't write a registry cache, so a runner
# without the named builder gets one; a runner that has it reuses it.
test_push_creates_its_builder_only_when_missing() {
  echo "push-app-image.sh: buildx builder"
  run_push_script \
    APP_IMAGE_REPOSITORY=localhost:5000/vocion-app IMAGE_TAG=abc1234 FAKE_BUILDER_MISSING=1 \
    -- --build-arg NEXT_PUBLIC_APP_URL=https://app.example
  check_exit_code "exits 0 on a fresh runner" 0 "${PUSH_EXIT}"
  check_order "creates a docker-container builder before building" "$(cat "${CALL_LOG}")" \
    "docker buildx create --name vocion-app-builder --driver docker-container" \
    "docker buildx build --builder vocion-app-builder"
  run_push_script \
    APP_IMAGE_REPOSITORY=localhost:5000/vocion-app IMAGE_TAG=abc1234 \
    -- --build-arg NEXT_PUBLIC_APP_URL=https://app.example
  check_absent "reuses a builder that is already there" "$(cat "${CALL_LOG}")" "buildx create"
}

# A failed build must not hand the deploy job an image name, or the deploy
# would pull whatever that tag held before.
test_push_reports_no_image_when_the_build_fails() {
  echo "push-app-image.sh: build fails"
  run_push_script \
    APP_IMAGE_REPOSITORY=localhost:5000/vocion-app IMAGE_TAG=abc1234 FAKE_BUILDX_BUILD_FAIL=1 \
    -- --build-arg NEXT_PUBLIC_APP_URL=https://app.example
  check_exit_code "exits non-zero" nonzero "${PUSH_EXIT}"
  check_absent "writes no image output" "$(cat "${PUSH_STEP_OUTPUTS}")" "image="
  check_absent "never says it pushed" "${PUSH_OUTPUT}" "pushed "
}

test_push_stops_when_the_ecr_login_fails() {
  echo "push-app-image.sh: CI role can't log in to ECR"
  run_push_script \
    APP_IMAGE_REPOSITORY="${ECR_REPOSITORY}" IMAGE_TAG=abc1234 FAKE_AWS_FAIL=1 \
    -- --build-arg NEXT_PUBLIC_APP_URL=https://app.example
  check_exit_code "exits non-zero" nonzero "${PUSH_EXIT}"
  check_contains "names the permission the role needs" "${PUSH_OUTPUT}" \
    "ecr:GetAuthorizationToken"
  check_absent "never builds" "$(cat "${CALL_LOG}")" "buildx build"
}

# Passes when the last push run refused before building anything.
check_push_refused() {
  local label="$1"
  if [ "${PUSH_EXIT}" -ne 0 ] && ! grep -qF "buildx build" "${CALL_LOG}"; then
    pass "${label}"
  else
    fail "${label}" "exit ${PUSH_EXIT}; build calls: $(grep -c 'buildx build' "${CALL_LOG}")"
  fi
}

# Each refusal is a push that would leave a deploy nothing safe to pull.
test_push_refuses_what_a_deploy_could_not_use() {
  echo "push-app-image.sh: refusals"
  run_push_script IMAGE_TAG=abc1234 -- --build-arg NEXT_PUBLIC_APP_URL=https://app.example
  check_push_refused "refuses without a repository"
  run_push_script APP_IMAGE_REPOSITORY=localhost:5000/vocion-app \
    -- --build-arg NEXT_PUBLIC_APP_URL=https://app.example
  check_push_refused "refuses without a tag outside GitHub Actions"
  run_push_script APP_IMAGE_REPOSITORY=localhost:5000/vocion-app IMAGE_TAG=latest \
    -- --build-arg NEXT_PUBLIC_APP_URL=https://app.example
  check_push_refused "refuses the tag latest, which the next push would overwrite"
  run_push_script APP_IMAGE_REPOSITORY=localhost:5000/vocion-app IMAGE_TAG=buildcache \
    -- --build-arg NEXT_PUBLIC_APP_URL=https://app.example
  check_push_refused "refuses the cache's own tag"
  run_push_script APP_IMAGE_REPOSITORY=localhost:5000/vocion-app IMAGE_TAG=abc1234 \
    -- --build-arg NEXT_PUBLIC_BRAND_NAME=Fixture
  check_push_refused "refuses a build with no app URL"
  check_contains "says which build argument is missing" "${PUSH_OUTPUT}" \
    "--build-arg NEXT_PUBLIC_APP_URL=https://<host>"
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
  for script in apply-migrations.sh update.sh bootstrap.sh install-buildx.sh \
    pull-app-image.sh push-app-image.sh; do
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
  test_concurrently_only_in_line_comment_uses_a_transaction
  test_concurrently_only_in_block_comment_uses_a_transaction
  test_concurrently_comment_and_real_statement_still_detected
  test_concurrent_directory_applies_after_its_migration
  test_concurrent_build_needs_its_numbered_migration_first
  test_baseline_all_leaves_concurrent_builds_pending
  test_orphan_concurrent_build_is_left_alone
  test_concurrently_inside_a_string_literal_keeps_the_transaction
  test_two_concurrent_builds_share_one_number
  test_failing_concurrent_build_stops_the_run
  test_check_mode_reports_concurrent_builds_without_running_them
  test_verify_indexes_passes_when_the_build_landed
  test_verify_indexes_catches_a_skipped_directory
  test_verify_indexes_catches_an_invalid_index
  test_verify_indexes_with_nothing_declared
  test_verify_indexes_writes_nothing
  test_verify_indexes_names_the_file_and_the_command
  test_verify_indexes_ignores_a_name_in_a_comment
  test_verify_indexes_with_a_drop_only_file
  test_verify_indexes_counts_a_repeated_name_once
  test_verify_indexes_checks_a_unique_build
  test_verify_indexes_refuses_to_be_combined
  test_verify_indexes_on_an_unreachable_container
  test_unreachable_container_fails_loudly
  test_default_container_and_database_match_compose

  test_update_migrates_before_rolling_containers
  test_update_installs_buildx_before_building
  test_update_stops_when_buildx_cannot_be_installed
  test_update_rolls_back_to_a_ref_without_the_installer
  test_update_pulls_a_prebuilt_image_instead_of_building
  test_update_stops_when_the_image_cannot_be_pulled
  test_update_retries_a_pull_that_fails_once
  test_update_refuses_an_image_built_for_another_url
  test_update_refuses_an_image_without_the_url_label
  test_update_refuses_an_image_without_a_tag
  test_update_skips_the_ecr_login_for_another_registry
  test_update_stops_when_the_ecr_login_fails
  test_update_refuses_an_image_when_the_box_has_no_app_url
  test_update_with_an_image_on_a_ref_without_the_pull_script
  test_update_reads_env_from_infra_aws
  test_update_aborts_on_migration_failure
  test_update_with_no_pending_migrations_still_rolls
  test_update_fails_without_an_env_file
  test_update_fails_when_a_required_build_value_is_missing
  test_update_tolerates_missing_optional_values
  test_update_warns_when_both_env_files_exist
  test_update_accepts_the_legacy_env_location

  test_bootstrap_applies_migrations_and_completes
  test_bootstrap_installs_buildx_before_building
  test_bootstrap_pulls_a_prebuilt_image_instead_of_building
  test_bootstrap_reads_a_quoted_app_url
  test_bootstrap_refuses_an_image_built_for_another_url
  test_bootstrap_refuses_an_image_when_the_box_has_no_app_url
  test_bootstrap_aborts_on_migration_failure
  test_bootstrap_aborts_without_an_env_file

  test_install_buildx_does_nothing_when_present
  test_install_buildx_picks_the_release_for_the_machine
  test_install_buildx_rejects_a_checksum_mismatch
  test_install_buildx_leaves_nothing_after_a_failed_download
  test_install_buildx_refuses_an_unknown_machine
  test_install_buildx_checks_the_plugin_loads

  test_push_builds_and_pushes_one_tagged_image
  test_push_tags_with_the_github_commit_by_default
  test_push_creates_its_builder_only_when_missing
  test_push_reports_no_image_when_the_build_fails
  test_push_stops_when_the_ecr_login_fails
  test_push_refuses_what_a_deploy_could_not_use

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
