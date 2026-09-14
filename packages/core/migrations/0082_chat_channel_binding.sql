-- 0082 — chat_channel_binding: which agent answers in which chat channel
-- (approval item 025, phase 1: Slack in, agent reply out, one bound channel).
--
-- The inbound event carries no Vocion tenancy — only a platform channel id — so
-- the binding is how an event finds its org AND its agent. Hence the unique
-- index is on (surface, channel_id), not per org: a channel can belong to one
-- agent in one org, full stop. A row with channel_id = '*' and a team_id is a
-- per-workspace catch-all, which is how direct messages (whose channel ids are
-- not known in advance) find an agent.
--
-- Hand-written; idempotent; indexes inline because this migration creates the table.
CREATE TABLE IF NOT EXISTS "chat_channel_binding" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "surface" text NOT NULL,
  "team_id" text,
  "channel_id" text NOT NULL,
  "agent_slug" text NOT NULL,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_channel_binding_surface_channel_idx" ON "chat_channel_binding" ("surface","channel_id","team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_channel_binding_org_idx" ON "chat_channel_binding" ("org_id");
