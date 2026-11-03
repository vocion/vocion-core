ALTER TABLE "project" ADD COLUMN "outbound_dry_run" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "crm_sync" (
 "project_id" text PRIMARY KEY REFERENCES "project"("id") ON DELETE CASCADE,
 "actor_id" text NOT NULL,
 "status" text DEFAULT 'idle' NOT NULL,
 "state" jsonb,
 "last_completed_at" timestamp with time zone,
 "error" text,
 "lease" text,
 "lease_until" timestamp with time zone,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
