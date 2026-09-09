-- A satisfied rewrite instruction stops reading as an outstanding one.
--
-- `lead_brief.regenerate_note` was written by `regenerateBrief` and never
-- cleared, so once the brief that answered it was written the note still read
-- as pending — to the reviewer on the lead page and to the agent on the next
-- pass. The 19:00 fire on 2026-09-08 spent part of its report speculating
-- about four leads being "stuck" when all four had been re-briefed and
-- re-drafted; the only evidence of a problem was the note nobody had cleared.
--
-- `saveLeadBrief` now clears the note and appends it here with the time the
-- answering brief was written, so the reason a rewrite happened survives.
ALTER TABLE "lead_brief"
  ADD COLUMN IF NOT EXISTS "regenerate_history" jsonb DEFAULT '[]'::jsonb NOT NULL;
