-- A durable run waiting for an event (backlog 054, libs/durable/events.ts).
-- emitEvent sends a matching event to the run named on the row; the run opens
-- the row before it waits and deletes it once answered. A new table, so its
-- indexes are built here.
CREATE TABLE IF NOT EXISTS "durable_wait" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"wait_key" text NOT NULL,
	"types" jsonb NOT NULL,
	"match" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "durable_wait_run_key_idx" ON "durable_wait" USING btree ("workflow_id","wait_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "durable_wait_org_idx" ON "durable_wait" USING btree ("org_id");
