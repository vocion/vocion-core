-- 0081 — worker_run: the control-plane record for a long-running EXTERNAL agent
-- run (ADR 0004, phase 1). Hand-written, like every migration since 0066.
--
-- Why a new table instead of mission_run:
--   1. mission_run's plan is a JSONB task graph executed by an in-process loop;
--      a worker run is one job executed by a process Vocion does not host.
--   2. The columns that make a run resumable and reapable — worker_id, attempt,
--      lease_expires_at, heartbeat_at, cursor — have no home on mission_run and
--      would be dead weight there. source_sync_checkpoint is the model instead.
--   3. Per-run cost. agent_budget is per agent per period; a worker reports
--      tokens and cents as it goes, and this row is where "what did THIS run
--      cost" lives — nothing else in the schema answers that.
--
-- Status is text, not an enum, so a new state is a code change, not a migration.
-- All indexes are declared inline: this migration creates the table, so
-- CONVENTIONS.md rule 1 (no index builds on existing tables) does not apply.
CREATE TABLE IF NOT EXISTS "worker_run" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "agent_slug" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "input" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "worker_id" text,
  "attempt" integer DEFAULT 0 NOT NULL,
  "lease_seconds" integer DEFAULT 300 NOT NULL,
  "lease_expires_at" timestamp,
  "heartbeat_at" timestamp,
  "claimed_at" timestamp,
  "ends_at" timestamp,
  "completed_at" timestamp,
  "progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "cursor" text,
  "counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "tokens" integer DEFAULT 0 NOT NULL,
  "cents" integer DEFAULT 0 NOT NULL,
  "cap_cents" integer,
  "stop_requested" boolean DEFAULT false NOT NULL,
  "result" jsonb,
  "error" text,
  "failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "workspace_sha" text,
  "langfuse_trace_id" text,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worker_run_org_status_idx" ON "worker_run" ("org_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worker_run_org_agent_idx" ON "worker_run" ("org_id","agent_slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worker_run_lease_idx" ON "worker_run" ("status","lease_expires_at");
