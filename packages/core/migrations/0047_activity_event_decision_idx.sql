-- Typed triage signals: a run legitimately receives MULTIPLE review.decided
-- events (rewritten -> skipped -> approved), but the resource-anchored unique
-- index allowed only one per (org,event,resource) and silently dropped the
-- rest. Include the decision in the uniqueness (empty for other event types,
-- preserving their idempotency semantics). Hand-written; idempotent.
--
-- Guarded: boxes that replay every migration on each deploy reach this file
-- after 0079 has already excluded review.snoozed from the index. Rebuilding
-- the 0047 shape then fails on legitimately repeated snoozes and blocks the
-- deploy, so only rebuild while the index still lacks the decision key.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'user_activity_event_resource_idx' AND indexdef LIKE '%decision%'
  ) THEN
    DROP INDEX IF EXISTS "user_activity_event_resource_idx";
    CREATE UNIQUE INDEX IF NOT EXISTS "user_activity_event_resource_idx"
      ON "user_activity_event" ("org_id", "event_type", "resource_type", "resource_id", (coalesce("metadata"->>'decision','')))
      WHERE "resource_id" IS NOT NULL;
  END IF;
END $$;
