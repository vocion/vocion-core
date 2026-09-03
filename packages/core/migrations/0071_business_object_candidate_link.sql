-- Hand-written, not `drizzle-kit generate`-produced: generation is currently
-- blocked by a pre-existing gap between the migration count and the snapshot
-- history (see 0066 for the same note). The runtime migrator only reads this
-- file + meta/_journal.json, so it applies cleanly regardless.
--
-- Proposed candidates become business_object rows the moment they are
-- extracted, holding the whole payload and carrying no link to any outside
-- system. Approval is what lets the downstream system publish and stamp its
-- own id back here, which is what these columns record.
--
-- Every statement is IF NOT EXISTS. These migrations were renumbered when they
-- met other work on main, and a renumbered file reads as brand new to
-- drizzle's tracking table — so a database that already ran them under the old
-- number would fail on the first re-run. Idempotent statements make the re-run
-- a no-op instead.

ALTER TABLE "business_object" ADD COLUMN IF NOT EXISTS "external_system" text;--> statement-breakpoint
ALTER TABLE "business_object" ADD COLUMN IF NOT EXISTS "external_id" text;--> statement-breakpoint
ALTER TABLE "business_object" ADD COLUMN IF NOT EXISTS "review_action_run_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_object_external_ref_idx" ON "business_object" USING btree ("org_id","external_system","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_object_org_status_idx" ON "business_object" USING btree ("org_id","status");
