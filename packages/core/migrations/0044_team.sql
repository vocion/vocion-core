-- Teams + workspace lead (F1). A team is the org-chart grouping of agents:
-- a lead agent (slug ref, no FK — same convention as agent.parent_agent_slug)
-- plus an accountable HUMAN (FK to "user"; NULL = inherit the workspace
-- default). Catalog only — a team executes nothing itself, so there is no
-- team_run table. Flat by construction: no parent-team column exists.
-- The team row's serial PK is the future attachment point for KPIs (F3).
CREATE TABLE IF NOT EXISTS "team" (
  "id" serial PRIMARY KEY,
  "org_id" text NOT NULL,
  "project_id" text REFERENCES "project"("id") ON DELETE CASCADE,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "lead_agent_slug" text,
  "accountable_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_org_slug_idx" ON "team" ("org_id", "slug");
--> statement-breakpoint

-- Which team an agent belongs to — a validated slug ref into team.slug,
-- authored as `team:` in workspace agent YAML once the workspace defines a
-- teams/ dir. The legacy free-text `team` display column (0031) is left
-- untouched and deprecated; it was verified authored nowhere.
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "team_slug" text;
--> statement-breakpoint

-- Workspace lead + workspace-default accountable human live on the project
-- row (the workspace lead is project config, NOT a special team). Teams with
-- accountable_user_id NULL inherit project.accountable_user_id.
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "lead_agent_slug" text;
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "accountable_user_id" text REFERENCES "user"("id") ON DELETE SET NULL;
