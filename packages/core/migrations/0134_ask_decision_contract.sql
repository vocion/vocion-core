-- 0134 — every item in Review carries its decision contract.
--
-- Review's rows were metadata about which agent asked what, so a person had
-- to open each one to learn what was being decided (Chris, 2026-09-21). The
-- hand-off card (#501) already read the other way round and was the one item
-- in the queue answerable from the row. These five columns are that shape,
-- made a requirement of every ask:
--
--   decision_prompt         what must be decided, ONE sentence
--   recommendation          what the system thinks
--   recommendation_why_not  why it could not form a view — required when
--                           `recommendation` is null, so "no recommendation"
--                           is a stated fact rather than an empty field
--   why                     the one or two strongest reasons
--   impact_of_delay         what happens if this waits, including "nothing"
--
-- `decision_prompt`, not `decision`: `ask.decision` already holds the ANSWER
-- a person gave, and one column cannot be both the question and the answer.
--
-- Additive and nullable (the jsonb takes a default). No rewrite, no lock, no
-- backfill: an ask filed before this reads NULL and renders as it always did,
-- while `AskService.fileAsk` refuses a NEW one that arrives without them.
ALTER TABLE "ask" ADD COLUMN IF NOT EXISTS "decision_prompt" text;
--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN IF NOT EXISTS "recommendation" text;
--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN IF NOT EXISTS "recommendation_why_not" text;
--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN IF NOT EXISTS "why" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN IF NOT EXISTS "impact_of_delay" text;
