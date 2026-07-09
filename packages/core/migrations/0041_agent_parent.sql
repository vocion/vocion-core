-- Agent hierarchy: parent_agent_slug is the source of truth for the
-- primary-vs-specialized structure. NULL = primary agent; a non-NULL
-- value names the primary agent (same org) this specialist reports to.
-- One level deep. Authored as `parent:` in workspace agent YAML; the
-- `role` column is derived from it by workspace:apply.
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "parent_agent_slug" text;
