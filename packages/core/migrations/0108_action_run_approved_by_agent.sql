-- Who made the approval call on an action run: an agent, or a person.
--
-- Nullable on purpose, and read as three states rather than two:
--   NULL  - nobody has decided yet (the run is still open in the queue), or
--           a person decided it before this column shipped. Agent approvals
--           made before then are backfilled to true at the bottom of this
--           file, so `true` is complete and only `false` has a blind spot
--   true  - the trust ladder released it without a person
--   false - a person approved or rejected it in the review queue
--
-- A NOT NULL DEFAULT false would be cheaper to query and wrong: it would make
-- every run still waiting in the queue read as human-approved, and "nobody has
-- looked at this yet" and "a person said yes" are the two facts this column
-- exists to tell apart.
--
-- The last decider owns the row. A run can only be decided twice while it sits
-- in the queue as `failed` — an agent released it, the execution threw, and a
-- person retried or rejected it — because a decided run is never re-decided
-- and a later proposal opens a new one. There the person's call replaces the
-- agent's: the ladder did not get that one through on its own.
--
-- Additive and nullable, so this is metadata-only - no table rewrite, no
-- backfill, safe on live data. The index that makes the auto-approved list
-- cheap builds separately in
-- concurrent/0108_action_run_approved_by_agent_idx.sql, because action_run is
-- a populated table and a plain CREATE INDEX here would lock out every write
-- for the length of the build.
ALTER TABLE "action_run" ADD COLUMN IF NOT EXISTS "approved_by_agent" boolean;--> statement-breakpoint
COMMENT ON COLUMN "action_run"."approved_by_agent" IS
  'Who made the approval decision: true = an agent auto-approved it via the trust ladder, false = a person decided it in the review queue, NULL = undecided, or decided by a person before this column shipped (agent approvals from then were backfilled to true). Records the approval only - a later human reversal moves status, not this.';--> statement-breakpoint
-- Backfill the runs the trust ladder released before this column existed. They
-- carry `autoApproved: true` inside the `proposal` jsonb and nothing else, so
-- without this the auto-approved list has to read that key as a fallback — and
-- a jsonb key is not what the index below covers, which turns the audit list
-- into a full scan of action_run for as long as any pre-migration row lives.
--
-- One pass, additive, and safe to run twice: it only fills rows that have no
-- answer yet. `decided_at` is deliberately left NULL for them rather than
-- guessed from `created_at` - we do not know when those were decided, and the
-- list sorts NULLs last so they land at the bottom where an undated row
-- belongs.
UPDATE "action_run"
  SET "approved_by_agent" = true
  WHERE "approved_by_agent" IS NULL
    AND "proposal" ->> 'autoApproved' = 'true';
