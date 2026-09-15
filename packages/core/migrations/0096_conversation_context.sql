-- Where a conversation started (R4, act from context).
--
-- The dock sends a structured page context with every turn — page, the record
-- the page is about, the highlighted passage, @-mentions. The transcript keeps
-- the person's words as typed; this column keeps the FIRST turn's context so a
-- thread in history reads "opened from Revenue Briefing — Mon, Sep 15" instead
-- of a bare title. Set once by the stream route; nullable for every thread
-- opened with nothing in view. Shape documented in services/chat/pageContext.ts.
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "context_json" jsonb;
--> statement-breakpoint
COMMENT ON COLUMN "conversation"."context_json" IS
  'PageContext of the first turn: {path, title, record?: {type,id,label,href}, selection?: {text}, refs?: [...], openedFrom?: true}. Null when the thread was opened with nothing in view.';
