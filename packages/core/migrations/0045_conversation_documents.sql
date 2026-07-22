-- Persist cited source documents per assistant turn, so inline [n] citations
-- still resolve and the Sources drawer repopulates after a reload (previously
-- only runs_json was stored, so citations were lost on refresh).
--
-- Hand-written to match the established pattern since 0022 (drizzle snapshots
-- froze at 0022; migrations 0023+ are authored by hand). Additive + nullable
-- and IF NOT EXISTS, so it is idempotent — a no-op on the live DB where it was
-- already applied directly, and additive on any fresh deploy.
ALTER TABLE "conversation_message" ADD COLUMN IF NOT EXISTS "documents_json" jsonb;
