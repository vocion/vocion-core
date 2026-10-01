-- Workspace onboarding (#1028): when the first-run setup conversation was
-- opened, and by whom. Auto-open fires only while started_at is null, so it
-- opens once per workspace. Everything else setup reports is read from rows
-- that already exist (the description, sources, enabled plugins).
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "onboarding_started_at" timestamp;
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "onboarding_started_by" text;
