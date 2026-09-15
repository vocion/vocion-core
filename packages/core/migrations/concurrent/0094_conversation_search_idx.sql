-- concurrent/0094_conversation_search_idx.sql
-- Applied outside a transaction by infra/aws/apply-migrations.sh.
--
-- Serves the rail's conversation search (`conversations.search`): a
-- full-text match over thread titles and message content. Both tables are
-- populated, so the GIN builds run CONCURRENTLY here rather than as a
-- blocking CREATE INDEX in 0094. Dev and tests run without them — the
-- query's results are the same, only the plan differs.
--
-- The DROP clears an INVALID index left behind by a build that failed
-- partway; a concurrent build that dies leaves the index in place, and
-- `IF NOT EXISTS` on its own would then skip the retry forever.
DROP INDEX IF EXISTS "conversation_title_fts_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversation_title_fts_idx"
  ON "conversation" USING gin (to_tsvector('simple', "title"));
DROP INDEX IF EXISTS "conversation_message_content_fts_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversation_message_content_fts_idx"
  ON "conversation_message" USING gin (to_tsvector('simple', "content"));
