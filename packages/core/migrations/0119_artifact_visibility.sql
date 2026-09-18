-- 0119 — an artifact is something a person would go looking for.
--
-- The Artifacts list had become mostly machine exhaust. In production: 13 of 39
-- artifacts were mission check reports ("Discovery Calls Mission — Check #186"),
-- a sweep that found nothing writing a report about finding nothing, thirteen
-- times over. Another 7 were outreach recommendations, which are already
-- rendered on the decision card they belong to. More than half the list was
-- something nobody would open on purpose.
--
-- The cause was the definition rather than any one writer. Design principle 7
-- says an artifact is "content the system produced — versioned, authored,
-- editable, citable", and a check report satisfies all four. Chris, 2026-09-17:
-- *"Artifacts should be things users care about opening and iterating on or
-- reading. Not system decisions."*
--
-- The fix is a flag rather than a deletion, which was his call and the right
-- one: a recommendation must keep its version history, because
-- `action_run.pinned_artifacts` records the exact versions a human approved and
-- the audit answer would otherwise start moving.
--
--   user    what a person opens: briefs, docs, tables, charts, files, sequences
--   system  produced as part of the work: check reports, recommendations
--
-- Additive and defaulted, so every existing row stays visible until something
-- deliberately marks it otherwise, and no reader has to change to keep working.
ALTER TABLE "artifact"
  ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'user';
--> statement-breakpoint

-- Backfill, structurally and only where the signal is unambiguous. A lead's
-- outreach recommendation is identified by its record role, not by its title,
-- so this hides exactly the rows that are already rendered on the decision
-- card they belong to.
UPDATE "artifact" SET "visibility" = 'system' WHERE "record_role" = 'recommendation';

-- Mission check reports are deliberately NOT backfilled. Nothing on an
-- existing row says it came from a mission run — the column that would say so
-- (the run behind the turn) was never stored on `artifact`, and the only other
-- handle is the model-authored title. Matching on "Check #" would hide any
-- artifact a person happened to title that way, which is a worse failure than
-- leaving a few stale rows in the list. New ones are flagged by provenance at
-- the call site, so the list drains rather than being retroactively rewritten.
