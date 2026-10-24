-- Where a mission check's result goes when the check finishes (ADR 0008):
-- `{"email": true}` mails the briefing it published to the accountable
-- person, a list mails those addresses. NULL delivers nothing, as before.
ALTER TABLE "mission" ADD COLUMN IF NOT EXISTS "deliver" jsonb;
