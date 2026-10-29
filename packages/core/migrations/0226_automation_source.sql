-- Which app installed an automation (`plugin:<slug>`, or `workspace`), and
-- whether it is listed or system plumbing (`visibility`), so the one
-- Automations register can be filtered by app and keep an app's internal
-- hand-offs out of the list. Both stamped at the next apply; added only.
ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "source" text;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'listed' NOT NULL;
