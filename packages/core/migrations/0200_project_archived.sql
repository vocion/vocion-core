ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;--> statement-breakpoint
-- One-time backfill: before this column existed, an operator archived a
-- workspace by renaming it "Archived · <name>", and it stayed the oldest
-- workspace on the account, which made it everyone's default landing.
UPDATE "project" SET "archived_at" = now() WHERE "archived_at" IS NULL AND "name" ILIKE 'archived%';
