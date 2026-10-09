-- Applied outside a transaction by infra/aws/apply-migrations.sh, straight
-- after the numbered 0193 that adds `conversation_id`.
--
-- The open Decisions of one conversation are read on every chat turn (answers
-- first: a message is judged against the open Decision before it is routed),
-- so the read is an index probe, not a scan of every ask. `ask` already
-- exists, so a plain CREATE INDEX would block writes for the build. Partial on
-- `open`, which is the only status the read wants and a small slice of rows.
--
-- The DROP clears an INVALID index left behind by a build that died partway:
-- `IF NOT EXISTS` alone would then skip the retry forever.
DROP INDEX IF EXISTS "ask_conversation_open_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ask_conversation_open_idx"
  ON "ask" USING btree ("org_id", "conversation_id") WHERE "status" = 'open';
