-- 0120 — the workspace has a time zone.
--
-- The server runs in UTC and, until 2026-09-18, so did every date judgement
-- the product made: "is this briefing from today", the briefing title stamp,
-- the calendar tool's "today", the agent's clock line. For a person in
-- Pacific time the agent's day turned at 5pm, the morning's brief went
-- "STALE" over dinner, and a brief published in the evening was titled for
-- tomorrow. A person's own turns now carry their browser's zone; this column
-- is the zone for everything no browser is behind — missions, automations,
-- the morning briefing, the mail and Slack surfaces — authored as
-- `defaults.timezone` in workspace.yaml and applied here.
--
-- Nullable and additive: NULL means "not set", and the reader falls back to
-- VOCION_TIMEZONE, then UTC — the behaviour every row had before this.
ALTER TABLE "project"
  ADD COLUMN IF NOT EXISTS "time_zone" text;
