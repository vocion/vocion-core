-- Agent taxonomy: lead vs specialist, work-mode type, and team grouping.
-- Retires "sub-agent" framing — specialists are first-class agents on a team.
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'specialist' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "agent_type" text;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "team" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_team_idx" ON "agent" ("org_id","team");
