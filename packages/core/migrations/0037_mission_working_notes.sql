-- Mission working memory: the team's persistent notes across checks —
-- open threads (with age), commitments + due dates, escalation state.
-- Read into every check brief; rewritten by update_mission_notes.
ALTER TABLE "mission" ADD COLUMN IF NOT EXISTS "working_notes" text;
