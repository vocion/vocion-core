-- Processes that run as durable workflows in a workspace (workspace.yaml
-- `durable:`, backlog 054). Default empty: every workspace keeps its
-- automations until it turns a process on.
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "enabled_durable" jsonb DEFAULT '[]'::jsonb NOT NULL;
