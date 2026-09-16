-- Slack thread context (gap 1) and the provenance of feedback that arrived
-- through a chat surface (gap 3). Additive only: one new table, one new
-- nullable column.
--
-- `slack_post` is every message Vocion PUTS INTO Slack — an announcement, a
-- thread reply, the channel introduction. It exists because the `app_mention`
-- payload carries no parent message, and reading the parent back out of Slack
-- needs `channels:history` / `groups:history`, which a workspace may not have
-- granted. Vocion should not need a scope to remember what it said itself.
--
-- Deliberately NOT folded into `email_thread`: that table is keyed by RFC 5322
-- Message-ID and requires a `conversation_id` (NOT NULL, FK). An announcement
-- belongs to no conversation and has no Message-ID, so it would need both
-- columns relaxed — a contract change on a live table to store something that
-- is not an email thread.

CREATE TABLE IF NOT EXISTS "slack_post" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "project_id" text,
  -- Slack workspace (`team_id`), when the poster knew it.
  "team_id" text,
  "channel_id" text NOT NULL,
  -- This message's own Slack timestamp id.
  "ts" text NOT NULL,
  -- The thread it landed in; NULL for a post that starts one.
  "thread_ts" text,
  -- 'announcement' | 'reply' | 'introduction'
  "kind" text DEFAULT 'reply' NOT NULL,
  "agent_slug" text,
  "text" text NOT NULL,
  -- What the post was ANNOUNCING — the thing "this" refers to when someone
  -- replies to it. Label plus the link a reader would open.
  "announced_label" text,
  "announced_url" text,
  -- Images carried by the post: [{ url, caption }].
  "images" jsonb DEFAULT '[]'::jsonb NOT NULL,
  -- True when this post already told the channel which Slack scope is missing,
  -- so the same sentence is said once per thread rather than on every reply.
  "degraded_notice" boolean DEFAULT false NOT NULL,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- One row per Slack message. A redelivered post must not double-record.
CREATE UNIQUE INDEX IF NOT EXISTS "slack_post_channel_ts_uq" ON "slack_post" ("channel_id", "ts");
--> statement-breakpoint
-- "what did we say in this thread" — the thread-context read.
CREATE INDEX IF NOT EXISTS "slack_post_channel_thread_idx" ON "slack_post" ("channel_id", "thread_ts");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slack_post_org_created_idx" ON "slack_post" ("org_id", "created_at");
--> statement-breakpoint
-- Where a proposed rule came from when it did not come from a feedback job:
-- a permalink, an ask ref, a conversation. Nullable; nothing backfills it.
ALTER TABLE "learning_candidate" ADD COLUMN IF NOT EXISTS "source_ref" text;
