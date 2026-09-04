-- A person may snooze the same queued item over and over, and each deferral is
-- its own signal — serial snoozing on one agent is exactly the pattern the
-- adoption screen exists to show.
--
-- `user_activity_event_resource_idx` is unique over
-- (org_id, event_type, resource_type, resource_id, decision). Nothing in a
-- snooze's metadata distinguishes the second deferral of an item from the
-- first, so every snooze after the first on a given item hit
-- `on conflict do nothing` and was silently dropped — the same class of bug
-- 0047 fixed for `review.decided` by adding the decision to the key. There is
-- no such discriminator here, so `review.snoozed` is excluded from the
-- uniqueness rule instead. Its double-fire protection is the single choke point
-- in `ReviewService.snooze()`, and a duplicated count is a smaller lie than a
-- lost one. Hand-written; idempotent.
DROP INDEX IF EXISTS "user_activity_event_resource_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_activity_event_resource_idx"
  ON "user_activity_event" ("org_id", "event_type", "resource_type", "resource_id", (coalesce("metadata"->>'decision','')))
  WHERE "resource_id" IS NOT NULL AND "event_type" <> 'review.snoozed';
