-- The rung a person wants an action to work toward, named during setup (#1028).
-- A goal is a note beside the rung, never the rung: reaching it is still earned
-- from the Autonomy page. Replay-safe: every deploy re-runs this file.
ALTER TABLE "autonomy_policy" ADD COLUMN IF NOT EXISTS "goal_rung" text;
--> statement-breakpoint
ALTER TABLE "autonomy_policy" ADD COLUMN IF NOT EXISTS "goal_set_by" text;
--> statement-breakpoint
ALTER TABLE "autonomy_policy" ADD COLUMN IF NOT EXISTS "goal_set_at" timestamp;
