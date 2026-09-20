-- 0127 — how eager a workspace is to improve itself.
--
-- One dial, 0 to 10, moving the confidence bar for the class of actions that
-- change what the SYSTEM knows about how to work: the rule it adopts from a
-- correction today, more nouns later (`libs/actions/eagerness.ts`; an action
-- opts into the class with `selfImproving`). 0 always asks; 10 runs on
-- anything it is plainly confident about. It moves the bar, never the
-- confidence — an inferred rule still asks at 10.
--
-- Authored as `defaults.learningEagerness` in workspace.yaml and replaced on
-- every apply, the same declarative rule as enabled_surfaces.
--
-- Nullable with NO default, on purpose: NULL is "this workspace authored
-- nothing" and reads as the shipped default of 7, while a stored 7 is a
-- workspace that chose it. A `DEFAULT 7` would collapse the two, and the day
-- the shipped default changes every existing workspace would silently keep
-- the old number.
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "learning_eagerness" integer;
--> statement-breakpoint
ALTER TABLE "project" DROP CONSTRAINT IF EXISTS "project_learning_eagerness_ck";
--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_learning_eagerness_ck" CHECK ("learning_eagerness" IS NULL OR ("learning_eagerness" >= 0 AND "learning_eagerness" <= 10));
