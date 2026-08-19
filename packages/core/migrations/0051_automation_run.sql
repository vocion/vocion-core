-- automation_run — evidence that an automation actually fired.
-- Until now a `job` dispatch persisted nothing (fireAutomation returned
-- runId 0), so a scheduled sweep that scanned nothing, ran clean, or threw
-- were indistinguishable in the UI. One row per dispatch, whatever the
-- do-type, carrying the job's own result so the Automation page can show the
-- last outcome without the caller having to keep it. Hand-written; idempotent.
CREATE TABLE IF NOT EXISTS "automation_run" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "slug" text NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "invoked_by" text,
  "dry_run" boolean DEFAULT false NOT NULL,
  "input" jsonb,
  "result" jsonb,
  "error" text,
  "target_run_id" integer,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "finished_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_run_org_slug_started_idx" ON "automation_run" ("org_id","slug","started_at" DESC);
