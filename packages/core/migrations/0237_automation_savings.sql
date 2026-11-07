-- What automations saved (libs/routines/savings.ts): the workspace's hourly rate for people's time,
-- a sample marker on batches (seeded history, labelled), and the expert's decisions per run.
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "hourly_rate" jsonb;--> statement-breakpoint
ALTER TABLE "routine_batch" ADD COLUMN IF NOT EXISTS "sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "routine_run" ADD COLUMN IF NOT EXISTS "decisions" integer DEFAULT 0 NOT NULL;
