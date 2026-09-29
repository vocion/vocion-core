-- How an agent talks in chat, set by the workspace (Chris, 2026-09-29: "we
-- should be able to control and steer how it talks, how verbose it is, how
-- creative it is"). `voice` is what the agent's YAML says, rewritten on every
-- apply; `voice_override` is what a person set from the agent's page, MCP,
-- the API or chat, and no apply writes it. The runtime reads the default,
-- then `voice`, then `voice_override` (`libs/agents/voice.ts`).
--
-- Both nullable, no default: ADD COLUMN is a catalog-only change, and a row
-- with neither runs with the platform voice it has today.
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "voice" jsonb;
--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "voice_override" jsonb;
