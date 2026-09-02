-- Owner agent for automations and workflows. Until now only a mission carried
-- an `agent`, so job/workflow automations ran ownerless (no agent to roll up
-- to). Nullable: checkMission automations inherit the owner from their mission.
-- Hand-written; idempotent.
ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "owner_agent_slug" text;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN IF NOT EXISTS "owner_agent_slug" text;
