-- Applied outside a transaction by infra/aws/apply-migrations.sh.
-- The artifacts log (/dashboard/artifacts) lists a workspace's artifacts
-- newest-edited first; `artifact` already carries production rows, so the
-- index build is concurrent (CONVENTIONS.md rule 1).
-- The DROP clears an INVALID index left behind by a build that failed partway.
DROP INDEX IF EXISTS "artifact_org_updated_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "artifact_org_updated_idx"
  ON "artifact" USING btree ("org_id", "updated_at");
