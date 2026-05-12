#!/usr/bin/env bash
# infra/aws/apply-migrations.sh — psql-based migration applier for prod.
#
# Why this exists: the canonical migrator is `drizzle-kit migrate`, but
# drizzle-kit is a devDep trimmed out of the Next.js standalone Docker
# image. `npm run db:migrate` inside the prod container fails with
# MODULE_NOT_FOUND. Rather than ship a parallel TS migrator image, we
# apply migrations directly via psql against the in-VPC corecontext-
# postgres container.
#
# Idempotent — every migration is recorded in a `__pgsql_migrations`
# table (separate from drizzle's `__drizzle_migrations` since we're
# not pretending to be drizzle). Re-running this script after a deploy
# only applies new files.
#
# Run from the EC2:
#
#   sudo bash /opt/vocion/infra/aws/apply-migrations.sh
#
# Or pipe a single SQL file:
#
#   sudo docker exec -i corecontext-postgres psql -U postgres \
#     -d corecontext -v ON_ERROR_STOP=1 < /opt/vocion/packages/core/migrations/0099_new.sql

set -euo pipefail

CONTAINER="${POSTGRES_CONTAINER:-corecontext-postgres}"
DB_NAME="${POSTGRES_DB:-corecontext}"
DB_USER="${POSTGRES_USER:-postgres}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/opt/vocion/packages/core/migrations}"

log() { echo "[apply-migrations] $*"; }

# Ensure the tracking table exists.
sudo docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 -c "
  CREATE TABLE IF NOT EXISTS __pgsql_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
" >/dev/null

# Each migration file applies inside a transaction. ON_ERROR_STOP aborts
# the file on first error.
applied=0
skipped=0
failed=0
for sql in $(ls -1 "${MIGRATIONS_DIR}"/[0-9]*.sql 2>/dev/null | sort); do
  name=$(basename "${sql}")
  already=$(sudo docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -tA -c \
    "SELECT 1 FROM __pgsql_migrations WHERE name = '${name}';" 2>/dev/null || true)
  if [ "${already}" = "1" ]; then
    skipped=$((skipped+1))
    continue
  fi
  log "applying ${name}"
  if sudo docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 < "${sql}" >/dev/null 2>&1; then
    sudo docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 -c \
      "INSERT INTO __pgsql_migrations (name) VALUES ('${name}');" >/dev/null
    applied=$((applied+1))
  else
    log "  ✗ failed; re-run to retry"
    failed=$((failed+1))
    break
  fi
done

log "${applied} applied · ${skipped} already-applied · ${failed} failed"
exit ${failed}
