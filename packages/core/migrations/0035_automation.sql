-- Automations: the WHEN of the system as a first-class object.
-- {when: schedule|event} -> {do: run workflow | check mission}.
CREATE TABLE IF NOT EXISTS "automation" (
  "id" serial PRIMARY KEY,
  "org_id" text NOT NULL,
  "project_id" text REFERENCES "project"("id") ON DELETE CASCADE,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'active',
  "when_config" jsonb NOT NULL,
  "do_config" jsonb NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automation_org_slug_idx" ON "automation" ("org_id", "slug");
