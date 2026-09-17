-- One AgentCore batch evaluation job, and where it got to.
--
-- The on-demand path needs no table like this: `Evaluate` answers in the same
-- call, so there is nothing to come back to. A batch job runs for minutes on
-- AWS's side and outlives the process that started it, so its identifiers are
-- written down before the wait begins — a restart that lost them would leave a
-- job running and billing with nothing able to collect its result.
--
-- `client_token` is written before the start call, not after it. A Temporal
-- activity is at-least-once, so the start can run twice for one run; AWS
-- reuses the job when it sees the same token, which turns the retry into a
-- no-op rather than a second job grading the same sessions at full price.
--
-- The unique index on `run_id` is the same guarantee from our side: one batch
-- job per run, so a retry cannot leave two rows racing to write the scores.
CREATE TABLE IF NOT EXISTS "eval_batch_job" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "run_id" integer NOT NULL,
  "region" text NOT NULL,
  "client_token" text NOT NULL,
  "batch_evaluation_id" text,
  "batch_evaluation_arn" text,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "failure" text,
  "sessions_total" integer DEFAULT 0 NOT NULL,
  "sessions_completed" integer DEFAULT 0 NOT NULL,
  "sessions_failed" integer DEFAULT 0 NOT NULL,
  "sessions_ignored" integer DEFAULT 0 NOT NULL,
  "output_log_group" text,
  "output_log_stream" text,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "eval_batch_job" ADD CONSTRAINT "eval_batch_job_run_id_eval_run_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."eval_run"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "eval_batch_job_run_idx" ON "eval_batch_job" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eval_batch_job_status_idx" ON "eval_batch_job" USING btree ("status");
