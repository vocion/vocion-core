-- 0130 — routing to registered agents, and how much each one volunteers.
--
-- `agent.handles` is what an agent answers for, authored as a short list of
-- topics or example asks; the router matches a message against it before the
-- description and suggestions, and defaults to the workspace lead when
-- nothing matches. `agent.initiative` (low | normal | high) breaks routing
-- ties, decides whether a turn ends with an offer to carry the work forward,
-- and whether the agent takes part in debriefs. NULL reads as normal, so an
-- agent applied before this column behaves exactly as before; the applier
-- writes the authored value from the next apply on.
--
-- `conversation_message.routing_json` records the decision on the message it
-- was made for, so a person can see why an agent answered. `conversation.
-- ended_at` is set by the idle sweep that raises `conversation.ended`, and
-- cleared by the next message.
--
-- All four nullable or constant-default: metadata-only, per CONVENTIONS.md
-- rule 2. Hand-written; idempotent.
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "handles" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "initiative" text;
--> statement-breakpoint
ALTER TABLE "agent" DROP CONSTRAINT IF EXISTS "agent_initiative_ck";
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_initiative_ck" CHECK ("initiative" IS NULL OR "initiative" IN ('low', 'normal', 'high'));
--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "ended_at" timestamp;
--> statement-breakpoint
ALTER TABLE "conversation_message" ADD COLUMN IF NOT EXISTS "routing_json" jsonb;
