-- 0132 — one off switch for the whole workspace.
--
-- Per-automation pause (0128) is the right control for "this one debrief is
-- noisy" and the wrong one for "stop". Stopping the Squatch factory on
-- 2026-09-21 meant twenty pause calls typed by hand, and they still left
-- mission runs, worker runs and gated actions running.
--
-- These three columns are the workspace's own hold, the same shape as the
-- automation's so the two read alike. They are deliberately a DIFFERENT fact
-- from `automation.paused_at`: a workspace pause writes no automation row, so
-- resuming the workspace restores exactly the per-automation state that was
-- there before — an automation a person paused last Tuesday is still paused,
-- because nothing touched it.
--
-- Nullable, no default: additive, no table rewrite, no lock. NULL means "not
-- paused"; there is deliberately no boolean beside it to disagree with.
-- `paused_by` is the `user.id` (or a `token:<id>` when an API token placed the
-- hold), resolved to a name when shown.
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "paused_at" timestamp;
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "paused_by" text;
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "paused_note" text;
