-- concurrent/0108_action_run_approved_by_agent_idx.sql
-- Applied outside a transaction by infra/aws/apply-migrations.sh.
--
-- Serves the auto-approved list (`GET /api/v1/reviews/auto-executed`, and the
-- "how many did the agent take on its own" count behind it), which asks for
-- exactly the rows where this column is true, newest decision first.
--
-- The column order and the direction both match that query's ORDER BY
-- (`decided_at DESC NULLS LAST`) so the list reads straight off the index
-- instead of sorting the whole org's auto-approved history to show one page.
-- Change the query's sort and this index stops being used, silently.
--
-- Partial on true for that reason: the runs an agent approved are a small
-- fraction of every run ever decided, and an index over the false and NULL
-- rows too would be most of the table to answer a question nobody asks of it.
--
-- The DROP clears an INVALID index left behind by a build that failed partway;
-- a concurrent build that dies leaves the index in place, and `IF NOT EXISTS`
-- on its own would then skip the retry forever.
DROP INDEX IF EXISTS "action_run_approved_by_agent_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "action_run_approved_by_agent_idx"
  ON "action_run" USING btree ("org_id", "decided_at" DESC NULLS LAST)
  WHERE "approved_by_agent";
