-- Who made the approval call on an action run: an agent, or a person.
--
-- Nullable on purpose, and read as three states rather than two:
--   NULL  - nobody has decided yet (the run is still open in the queue), and
--           every run decided before this column shipped
--   true  - the trust ladder released it without a person
--   false - a person approved or rejected it in the review queue
--
-- A NOT NULL DEFAULT false would be cheaper to query and wrong: it would make
-- every run still waiting in the queue read as human-approved, and "nobody has
-- looked at this yet" and "a person said yes" are the two facts this column
-- exists to tell apart.
--
-- The column records the APPROVAL decision only. A person who later rejects or
-- cancels a run an agent approved does not flip it; that reversal moves
-- `status`. Flipping it would erase the thing being audited.
--
-- Additive and nullable, so this is metadata-only - no table rewrite, no
-- backfill, safe on live data. The index that makes the auto-approved list
-- cheap builds separately in
-- concurrent/0094_action_run_approved_by_agent_idx.sql, because action_run is
-- a populated table and a plain CREATE INDEX here would lock out every write
-- for the length of the build.
ALTER TABLE "action_run" ADD COLUMN IF NOT EXISTS "approved_by_agent" boolean;--> statement-breakpoint
COMMENT ON COLUMN "action_run"."approved_by_agent" IS
  'Who made the approval decision: true = an agent auto-approved it via the trust ladder, false = a person decided it in the review queue, NULL = undecided, or decided before this column shipped. Records the approval only - a later human reversal moves status, not this.';
