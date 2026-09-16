-- 0101 — typed, scoped candidates (scoped-memory plan, Phase 2).
--
-- memory_type: what KIND of memory the rule is — 'preference' | 'knowledge'
--   | 'procedure' (episodes never pass through the candidate queue). Proposed
--   by the classifier, editable on the approval card. Null means the
--   pre-Phase-2 default: a procedure-flavoured workspace rule.
-- scope_kind / scope_ref: where the rule lands on approval. Null scope_kind
--   keeps today's behavior (the workspace-scoped namespace named by
--   step_name). 'agent' + slug, 'user' + user id, 'object' + type/id land in
--   the matching scoped namespace, created on first use.
--
-- Storing rule (enforced in the classifier prompt, editable on the card):
-- a memory lives at the broadest scope where it is consistently true, and no
-- broader. All additions nullable — metadata-only (CONVENTIONS.md rule 2).
ALTER TABLE "learning_candidate" ADD COLUMN IF NOT EXISTS "memory_type" text;
--> statement-breakpoint
ALTER TABLE "learning_candidate" ADD COLUMN IF NOT EXISTS "scope_kind" text;
--> statement-breakpoint
ALTER TABLE "learning_candidate" ADD COLUMN IF NOT EXISTS "scope_ref" text;
