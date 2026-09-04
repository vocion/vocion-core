-- Two conversations with one agent may share a millisecond.
--
-- `conversation_org_agent_updated_idx` was created unique over
-- (org_id, agent_slug, updated_at). It exists to serve `listConversations`,
-- which filters on org and agent and sorts by `updated_at` — a sort key, not an
-- identity. Uniqueness bought nothing and refused a legitimate insert: two
-- people opening a chat with the same agent in the same millisecond, or two
-- rows whose `$onUpdate` timestamps land together, collide on it. It showed up
-- as a test failing about one run in three, which is the same failure a busy
-- workspace would see as an occasional 500.
DROP INDEX IF EXISTS "conversation_org_agent_updated_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_org_agent_updated_idx"
  ON "conversation" ("org_id", "agent_slug", "updated_at");
