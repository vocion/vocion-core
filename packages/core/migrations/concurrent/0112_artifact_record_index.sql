-- Applied outside a transaction by infra/aws/apply-migrations.sh.
-- `artifact` is populated, so its lookup index for the record scope added in
-- 0112 is built concurrently (CONVENTIONS.md rule 1).
--
-- The DROP clears an INVALID index left behind by a build that failed
-- partway; a concurrent build that dies leaves the index in place, and
-- `IF NOT EXISTS` on its own would then skip the retry forever.
DROP INDEX IF EXISTS "artifact_org_record_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "artifact_org_record_idx"
  ON "artifact" USING btree ("org_id", "record_type", "record_id", "record_role");
