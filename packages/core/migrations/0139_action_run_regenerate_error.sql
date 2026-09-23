-- 0139, why the last regeneration did not land.
--
-- A regenerate that failed behind the response used to leave nothing on the
-- run: the route logged a warning and cleared the regenerating stamp, the
-- card polled, saw the stamp gone and reloaded the same copy. A reviewer
-- could not tell "it failed" from "it changed nothing" (Metacto ticket 069,
-- 2026-09-22, proposal 509). One nullable text column, set in the dispatch
-- failure handler, cleared when the next regeneration starts and when a
-- redraft lands through the dedup refresh. Additive, no default, no rewrite.
ALTER TABLE "action_run" ADD COLUMN IF NOT EXISTS "regenerate_error" text;
