-- The weekly org review: proposals to retire, re-scope or add agents, or to
-- adopt a standing rule, filed on Needs you with the evidence that raised them.
--
-- project.org_review — how this workspace runs its review, authored as
-- `defaults.orgReview` in workspace.yaml: the cron it runs on, whether it runs
-- at all, how many days without a run make an agent idle, how many days
-- without a read or a restatement make a rule stale, and how many proposals one
-- review may file. NULL means the workspace said nothing and the shipped
-- defaults apply (weekly, 14 days idle, 60 days stale, 5 proposals) — a column
-- default would make "unset" and "deliberately the default" the same fact.
--
-- agent.paused_* — a person's hold on an agent. Retiring an agent from the
-- review sets `active = false`, the state the applier already gives an agent
-- the workspace stopped shipping, and records who held it, when and why here.
-- `workspace:apply` never writes these columns and keeps a held agent inactive
-- whatever its YAML says, the way it re-asserts a paused automation: a deploy
-- does not lift a person's decision. Undo on the run clears the hold and
-- restores `active`.
--
-- Expand-only: four nullable columns, no default, no index. Every existing row
-- reads NULL, which is what it is — never held, never configured.
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "org_review" jsonb;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "paused_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "paused_by" text;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "paused_note" text;
