-- Skills and playbooks compose from the base pack; attachment is by
-- name, never by tag. The playbook table now catalogs both kinds of
-- SKILL.md folder (skill | playbook) with provenance (core | workspace
-- | override); agents attach playbooks explicitly via playbook_slugs.
--
-- Hand-written; idempotent.
ALTER TABLE "playbook" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'playbook' NOT NULL;--> statement-breakpoint

ALTER TABLE "playbook" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'workspace' NOT NULL;--> statement-breakpoint

ALTER TABLE "playbook" ADD COLUMN IF NOT EXISTS "attached_playbooks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

ALTER TABLE "playbook" DROP COLUMN IF EXISTS "tags";--> statement-breakpoint

ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "playbook_slugs" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint

ALTER TABLE "agent" DROP COLUMN IF EXISTS "playbook_tags";
