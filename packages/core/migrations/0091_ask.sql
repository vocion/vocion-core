-- 0091 — ask: one row per thing that is waiting on a HUMAN — an approval, a
-- ruling, an input or credential, a merge, a recommendation, a gate. Hand-written,
-- like every migration since 0066.
--
-- Why a new table instead of action_run / learning_candidate:
--   1. action_run is a proposed CONNECTOR WRITE with a registered action id; a
--      ruling ("which Slack-app granularity?") or a credential request executes
--      nothing when approved — the decision itself is the outcome.
--   2. learning_candidate is one shape (a rule for one step). An ask carries
--      free-form markdown and, optionally, a fixed set of options.
--   3. Asks arrive from OUTSIDE the app too — an external worker's file-based
--      approval queue mirrors in over /api/v1/asks, keyed by `source_ref`, so the
--      same item is never filed twice and its decision can be read back.
--
-- The shape is a QUESTION, answered from a phone: a short body, named options
-- (jsonb objects: id, label, description, recommended), always a free-text
-- "other" answer, and `follow_up` set when an "other" answer needs the asker to
-- read it. `group_key` gathers several asks into one decision sheet; the long
-- form lives behind `context_url` / `context_md`, never in the body.
-- `notify_at` / `notified` let a mailer or chat hook ping about new asks.
--
-- Status is text, not an enum, so a new state is a code change, not a migration.
-- All indexes are declared inline: this migration creates the table, so
-- CONVENTIONS.md rule 1 (no index builds on existing tables) does not apply.
CREATE TABLE IF NOT EXISTS "ask" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "project_id" text,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "source_ref" text,
  "agent_slug" text,
  "team_slug" text,
  "risk" text,
  "options" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "group_key" text,
  "group_title" text,
  "context_url" text,
  "context_md" text,
  "status" text DEFAULT 'open' NOT NULL,
  "decision" text,
  "decision_note" text,
  "follow_up" boolean DEFAULT false NOT NULL,
  "decided_by" text,
  "decided_at" timestamp,
  "due_at" timestamp,
  "notify_at" timestamp,
  "notified" boolean DEFAULT false NOT NULL,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ask_org_status_idx" ON "ask" ("org_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ask_org_agent_idx" ON "ask" ("org_id","agent_slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ask_org_group_idx" ON "ask" ("org_id","group_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ask_org_source_ref_uq" ON "ask" ("org_id","source_ref") WHERE "source_ref" IS NOT NULL;
