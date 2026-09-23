-- 0138: whether a document's processor finished on its current content.
--
-- A document processor runs after the store and can fail on its own, and
-- nothing recorded that, so a document whose processor failed read as done
-- and was not processed again until its content changed. These columns let
-- the sync run it again, up to a cap (see Schema.ts).
--
-- NULL and zero on every legacy row, which reads as not due, so nothing
-- re-runs on deploy and nothing needs backfilling. Nullable columns and a
-- constant default: metadata-only, per CONVENTIONS.md rule 2.
-- Hand-written; idempotent.
ALTER TABLE "knowledge_document" ADD COLUMN IF NOT EXISTS "processed_hash" text;
--> statement-breakpoint
ALTER TABLE "knowledge_document" ADD COLUMN IF NOT EXISTS "processor_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_document" ADD COLUMN IF NOT EXISTS "processor_error" text;
