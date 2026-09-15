-- The regenerating state becomes server truth on the run itself.
--
-- Regenerate (shipped 2026-09-11) left the in-flight state client-side: a
-- reload showed the stale card fully enabled and decidable, and a
-- mid-regeneration approve would have enrolled the stale copy AND duplicated
-- the card when the re-propose landed. The stamp is written by the regenerate
-- route before the work dispatches and cleared by the dedup refresh that
-- lands the new content; `regenerate_note` carries the reviewer's instruction
-- so every surface can show what the card is waiting on.
ALTER TABLE "action_run"
  ADD COLUMN IF NOT EXISTS "regenerating_since" timestamp,
  ADD COLUMN IF NOT EXISTS "regenerate_note" text;
