-- Per-user sidebar preferences (airy shell, B-034b + Chris 2026-09-15):
-- the pages a person pinned, in pin order, and the small shell prompts they
-- dismissed (e.g. the "Invite team members" card). One row per (org, user);
-- localStorage is the fast path, this row is the truth across devices.
--
-- New table, so its unique index builds here (CONVENTIONS.md rule 1 only
-- forbids CREATE INDEX on a populated table).
CREATE TABLE IF NOT EXISTS "user_nav_pref" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "user_id" text NOT NULL,
  "pins" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "dismissed" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_nav_pref_org_user_idx" ON "user_nav_pref" ("org_id", "user_id");
--> statement-breakpoint
COMMENT ON COLUMN "user_nav_pref"."pins" IS 'Ordered list of pinned nav URLs (e.g. /dashboard/p/deal-desk, /dashboard/chat/42?grid=open). Order is pin order; the sidebar renders them under Pinned.';
--> statement-breakpoint
COMMENT ON COLUMN "user_nav_pref"."dismissed" IS 'Ids of shell prompts this person dismissed (e.g. invite-card). Never re-shown.';
