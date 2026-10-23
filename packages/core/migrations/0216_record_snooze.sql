-- Snooze an owed record to a date (objects.update_meta `snoozedUntil`, RecordLifecycle's Snooze).
-- A date, not a state: once it passes the record is open again, so nothing has to wake it.
-- A nullable column with no default is a metadata change: no rewrite, no index.
ALTER TABLE "business_object" ADD COLUMN IF NOT EXISTS "snoozed_until" timestamp with time zone;
