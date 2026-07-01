-- event_log — every inbound event (webhook or internal) the trigger runner sees.
-- Records the event, dedups redelivery, and audits what it started. Workflows
-- with a matching `trigger: {type:'event', event}` fire from here.
CREATE TABLE IF NOT EXISTS "event_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "type" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "dedupe_key" text,
  "triggered" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "invoked_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_log_dedupe_idx" ON "event_log" ("org_id","dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_log_org_type_idx" ON "event_log" ("org_id","type");
