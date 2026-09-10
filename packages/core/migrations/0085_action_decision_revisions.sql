-- Decision attribution + the rewrite audit record on action_run.
-- decided_by/decided_at: who took the human decision and when (executed_at is
-- when the machine ran). revisions: the record of AI rewrites asked during
-- review — the draft itself is still only changed by an approve.
ALTER TABLE "action_run" ADD COLUMN IF NOT EXISTS "decided_by" text;--> statement-breakpoint
ALTER TABLE "action_run" ADD COLUMN IF NOT EXISTS "decided_at" timestamp;--> statement-breakpoint
ALTER TABLE "action_run" ADD COLUMN IF NOT EXISTS "revisions" jsonb;
