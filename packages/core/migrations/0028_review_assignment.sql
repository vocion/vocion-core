-- review_assignment — per-item routing over the unified review queue.
-- Turns the org-wide queue into a team queue: who owns a pending item + snooze.
CREATE TABLE IF NOT EXISTS "review_assignment" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "kind" text NOT NULL,
  "run_id" integer NOT NULL,
  "assigned_to" text,
  "assigned_by" text,
  "status" text DEFAULT 'open' NOT NULL,
  "note" text,
  "snoozed_until" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_assigned_to_user_id_fk"
    FOREIGN KEY ("assigned_to") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "review_assignment_item_idx" ON "review_assignment" ("kind","run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_assignment_assignee_idx" ON "review_assignment" ("org_id","assigned_to");
