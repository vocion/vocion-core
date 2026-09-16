-- 0107 — consolidation proposals (scoped-memory plan, Phase 4).
--
-- replaces_keys: when the consolidation job proposes one stronger rule that
-- covers several existing ones, approval must also retire the originals —
-- otherwise the queue mints duplicates instead of compacting. The keys ride
-- the candidate so the WHOLE effect (write one, retire N) is what the human
-- approves; nothing is removed before the decision. Nullable jsonb,
-- metadata-only (CONVENTIONS.md rule 2).
ALTER TABLE "learning_candidate" ADD COLUMN IF NOT EXISTS "replaces_keys" jsonb;
