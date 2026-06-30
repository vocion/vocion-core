-- Durable, resumable, incremental ingestion state — one row per source.
CREATE TABLE IF NOT EXISTS "source_sync_checkpoint" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "source_id" integer NOT NULL REFERENCES "knowledge_source"("id") ON DELETE cascade,
  "status" text DEFAULT 'running' NOT NULL,
  "cursor" text,
  "since" timestamp,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp,
  "counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error" text
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "source_sync_checkpoint_source_idx" ON "source_sync_checkpoint" ("source_id");
