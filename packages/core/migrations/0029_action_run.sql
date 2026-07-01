-- action_run — a proposed connector-write action (gmail.send, hubspot.update, …).
-- Gated actions land here as 'pending' and surface in the unified review queue;
-- they execute only on approval. Non-gated actions execute immediately.
CREATE TABLE IF NOT EXISTS "action_run" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "action_id" text NOT NULL,
  "input" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "result" jsonb,
  "error" text,
  "invoked_by" text,
  "source_slug" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "executed_at" timestamp
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_run_org_status_idx" ON "action_run" ("org_id","status");
