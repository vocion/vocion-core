-- Model-upgrade test: run an agent's eval dataset on a named model and keep
-- what each case cost, so two runs of the same dataset compare on cost per
-- passed case rather than on price per token.
--
-- `eval_run.model` is the model the agent under test ran on when the caller
-- named one; NULL means the agent's own configured model (every run before
-- this column). `eval_case_result.usage` is the run's token usage priced by
-- libs/pricing.ts plus turn and tool-call counts. Both nullable, no default
-- rewrite, no index on a populated table.
ALTER TABLE "eval_run"
  ADD COLUMN IF NOT EXISTS "model" text;--> statement-breakpoint

ALTER TABLE "eval_case_result"
  ADD COLUMN IF NOT EXISTS "usage" jsonb;
