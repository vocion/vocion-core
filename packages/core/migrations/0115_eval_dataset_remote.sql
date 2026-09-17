-- Where a dataset lives in its grader's own account.
--
-- A dataset graded by AgentCore is published into the customer's AWS account
-- as a real dataset with versions of its own. Scoring does not depend on it —
-- `Evaluate` carries the expected answer in the request body — so this table
-- also records why a publish failed, and a failed publish costs nobody a run.
--
-- Keyed by (dataset, provider) rather than living on `eval_dataset`, because a
-- dataset's provider is mutable: a row per grader means flipping a dataset to
-- Vocion and back needs no clearing logic, and a third grader needs no
-- migration. The unique index is created with the table, so it takes no lock
-- on anything that already holds rows.
CREATE TABLE IF NOT EXISTS "eval_dataset_remote" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "dataset_id" integer NOT NULL REFERENCES "eval_dataset"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "remote_id" text,
  "remote_version" text,
  "cases_hash" text,
  "status" text,
  "sync_error" text,
  "synced_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "eval_dataset_remote_dataset_provider_idx" ON "eval_dataset_remote" ("dataset_id","provider");
--> statement-breakpoint
-- Whatever the grader returned that we have not modelled. The scored columns
-- stay columns, because the pass rate and the trend are SQL over them; this is
-- for everything else, so nothing a grader says is thrown away.
ALTER TABLE "eval_score" ADD COLUMN IF NOT EXISTS "raw" jsonb;
