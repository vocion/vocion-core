-- What each live agent turn did wrong that can be read off the turn itself
-- (ADR 0010): failed calls, a refusal with the action path there, a claimed
-- save with nothing saved. One row per finished chat turn, counts and flags
-- only, no conversation text. The agent scoreboard reads it by agent and
-- level. A new table, so its indexes are built here (CONVENTIONS.md rule 1).
CREATE TABLE IF NOT EXISTS "agent_turn_signal" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "agent_slug" text NOT NULL,
  "level" text,
  "tool_loading" text,
  "model" text,
  "trace_id" text,
  "conversation_id" integer,
  "tool_calls" integer DEFAULT 0 NOT NULL,
  "tool_errors" integer DEFAULT 0 NOT NULL,
  "searches" integer DEFAULT 0 NOT NULL,
  "unknown_tools" integer DEFAULT 0 NOT NULL,
  "flags" text[] DEFAULT '{}' NOT NULL,
  "judge" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_turn_signal_org_created_idx" ON "agent_turn_signal" USING btree ("org_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_turn_signal_org_agent_created_idx" ON "agent_turn_signal" USING btree ("org_id", "agent_slug", "created_at");
