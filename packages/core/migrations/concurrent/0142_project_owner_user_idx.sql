-- Applied outside a transaction by infra/aws/apply-migrations.sh, straight
-- after the numbered 0142 that adds the column.
--
-- `project` already exists, so a plain CREATE INDEX would hold a lock that
-- blocks every write to it for the length of the build. Numbered 0142 because
-- that is the migration introducing `owner_user_id`; a build placed ahead of
-- its column stops the deploy.
--
-- The DROP clears an INVALID index left behind by a build that died partway:
-- `IF NOT EXISTS` alone would then skip the retry forever.
DROP INDEX IF EXISTS "project_owner_user_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "project_owner_user_idx"
  ON "project" USING btree ("owner_user_id");
