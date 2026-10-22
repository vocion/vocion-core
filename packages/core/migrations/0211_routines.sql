-- Routines (services/routines/RoutineService.ts): repeatable work a specialist
-- taught once from a recording, run by Vocion in a browser, escalated to the
-- routine's named expert when a rule says so, and improved from corrections.
-- A routine keeps its versions (`routine_version`): each run is pinned to one,
-- and a correction is a new version, never an edit of the live one. A request
-- to run it for many rows is a batch (`routine_batch`) of runs
-- (`routine_run`), each one a browser run with a receipt.
-- `idem_key` is the dedupe ledger: a row whose key values were already done
-- by this routine is skipped, never done twice. A batch's shared inputs (the
-- sign-in, the campaign) are on the batch, its secrets sealed; a follow-up batch
-- (`follow_up`) is a change a finding's answer asked for (deactivate the people
-- not on the list), run under the same routine with its own task and writes.
-- The tables are new, so their indexes are built here.
CREATE TABLE IF NOT EXISTS "routine" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'teaching' NOT NULL,
  "trust" text DEFAULT 'drafted' NOT NULL,
  "expert_user_id" text,
  "source" jsonb,
  "teaching" jsonb,
  "error" text,
  "created_by" text NOT NULL,
  "conversation_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "routine_org_slug_uq" ON "routine" USING btree ("org_id", "slug");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "routine_version" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
  "routine_id" integer NOT NULL REFERENCES "routine"("id") ON DELETE CASCADE,
  "n" integer NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "spec" json NOT NULL,
  "task" text NOT NULL,
  "workflow_yaml" text NOT NULL,
  "change" text,
  "approved_by" text,
  "approved_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "routine_version_routine_n_uq" ON "routine_version" USING btree ("routine_id", "n");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "routine_batch" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
  "routine_id" integer NOT NULL REFERENCES "routine"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "requested_by" text NOT NULL,
  "conversation_id" integer,
  "status" text DEFAULT 'running' NOT NULL,
  "shared" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "secrets" jsonb,
  "findings" json DEFAULT '[]'::json NOT NULL,
  "follow_up" jsonb,
  "report_artifact_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "ended_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routine_batch_org_routine_idx" ON "routine_batch" USING btree ("org_id", "routine_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "routine_run" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
  "routine_id" integer NOT NULL REFERENCES "routine"("id") ON DELETE CASCADE,
  "batch_id" integer NOT NULL REFERENCES "routine_batch"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "n" integer NOT NULL,
  "label" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "input" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "secrets" jsonb,
  "idem_key" text,
  "task" text,
  "outputs" jsonb,
  "browser_run_id" integer,
  "waiting" jsonb,
  "ask_id" integer,
  "receipt" json,
  "summary" text,
  "error" text,
  "human_ms" bigint DEFAULT 0 NOT NULL,
  "started_at" timestamp,
  "ended_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routine_run_batch_idx" ON "routine_run" USING btree ("batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routine_run_org_status_idx" ON "routine_run" USING btree ("org_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routine_run_ledger_idx" ON "routine_run" USING btree ("org_id", "routine_id", "idem_key");
--> statement-breakpoint
ALTER TABLE "browser_run" ADD COLUMN IF NOT EXISTS "routine_run_id" integer;
