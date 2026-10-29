CREATE TABLE IF NOT EXISTS "workforce_item" (
 "id" text PRIMARY KEY, "org_id" text NOT NULL, "key" text NOT NULL,
 "workflow" text NOT NULL, "title" text NOT NULL, "agent_slug" text NOT NULL,
 "team_slug" text, "rubric" text NOT NULL, "configuration_version" text NOT NULL,
 "baseline_minutes" integer, "baseline_evidence" text,
 "test" boolean NOT NULL DEFAULT false, "version" integer NOT NULL DEFAULT 0,
 "status" text NOT NULL DEFAULT 'open', "created_by" text NOT NULL,
 "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workforce_item_org_key_idx" ON "workforce_item" ("org_id", "key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workforce_item_org_updated_idx" ON "workforce_item" ("org_id", "updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workforce_link" (
 "org_id" text NOT NULL, "item_id" text NOT NULL REFERENCES "workforce_item"("id"),
 "kind" text NOT NULL, "source_id" integer NOT NULL,
 PRIMARY KEY ("org_id", "kind", "source_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workforce_event" (
 "id" serial PRIMARY KEY, "org_id" text NOT NULL,
 "item_id" text NOT NULL REFERENCES "workforce_item"("id"),
 "event_key" text NOT NULL, "command_hash" text NOT NULL, "version" integer NOT NULL,
 "kind" text NOT NULL, "actor_id" text NOT NULL, "data" jsonb NOT NULL,
 "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workforce_event_org_key_idx" ON "workforce_event" ("org_id", "event_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workforce_event_item_version_idx" ON "workforce_event" ("item_id", "version");
