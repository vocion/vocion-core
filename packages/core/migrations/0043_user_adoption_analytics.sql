-- User accountability & adoption analytics.
--
-- One append-only event stream (`user_activity_event`) that every adoption
-- metric reads from, written fire-and-forget by services/adoption/track.ts.
-- History is synthesized once from the existing activity tables by
-- scripts/backfill-adoption-events.ts (idempotent via the partial unique
-- index below).
CREATE TABLE IF NOT EXISTS "user_activity_event" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "project_id" text,
  "user_id" text NOT NULL,
  "agent_slug" text,
  "event_type" text NOT NULL,
  "resource_type" text,
  "resource_id" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_activity_event_org_created_idx" ON "user_activity_event" ("org_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_activity_event_org_user_created_idx" ON "user_activity_event" ("org_id", "user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_activity_event_org_agent_created_idx" ON "user_activity_event" ("org_id", "agent_slug", "created_at");
--> statement-breakpoint

-- Resource-anchored events are naturally unique per (org, type, resource).
-- Makes the backfill idempotent (INSERT ... ON CONFLICT DO NOTHING) and
-- guards against live double-fires. Heartbeats/logins carry no resource and
-- are exempt via the partial predicate.
CREATE UNIQUE INDEX IF NOT EXISTS "user_activity_event_resource_idx" ON "user_activity_event" ("org_id", "event_type", "resource_type", "resource_id") WHERE resource_id IS NOT NULL;
--> statement-breakpoint

-- Cheap dormancy queries: last login + last activity live on the membership,
-- stamped by the auth.login hook and the throttled guardAuth() heartbeat.
ALTER TABLE "account_membership" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp;
--> statement-breakpoint
ALTER TABLE "account_membership" ADD COLUMN IF NOT EXISTS "last_active_at" timestamp;
