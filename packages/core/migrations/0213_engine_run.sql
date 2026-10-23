-- The engine scoreboard (services/factory/engineRun.ts, ADR 0005): one row per engineering run,
-- whichever engine did it (claude-cli, openhands, later codex), in one shape, so engines can be
-- compared on the same work over time. A factory row is written from its worker_run when the run
-- ends and kept up to date as the work's outcome comes in (QA's verdict, merge, revert); an eval
-- row is imported from packages/runner/eval results. `source` says which.
-- Facts only: nothing here decides anything. A router policy may read it (services/factory/engineRouter.ts).
-- The table is new, so its indexes are built here.
CREATE TABLE IF NOT EXISTS "engine_run" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "source" text DEFAULT 'factory' NOT NULL,
  "worker_run_id" integer,
  "eval_key" text,
  "engine" text NOT NULL,
  "model" text,
  "seat" text,
  "route_policy" text,
  "route_reason" text,
  "task_id" integer,
  "request_id" integer,
  "repo" text,
  "base_branch" text,
  "risk_class" text,
  "status" text NOT NULL,
  "started_at" timestamp,
  "ended_at" timestamp,
  "duration_s" integer,
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "cache_read_tokens" bigint DEFAULT 0 NOT NULL,
  "cents" integer DEFAULT 0 NOT NULL,
  "pr_url" text,
  "checks_passed" integer,
  "checks_total" integer,
  "qa_verdict" text,
  "accepted" boolean,
  "merged" boolean DEFAULT false NOT NULL,
  "reverted" boolean DEFAULT false NOT NULL,
  "outcome" text NOT NULL,
  "attempt" integer DEFAULT 1 NOT NULL,
  "retries" integer DEFAULT 0 NOT NULL,
  "guard_violations" integer DEFAULT 0 NOT NULL,
  "files_touched" integer,
  "lines_added" integer,
  "lines_removed" integer,
  "complexity" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "engine_run_worker_run_idx" ON "engine_run" USING btree ("worker_run_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "engine_run_eval_key_idx" ON "engine_run" USING btree ("eval_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engine_run_org_engine_started_idx" ON "engine_run" USING btree ("org_id", "engine", "started_at");
