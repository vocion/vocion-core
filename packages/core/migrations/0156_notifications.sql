-- Notifications (backlog 048): one noun, one queue.
--
-- A plugin or the workspace DECLARES which events notify (`notifications:` in
-- plugin.yaml / workspace.yaml); the applier stores each declaration here as a
-- `notification_rule`. The event bus matches a rule and calls `notify()`, which
-- writes one `notification` per person (deduplicated on `dedupe_key`) and one
-- `notification_delivery` per channel — in-app, iPhone (APNs), Chrome (Web
-- Push), email, Slack. The delivery pass drains due deliveries with retries;
-- a delivery past its last attempt is `failed`, with its reason, where the
-- person reads the notification.
--
-- Every table is new, so the indexes are built here with the tables
-- (CONVENTIONS.md rule 1 applies to tables that already exist).
--
-- A notification publishes itself on the live stream (0155) BY TRIGGER, the
-- way records, cards and runs do: a row written or read on `notification`
-- rings `notification:<user_id>`, which only that person may follow, inside
-- the writer's own transaction. The bell follows it; nothing in the services
-- has to remember to publish.

CREATE TABLE IF NOT EXISTS "notification_rule" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "kind" text NOT NULL,
  "label" text NOT NULL,
  "description" text,
  "event" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "source" text DEFAULT 'workspace' NOT NULL,
  "config" jsonb NOT NULL,
  "last_fired_at" timestamp,
  "last_note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_rule_org_kind_uq" ON "notification_rule" ("org_id", "kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_rule_org_event_idx" ON "notification_rule" ("org_id", "event");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "notification" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "link" text,
  "record_type" text,
  "record_id" text,
  "dedupe_key" text NOT NULL,
  "event_type" text,
  "event_id" integer,
  "read_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_org_user_dedupe_uq" ON "notification" ("org_id", "user_id", "dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_user_org_created_idx" ON "notification" ("user_id", "org_id", "created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "notification_delivery" (
  "id" serial PRIMARY KEY NOT NULL,
  "notification_id" integer NOT NULL REFERENCES "notification"("id") ON DELETE CASCADE,
  "org_id" text NOT NULL,
  "user_id" text NOT NULL,
  "channel" text NOT NULL,
  "subscription_id" integer,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp DEFAULT now() NOT NULL,
  "detail" text,
  "sent_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_delivery_due_idx" ON "notification_delivery" ("status", "next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_delivery_notification_idx" ON "notification_delivery" ("notification_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "push_subscription" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "platform" text NOT NULL,
  "token" text NOT NULL,
  "keys" jsonb,
  "bundle_id" text,
  "environment" text,
  "label" text,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscription_platform_token_uq" ON "push_subscription" ("platform", "token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscription_user_idx" ON "push_subscription" ("user_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "notification_preference" (
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "org_id" text NOT NULL,
  "channels" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "quiet_hours" jsonb,
  "slack_target" text DEFAULT 'dm' NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "notification_preference_user_id_org_id_pk" PRIMARY KEY ("user_id", "org_id")
);--> statement-breakpoint

-- The bell's doorbell: a notification written (created) or read (changed)
-- tells its person. The notice names which notification, never what it says.
CREATE OR REPLACE FUNCTION live_notice_notification()
RETURNS trigger AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  PERFORM live_notice_emit(r.org_id, ARRAY['notification:' || r.user_id], 'notification:' || r.id, live_notice_kind(TG_OP));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS notification_live_tg ON "notification";--> statement-breakpoint
CREATE TRIGGER notification_live_tg
  AFTER INSERT OR UPDATE OR DELETE ON "notification"
  FOR EACH ROW
  EXECUTE FUNCTION live_notice_notification();
