-- 0108 — eval score providers (vocion-core#343).
--
-- Our own LLM judge answers "was the answer good". It cannot answer "did the
-- agent call the right tools, in the right order". AWS Bedrock AgentCore ships
-- scorers that do, so scoring becomes a thing with a provider rather than one
-- hardcoded judge.
--
-- Three shapes change:
--
-- 1. eval_run.provider — which scorer produced this run's scores. One
--    execution can be scored by several providers, one run row each, so their
--    histories stay separate while the transcript they graded is the same.
--
-- 2. eval_run.dataset_version — the dataset's version at run time. A trend
--    line that blends runs taken against different item sets is lying;
--> statement-breakpoint
--    workspace_sha already catches prompt drift, and this is the same guard
--    for dataset-content drift. Nothing backfills it: runs recorded before
--    this migration genuinely do not know which item set they used, and NULL
--    says that honestly.
--
-- 3. eval_case_result.trajectory — the ordered tool names the agent called.
--    AgentCore's trajectory evaluators compare this against an expected
--    sequence, and it is the one genuinely deterministic thing AgentCore
--    scores. Only the COUNT survived into usage.toolCalls before now.
--
-- eval_score is the new table. A case graded by AgentCore comes back as an
-- ARRAY — one result per evaluator, on scales that do not compare to each
-- other — so one grade per case cannot hold it.
--
-- run_id, not case_result_id alone: eval_case_result.run_id is NOT NULL and a
-- transcript belongs to exactly one run, so a second provider's run row would
-- have no case children and nothing could join its scores back to it.
--
-- case_result_id nullable: TRACE- and SESSION-level evaluators score a whole
-- run, not one case. Forcing every score onto a case would leave them nowhere
-- to go.
--
-- All additive: new table, and columns that are nullable or const-default.
-- Nothing needs CONCURRENTLY (CONVENTIONS.md rule 1) because the indexes are
-- built with the table, while it is empty.

ALTER TABLE "eval_run" ADD COLUMN IF NOT EXISTS "provider" text DEFAULT 'vocion' NOT NULL;
--> statement-breakpoint
ALTER TABLE "eval_run" ADD COLUMN IF NOT EXISTS "dataset_version" integer;
--> statement-breakpoint
-- Identifies the one execution a set of provider runs share. Runs predating
-- this migration have none, and two runs of the same dataset are legitimately
-- separate executions, so this is nullable rather than backfilled.
ALTER TABLE "eval_run" ADD COLUMN IF NOT EXISTS "run_group_id" text;
--> statement-breakpoint
ALTER TABLE "eval_case_result" ADD COLUMN IF NOT EXISTS "trajectory" text[];
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eval_score" (
  "id" serial PRIMARY KEY NOT NULL,
  "run_id" integer NOT NULL REFERENCES "eval_run"("id") ON DELETE CASCADE,
  "case_result_id" integer REFERENCES "eval_case_result"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "evaluator_slug" text NOT NULL,
  "evaluator_name" text,
  "evaluator_arn" text,
  "level" text DEFAULT 'TRACE' NOT NULL,
  "value" real,
  "label" text,
  "explanation" text,
  "token_usage" jsonb,
  "error_code" text,
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The run-detail page reads every score for a run; the trend chart reads one
-- evaluator's scores across runs; the case view reads scores for one case.
CREATE INDEX IF NOT EXISTS "eval_score_run_idx" ON "eval_score" ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eval_score_run_evaluator_idx" ON "eval_score" ("run_id","provider","evaluator_slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eval_score_case_idx" ON "eval_score" ("case_result_id");
--> statement-breakpoint
-- One run per provider per execution. This is what makes a retried Temporal
-- activity idempotent: the retry's insert collides instead of adding a phantom
-- point to the trend line. Partial, because run_group_id is NULL for every run
-- recorded before this migration and for any run started outside a workflow.
CREATE UNIQUE INDEX IF NOT EXISTS "eval_run_group_provider_idx"
  ON "eval_run" ("run_group_id","provider") WHERE "run_group_id" IS NOT NULL;
--> statement-breakpoint
-- Evaluator definitions authored in our workspace YAML, plus where they live
-- remotely once synced. Desired state is written by workspace apply; the AWS
-- call that gives us remote_id happens later, in a Temporal activity, because
-- apply makes no external calls and must not start failing when AWS is down.
CREATE TABLE IF NOT EXISTS "eval_evaluator" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "dataset_slug" text NOT NULL,
  "provider" text NOT NULL,
  "slug" text NOT NULL,
  "level" text,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "remote_id" text,
  "remote_arn" text,
  "synced_at" timestamp,
  "sync_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "eval_evaluator_org_dataset_slug_idx"
  ON "eval_evaluator" ("org_id","dataset_slug","provider","slug");
