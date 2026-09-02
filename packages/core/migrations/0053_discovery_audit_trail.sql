-- Discovery-to-proposal, agent-driven: the audit trail (plan phase 2).
-- The ledger held match provenance but not enough to reconstruct a decision.
-- These columns make one query answer: which transcript version was read, the
-- thresholds the route was decided under, the model + prompt version, which
-- agent turn ordered it, and why a matched call was not assessed.
-- Hand-written; idempotent. Rows written before the cutover stay queryable —
-- every column is nullable.
ALTER TABLE "discovery_candidate" ADD COLUMN IF NOT EXISTS "transcript_hash" text;--> statement-breakpoint
ALTER TABLE "discovery_candidate" ADD COLUMN IF NOT EXISTS "thresholds" jsonb;--> statement-breakpoint
ALTER TABLE "discovery_candidate" ADD COLUMN IF NOT EXISTS "classifier_version" text;--> statement-breakpoint
ALTER TABLE "discovery_candidate" ADD COLUMN IF NOT EXISTS "workspace_sha" text;--> statement-breakpoint
ALTER TABLE "discovery_candidate" ADD COLUMN IF NOT EXISTS "assessed_by" jsonb;--> statement-breakpoint
ALTER TABLE "discovery_candidate" ADD COLUMN IF NOT EXISTS "skipped_reason" text;
