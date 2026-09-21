-- 0121 — the budget row learns what it is budgeting, and learns fractions of a cent.
--
-- Until now `agent_budget` only ever held agent turns, so three call sites
-- charged it and every other paid model call in the product — embeddings,
-- rerank, the rewrite button, transcript classification, chip synthesis,
-- feedback classification, duplicate detection, image generation — spent
-- without the budget seeing it (#279). An org could hold a $50 cap and still
-- generate a four-figure embedding bill with the budget page showing it
-- comfortably under limit.
--
-- Two additive columns, both safe on a populated table:
--
-- `feature` labels the non-agent rows. The scope itself rides in `agent_slug`
-- (`platform:all` for the org's whole spend, `platform:<feature>` for one
-- surface) so the existing unique index still makes a charge atomic; widening
-- that index instead would be an expand-and-contract migration across three
-- releases. This column is the typed label to group by, so a report never has
-- to parse a slug.
--
-- `current_micro_cents` is the same spend at a millionth of a cent. Charging
-- went from one call per agent turn to one call per embedding batch, and a
-- batch of chunks costs a fraction of a cent: rounding that up to a whole cent
-- every time billed a $1 sync as $10. Each charge now adds its exact cost here
-- and floors the result into `current_cents`, which keeps meaning what it
-- always did.
--
-- The backfill seeds the new column from the cents already recorded, so the
-- first charge after this deploy does not floor a period's spend back down to
-- whatever it has accumulated since.
--
-- To reverse: drop both columns. Nothing reads them on the old code path.
ALTER TABLE "agent_budget"
  ADD COLUMN IF NOT EXISTS "feature" text;
--> statement-breakpoint
ALTER TABLE "agent_budget"
  ADD COLUMN IF NOT EXISTS "current_micro_cents" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "agent_budget"
  SET "current_micro_cents" = "current_cents" * 1000000
  WHERE "current_micro_cents" = 0 AND "current_cents" > 0;
