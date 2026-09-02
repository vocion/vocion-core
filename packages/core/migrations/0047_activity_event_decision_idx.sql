-- Typed triage signals: a run legitimately receives MULTIPLE review.decided
-- events (rewritten -> skipped -> approved), but the resource-anchored unique
-- index allowed only one per (org,event,resource) and silently dropped the
-- rest. Include the decision in the uniqueness (empty for other event types,
-- preserving their idempotency semantics). Hand-written; idempotent.
DROP INDEX IF EXISTS "user_activity_event_resource_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_activity_event_resource_idx"
  ON "user_activity_event" ("org_id", "event_type", "resource_type", "resource_id", (coalesce("metadata"->>'decision','')))
  WHERE "resource_id" IS NOT NULL;
