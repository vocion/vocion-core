-- 0141, a bulk action on the personalization queue, as a record.
--
-- A reviewer asks for many briefs to be regenerated at once (Metacto ticket
-- 071). Each one is a full agent pass, so the work runs as a Temporal
-- workflow, two leads at a time, and THIS row is what the person watches and
-- what remains afterwards: which leads, whose note, how many landed, how many
-- failed and why, one entry per lead. The workflow is keyed to the id of this row.
CREATE TABLE IF NOT EXISTS "personalization_bulk_job" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "kind" text NOT NULL,
  "note" text NOT NULL,
  "lead_ids" jsonb NOT NULL,
  "total" integer NOT NULL,
  "done" integer DEFAULT 0 NOT NULL,
  "failed" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "workflow_id" text,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personalization_bulk_job_org_idx" ON "personalization_bulk_job" USING btree ("org_id", "created_at");
