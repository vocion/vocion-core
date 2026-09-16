-- 0108 — the typed briefing document (docs/specs/briefing-v2.md).
--
-- A briefing stops being a markdown blob and becomes a `BriefingV2`: nine
-- named sections, ranked and budgeted in code rather than asked of a model.
-- The markdown stays in `content` — it is what the document renders to, and
-- what every row written before this carries — so nothing needs backfilling
-- and an older publisher keeps working. Nullable jsonb, additive
-- (CONVENTIONS.md rule 2).
ALTER TABLE "briefing" ADD COLUMN IF NOT EXISTS "document" jsonb;
