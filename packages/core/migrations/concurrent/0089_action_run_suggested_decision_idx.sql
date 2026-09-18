-- concurrent/0089_action_run_suggested_decision_idx.sql
-- Applied outside a transaction by infra/aws/apply-migrations.sh.
--
-- Serves `GET /api/v1/reviews?suggestedDecision=…`, which reads a key inside
-- the proposal blob that no existing index can answer. Partial on the two
-- statuses the queue draws from, so the index stays the size of the open
-- queue rather than the size of every decision ever made.
--
-- The DROP clears an INVALID index left behind by a build that failed
-- partway; a concurrent build that dies leaves the index in place, and
-- `IF NOT EXISTS` on its own would then skip the retry forever.
DROP INDEX IF EXISTS "action_run_suggested_decision_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "action_run_suggested_decision_idx"
  ON "action_run" USING btree ("org_id", (("proposal" ->> 'suggestedDecision')))
  WHERE "status" IN ('pending', 'failed');
