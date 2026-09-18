-- The action-type → regenerate-skill mapping becomes workspace config.
--
-- Regenerate's fast path runs ONE workspace skill in a scoped turn, and which
-- skill answers for which review-item type is the workspace's decision
-- (authored as `defaults.regenerateSkills` in workspace.yaml), never a slug
-- hardcoded in core. NULL, or a missing key, means no fast path: the action's
-- regenerate falls back to its full pass.
ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "regenerate_skills" jsonb;
