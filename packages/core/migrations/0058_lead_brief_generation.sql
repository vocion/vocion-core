-- Brief generation. `claims`, `missing`, `confidence`, `brief_version`,
-- `workspace_sha`, `briefed_by`, `briefed_at` and `skipped_reason` already
-- exist and are empty, so only what is genuinely absent is added here.
--
--   1. `sections` is the brief as written prose, in the order the page renders
--      it. `claims` already holds the research structurally; this is the part
--      a reviewer actually reads. Empty is what keeps a lead off the screen.
--   2. `regenerate_note` is the reviewer's instruction for the next pass. A
--      rewrite without a reason teaches nothing.
--   3. `brief_attempts` counts the tries. Three, then the lead surfaces.
--   4. `brief_error` is the text from the last failure, rendered where the
--      brief would be.
--   5. `last_attempt_at` is when a try was handed out. Without it, "an hour
--      apart" would rest on the cron schedule alone and a single run could
--      spend all three tries in a minute.
--
-- Hand-written; idempotent.
ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "sections" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "regenerate_note" text;--> statement-breakpoint

ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "brief_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "brief_error" text;--> statement-breakpoint

ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamp;
