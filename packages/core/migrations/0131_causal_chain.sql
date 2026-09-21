-- 0131 — the causal chain behind a run and an event.
--
-- On 20 September `wiki-debrief` fired on `mission_run.completed`; each fire
-- was a mission check whose completion raised `mission_run.completed`, which
-- fired it again — sixty runs in minutes. Nothing on the mission run said
-- which automation had started it, so the event matcher could not tell a
-- run's own residue from work worth debriefing.
--
-- `mission_run.caused_by` and `event_log.caused_by` carry the chain of
-- automation fires that led here, newest first: `[{ automationSlug,
-- automationRunId, missionRunId }]`. The matcher skips an automation whose
-- slug is on the chain of the event it is looking at. Both nullable, no
-- default: metadata-only, per CONVENTIONS.md rule 2. Hand-written; idempotent.
ALTER TABLE "mission_run" ADD COLUMN IF NOT EXISTS "caused_by" jsonb;
--> statement-breakpoint
ALTER TABLE "event_log" ADD COLUMN IF NOT EXISTS "caused_by" jsonb;
