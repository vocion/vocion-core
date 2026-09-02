-- The operations layer is deleted: every operation became a skill
-- (SKILL.md), and the record of agent work is the tool_call table.
-- Dropping skill_run removes the old Logs history and per-operation
-- usage counts; the tool_call activity record replaced both before
-- this migration ships (ticket 044 ordering).
--
-- Hand-written; idempotent.
DROP TABLE IF EXISTS "skill_run";--> statement-breakpoint

DROP TABLE IF EXISTS "skill";
