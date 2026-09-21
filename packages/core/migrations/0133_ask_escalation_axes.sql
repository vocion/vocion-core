-- 0133 — one decision is one durable object.
--
-- A mission that re-checked an unresolved decision filed another ask, so one
-- undecided question became CHECK 7, CHECK 10, CRITICAL and SYSTEM FAILURE:
-- four rows, one decision, and a person with no way to tell which of them was
-- the live one (Chris, 2026-09-21). The re-check now UPDATES the open ask,
-- and these columns are what it updates.
--
-- `history` is the escalation told once, in order — "2h: first request
-- blocked. 6h: three blocked. 13h: four blocked." — rendered as a one-line
-- strip on the card.
--
-- `urgency` and `impact` split the axis that `risk` was carrying alone.
-- Risk is how bad a WRONG answer is; urgency is how bad a LATE one is;
-- impact is how much rides on it either way. Ranking reads all three and
-- says its reasons out loud, so a person never sees a mystery score.
--
-- Additive and nullable, with a default on the jsonb only. No rewrite, no
-- lock, no backfill: an ask filed before this reads urgency NULL, which the
-- ranker treats as "not said" rather than as low.
ALTER TABLE "ask" ADD COLUMN IF NOT EXISTS "urgency" text;
--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN IF NOT EXISTS "impact" text;
--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN IF NOT EXISTS "history" jsonb DEFAULT '[]'::jsonb NOT NULL;
