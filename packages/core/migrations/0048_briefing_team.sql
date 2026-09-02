-- Team-scoped briefings: each brief belongs to a TEAM (its lead publishes it);
-- the workspace lead's brief is the cross-team ROLLUP (team_slug of the
-- workspace). Nullable for legacy org-wide rows. Hand-written; idempotent.
ALTER TABLE "briefing" ADD COLUMN IF NOT EXISTS "team_slug" text;--> statement-breakpoint
ALTER TABLE "briefing" ADD COLUMN IF NOT EXISTS "agent_slug" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefing_org_team_created_idx" ON "briefing" ("org_id", "team_slug", "created_at");
