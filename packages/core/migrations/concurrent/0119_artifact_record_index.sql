-- Applied outside a transaction by infra/aws/apply-migrations.sh.
-- `artifact` is populated, so its lookup index for the record scope is built
-- concurrently (CONVENTIONS.md rule 1).
--
-- Numbered 0119, not 0112: record_type and record_id arrive in 0112, but
-- record_role only in 0119_artifact_visibility.sql, and a concurrent file
-- runs straight after the numbered migration sharing its number.
--
-- The DROP clears an INVALID index left behind by a build that failed
-- partway; a concurrent build that dies leaves the index in place, and
-- `IF NOT EXISTS` on its own would then skip the retry forever.
DROP INDEX IF EXISTS "artifact_org_record_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "artifact_org_record_idx"
  ON "artifact" USING btree ("org_id", "record_type", "record_id", "record_role");
