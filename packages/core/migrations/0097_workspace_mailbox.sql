-- 0097 — a mailbox per workspace, and email as a chat surface (Chris, 2026-09-15:
-- "each workspace should get chat and an email/inbox"). Hand-written, like every
-- migration since 0066.
--
-- project.mailbox_address / mailbox_enabled: the address people write to
-- (`<slug>@<VOCION_MAIL_DOMAIN>` by default), authored as `mailbox:` in
-- workspace.yaml and applied like `lead:`/`goal:`. One column pair rather than
-- a table: a workspace has one address, and inbound resolution is one indexed
-- lookup by address.
--
-- email_thread: which conversation a Message-ID belongs to, so a reply that
-- carries In-Reply-To / References lands in the thread the first mail opened,
-- and a redelivered webhook (same received-email id) is dropped. Created here,
-- so its indexes are inline (CONVENTIONS.md rule 1 is about existing tables).
--
-- conversation.surface: where a conversation started — 'app' (default; the
-- dock / full page), 'slack', 'email'. Additive, defaulted, so nothing that
-- reads conversations today changes.
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "mailbox_address" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "mailbox_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "surface" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_thread" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "conversation_id" integer NOT NULL REFERENCES "conversation"("id") ON DELETE CASCADE,
  "message_id" text NOT NULL,
  "received_email_id" text,
  "direction" text NOT NULL,
  "from_address" text,
  "subject" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_thread_org_message_id_uq" ON "email_thread" ("org_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_thread_received_email_id_uq" ON "email_thread" ("received_email_id") WHERE "received_email_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_thread_conversation_idx" ON "email_thread" ("conversation_id");
