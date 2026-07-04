-- Briefings as first-party objects: the daily front door. Published by the
-- team (publish_briefing tool) at the end of a briefing check.
CREATE TABLE IF NOT EXISTS "briefing" (
  "id" serial PRIMARY KEY,
  "org_id" text NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "published_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefing_org_created_idx" ON "briefing" ("org_id", "created_at");
