-- 0092 — the team report's three inputs (ADR 0004 phase 3, first slice).
--
-- worker_run.kind: WHAT SORT of run this was, so the dashboard can tell a
--   board review (the Fable-level pass over the whole company) from a lead's
--   planning cycle, a worker's dispatch, an adversarial red-team grade, or a
--   compaction pass — without parsing `input`. Text, not an enum, like status:
--   a new kind is a code change. Default 'worker' keeps every existing row and
--   every existing caller meaning what it meant.
-- worker_run.model: the model the worker reported on its heartbeat. Until now
--   it was used to price the charge and dropped; the report needs it to say
--   which model did which work.
-- worker_run.summary: the worker's own one-paragraph account of the run, as a
--   column so a list of a hundred runs reads without opening `result`.
-- team.goal / team.kpis: the team's standing goal and the measures it is
--   graded on (authored in teams/<slug>.yaml). The team row's comment has
--   reserved this attachment point since F1; this is the first thing to use it.
-- project.goal: the workspace's top-line goal (workspace.yaml `goal:`) — the
--   anchor every team's weight and progress is read against.
--
-- All additions are nullable or defaulted, so this is metadata-only
-- (CONVENTIONS.md rule 2) and no index is built on an existing table (rule 1).
ALTER TABLE "worker_run" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'worker' NOT NULL;--> statement-breakpoint
ALTER TABLE "worker_run" ADD COLUMN IF NOT EXISTS "model" text;--> statement-breakpoint
ALTER TABLE "worker_run" ADD COLUMN IF NOT EXISTS "summary" text;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "goal" text;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "kpis" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "goal" text;
