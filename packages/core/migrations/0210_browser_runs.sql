-- Browser runs (services/browser/BrowserRunService.ts): a task a person or an
-- agent hands to a browser — what to do, where to start, its inputs and the
-- outputs it owes — and what the browser did, step by step, with the result.
-- `result` is json, not jsonb: jsonb reorders an object's keys, and a table's
-- columns come back in the order the run gave them.
-- One live run per person at a time. The process driving a run beats
-- `heartbeat_at`; a run whose beat stops is resumed from `checkpoint` (the
-- browser's cookies, storage and page, the run's notes and secrets, sealed
-- under the workspace's key) by the next process that sees it. The table is new, so its index is built here.
CREATE TABLE IF NOT EXISTS "browser_run" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "conversation_id" integer,
  "agent_slug" text,
  "status" text DEFAULT 'proposed' NOT NULL,
  "task" text NOT NULL,
  "start_url" text,
  "inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "result" json,
  "summary" text,
  "steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "waiting" jsonb,
  "error" text,
  "final_shot_url" text,
  "checkpoint" jsonb,
  "runner_id" text,
  "heartbeat_at" timestamp,
  "resumes" integer DEFAULT 0 NOT NULL,
  "isolation" text,
  "proposed_by" text NOT NULL,
  "micro_cents" bigint DEFAULT 0 NOT NULL,
  "started_at" timestamp,
  "ended_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "browser_run_org_user_status_idx" ON "browser_run" USING btree ("org_id", "user_id", "status");
