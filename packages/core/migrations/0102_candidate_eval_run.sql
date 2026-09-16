-- 0102 — eval evidence on the candidate card (scoped-memory plan, Phase 3).
--
-- eval_run_id: when approving a rule triggers the affected agent's eval
-- dataset, the run lands here so the card can show the before/after score
-- next to the adoption. Nullable, no FK: eval runs are prunable history and
-- a dangling id must never block deleting one. Metadata-only
-- (CONVENTIONS.md rule 2).
ALTER TABLE "learning_candidate" ADD COLUMN IF NOT EXISTS "eval_run_id" integer;
