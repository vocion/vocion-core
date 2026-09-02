-- The drafting slice (MQL review objects). `draft_sequence` and
-- `review_action_run_id` already exist and are empty, so only what is
-- genuinely absent is added here.
--
--   1. `mql_at` is HubSpot's stage-entry date, stamped from the mirror once
--      the connector carries it. Null means the mirror had nothing: the card
--      falls back to the arrival date, labeled "Arrived", never mislabeled
--      as when the contact became an MQL.
--   2. `recommended_sequence` names the EXISTING HubSpot sequence the agent
--      recommends enrolling into — id, name, the sender, and why. The agent
--      never invents a sequence; the drafts are that sequence's sends,
--      personalized for the lead.
--   3. `draft_attempts` counts the drafting tries, same three-try budget the
--      briefs use. Claiming the work counts the try.
--   4. `draft_error` is the text from the last drafting failure, so a lead
--      whose drafts never arrive says why.
--   5. `last_draft_attempt_at` is when a drafting try was handed out — the
--      same retry floor that stops one run burning every try in a minute.
--
-- Hand-written (drizzle snapshots froze at 0022); additive + nullable,
-- IF NOT EXISTS, idempotent.
ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "mql_at" timestamp;--> statement-breakpoint

ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "recommended_sequence" jsonb;--> statement-breakpoint

ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "draft_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "draft_error" text;--> statement-breakpoint

ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "last_draft_attempt_at" timestamp;
