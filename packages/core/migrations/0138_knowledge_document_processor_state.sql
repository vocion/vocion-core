-- 0138 — whether a document's processor finished on its current content.
--
-- `content_hash` says what was stored. A document processor runs after the
-- store and can fail on its own (a refused or timed-out model call, a spent
-- budget), and until now nothing recorded that, so a document whose processor
-- failed read as done and was not processed again until its content changed.
--
-- `processed_hash` is the content hash the processor last finished on,
-- `processor_attempts` counts tries on the current content that did not
-- finish (counted as each run starts, so a run cut off by a crash or a deploy
-- still counts), and `processor_error` says why the last one did not. The sync
-- runs a document again while the count is above zero and under its cap.
--
-- NULL and zero on every legacy row, which reads as "no failed attempt", so
-- nothing re-runs on deploy and nothing needs backfilling. Nullable columns and
-- a constant default: metadata-only, per CONVENTIONS.md rule 2.
-- Hand-written; idempotent.
ALTER TABLE "knowledge_document" ADD COLUMN IF NOT EXISTS "processed_hash" text;
--> statement-breakpoint
ALTER TABLE "knowledge_document" ADD COLUMN IF NOT EXISTS "processor_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_document" ADD COLUMN IF NOT EXISTS "processor_error" text;
