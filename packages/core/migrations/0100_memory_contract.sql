-- 0100 — scoped memory, contract step (pairs with 0099's expand).
--
-- Drops `learning` and `learning_step` after 0099 copied every rule into the
-- store: keeping them would be a dual-write with no reader (the audit trail
-- already lives in learning_candidate + learning_feedback_occurrence, and
-- runtime reads moved to `memory`). The integer back-links go with them:
-- occurrences and candidates now reference store entries by key, backfilled
-- in 0099.
--
-- The target CHECK is re-created around (candidate_id XOR memory_key) so an
-- occurrence still always names exactly one thing. Column drops on existing
-- tables are metadata-only (CONVENTIONS.md rule 2); every reader of the
-- dropped columns ships in the same release.
ALTER TABLE "learning_feedback_occurrence" DROP CONSTRAINT IF EXISTS "learning_feedback_occurrence_target_ck";
--> statement-breakpoint
ALTER TABLE "learning_feedback_occurrence" DROP COLUMN IF EXISTS "learning_id";
--> statement-breakpoint
ALTER TABLE "learning_feedback_occurrence" ADD CONSTRAINT "learning_feedback_occurrence_target_ck" CHECK (
  ("candidate_id" IS NOT NULL AND "memory_key" IS NULL)
  OR ("candidate_id" IS NULL AND "memory_key" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "learning_candidate" DROP COLUMN IF EXISTS "created_learning_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "learning";
--> statement-breakpoint
DROP TABLE IF EXISTS "learning_step";
