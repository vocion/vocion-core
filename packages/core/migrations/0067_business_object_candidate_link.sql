-- Hand-written, not `drizzle-kit generate`-produced: generation is currently
-- blocked by a pre-existing gap between the migration count and the snapshot
-- history (see 0066 for the same note). The runtime migrator only reads this
-- file + meta/_journal.json, so it applies cleanly regardless.
--
-- Proposed candidates become business_object rows the moment they are
-- extracted, holding the whole payload and carrying no link to any outside
-- system. Approval is what lets the downstream system publish and stamp its
-- own id back here, which is what these columns record.
ALTER TABLE "business_object" ADD COLUMN "external_system" text;--> statement-breakpoint
ALTER TABLE "business_object" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "business_object" ADD COLUMN "review_action_run_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "business_object_external_ref_idx" ON "business_object" USING btree ("org_id","external_system","external_id");--> statement-breakpoint
CREATE INDEX "business_object_org_status_idx" ON "business_object" USING btree ("org_id","status");
