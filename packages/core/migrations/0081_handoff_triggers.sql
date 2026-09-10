-- Hand-written, per 0075's precedent.
--
-- The handoff watcher's memory. After every HubSpot contacts sync,
-- `HandoffTriggerService` compares each enrolled lead's newest reply and
-- meeting timestamps on the CRM mirror against these two columns; a newer
-- value that also postdates the enrollment decision fires a `lead.replied` or
-- `lead.meeting_booked` event, and the column moves up to it. Null means the
-- lead has not been watched since enrollment: the first watch baselines and
-- fires only for activity after the decision. `handoff_watched_at` records
-- that first watch, which is what lets a boolean meeting flag (no date of its
-- own) fire only when it flips on a later watch.
--
-- Idempotent (IF NOT EXISTS), matching 0070 and 0075.
ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "handoff_reply_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "handoff_meeting_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "handoff_watched_at" timestamp;
