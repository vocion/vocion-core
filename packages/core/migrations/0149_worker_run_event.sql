-- 0149 — worker_run_event: the step log of an engineering run (backlog 036).
--
-- A worker_run kept one overwritten `progress` {phase, note}, so a run page
-- could say where a run was and never what it did. The worker already prints
-- one structured line per phase (claim, clone, install, services, claude and
-- each tool call, each check, QA, tests, push, PR); those lines lived only in
-- the worker account's CloudWatch for 14 days. Now each heartbeat carries the
-- lines since the last one and they land here, one row per line, so the run
-- page can draw them as steps while the run is live.
--
-- Small by design. Transcripts and full check logs stay in the worker's own
-- storage and arrive as links on worker_run.result; this table holds only the
-- step lines, capped by the service at 5000 per run, a message of 2000
-- characters and 8KB of fields. Rows older than 30 days are deleted by the
-- worker-run reaper schedule; the run row and its summary are kept.
--
-- Idempotent on (run_id, seq): a heartbeat that is retried after a timeout
-- sends the same seqs again, and they are ignored.
--
-- A new table, so its indexes are declared inline (CONVENTIONS.md rule 1
-- applies to tables that already exist).
CREATE TABLE IF NOT EXISTS "worker_run_event" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "run_id" integer NOT NULL REFERENCES "worker_run"("id") ON DELETE CASCADE,
  "seq" integer NOT NULL,
  "ts" timestamp NOT NULL,
  "phase" text NOT NULL,
  "step" text,
  "level" text DEFAULT 'info' NOT NULL,
  "message" text,
  "fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "worker_run_event_run_seq_uq" ON "worker_run_event" ("run_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worker_run_event_created_idx" ON "worker_run_event" ("created_at");
