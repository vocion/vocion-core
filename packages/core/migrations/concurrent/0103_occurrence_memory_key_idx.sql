-- learning_feedback_occurrence is a pre-existing, possibly large table, so its
-- new memory_key index builds here, outside the transactional migration
-- (CONVENTIONS.md rule 1). Replaces learning_feedback_occurrence_learning_idx,
-- whose column 0100 dropped (Postgres drops that index with the column).
DROP INDEX IF EXISTS "learning_feedback_occurrence_memory_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "learning_feedback_occurrence_memory_idx" ON "learning_feedback_occurrence" ("org_id", "memory_key");
