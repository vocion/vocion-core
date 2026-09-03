-- Hand-written, per 0066's precedent (the snapshot chain predates it).
--
-- Call prep, written when a lead LEAVES the agent. Separate columns from
-- `sections` on purpose: the review brief is written at research time and
-- answers "should we send this copy"; this is written at handoff time, when
-- the reply text and the delivery record exist, and answers "what do I say
-- now that a person is in the conversation". A handoff re-run must never
-- touch the review brief.
--
-- Idempotent (IF NOT EXISTS), matching the convention 0070 already uses: a
-- renumbered migration, or an environment that applied part of this by hand,
-- must not wedge the whole chain on "already exists".
ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "handoff_sections" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "handoff_trigger" text;--> statement-breakpoint
ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "handoff_at" timestamp;
