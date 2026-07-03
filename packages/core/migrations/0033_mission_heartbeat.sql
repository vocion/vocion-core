-- Missions are standing responsibilities: an optional heartbeat cron makes
-- the team check the charter on a cadence (heartbeat-mode run, no planner).
ALTER TABLE "mission" ADD COLUMN IF NOT EXISTS "heartbeat" text;
