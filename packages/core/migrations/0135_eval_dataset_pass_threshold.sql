-- `eval:run` decided pass or fail against one number compiled into the
-- script, the same 0.8 for every dataset in every workspace. That bar is
-- right for a small deterministic set and wrong for a set spread across a
-- dozen live websites, where one source redesigning a page costs a case and
-- a build nobody broke goes red. People learn to ignore a gate that does
-- that, and then it is measuring nothing.
--
-- So the bar belongs to the dataset that knows what it is worth. NULL keeps
-- the runner's own floor, which is what every dataset written before this
-- column had, so nothing changes for them.
--
-- ADD COLUMN with no default does not rewrite the table in Postgres 11 and
-- later, so this is safe on a populated table and adds no index
-- (CONVENTIONS.md rule 1 is about index builds; there is none here).
ALTER TABLE "eval_dataset" ADD COLUMN IF NOT EXISTS "pass_threshold" real;
--> statement-breakpoint
COMMENT ON COLUMN "eval_dataset"."pass_threshold" IS 'Pass rate (0-1) a run must reach for eval:run to exit 0. NULL = use the runner default.';
