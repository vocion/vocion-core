-- Mission ownership: one agent, not a team. The mission points to the
-- agent that owns it (`agent_slug`). If that agent is a lead (i.e. some
-- other agents have parent_agent_slug pointing to it — see 0041), the
-- runtime resolves the team by reverse-lookup on parent_agent_slug.
-- Old shape: default_team jsonb { lead, members[] } — replaced.
ALTER TABLE "mission" ADD COLUMN IF NOT EXISTS "agent_slug" text;

-- Backfill from the existing default_team.lead for any pre-existing rows,
-- so the NOT NULL step below doesn't fail on live installs.
UPDATE "mission"
   SET "agent_slug" = "default_team"->>'lead'
 WHERE "agent_slug" IS NULL
   AND "default_team" IS NOT NULL;

ALTER TABLE "mission" ALTER COLUMN "agent_slug" SET NOT NULL;
ALTER TABLE "mission" DROP COLUMN IF EXISTS "default_team";
