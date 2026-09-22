-- 0128 — a person's pause on an automation, with who and why.
--
-- `status` is what the YAML says (`active` | `disabled`) and the applier
-- replaces it on every apply, so it cannot carry a hold a person placed from
-- the app: the next apply would silently resume it. These three columns are
-- that hold, set together and cleared together. `paused_by` is the `user.id`;
-- the name is resolved when shown, and is also written into the `control`
-- run row the pause leaves in `automation_run`, so the log reads without a
-- join even after the user is gone.
--
-- Nullable, no default: additive, no table rewrite, no lock. NULL means "not
-- paused"; there is deliberately no boolean beside it to disagree with.
ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "paused_at" timestamp;
--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "paused_by" text;
--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "paused_note" text;
