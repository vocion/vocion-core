-- Action Queue (review cards): upsert-by-key + expiry on action_run.
-- dedup_key = (object type + id + action slug) so a re-surfaced owed action
-- updates its PENDING row instead of duplicating; expires_at drops stale
-- suggestions out of the queue / daily brief.
--
-- Hand-written (drizzle snapshots froze at 0022); additive + nullable, IF NOT
-- EXISTS, idempotent — a no-op on the live DB where it was applied directly.
ALTER TABLE "action_run" ADD COLUMN IF NOT EXISTS "dedup_key" text;--> statement-breakpoint
ALTER TABLE "action_run" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "action_run_dedup_idx" ON "action_run" ("org_id", "dedup_key");
