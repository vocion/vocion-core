-- 0094 — the agent rail: per-message feedback, per-conversation autonomy,
-- and the rail's own open/width state. Hand-written, like every migration
-- since 0066. Additive only; every statement is re-runnable because the
-- production deploy loops psql over this directory on every deploy.
--
-- conversation_message.feedback_*: a thumb (up | down) and an optional note on
-- ONE assistant turn. The rating is a metric (adoption event `chat.feedback`);
-- the note is what teaches the system — it is queued for the feedback
-- classifier and can become a learning candidate (Manifesto §6: every
-- correction is information). Cleared by writing NULLs, never deleted.
ALTER TABLE "conversation_message" ADD COLUMN IF NOT EXISTS "feedback_rating" text;
--> statement-breakpoint
ALTER TABLE "conversation_message" ADD COLUMN IF NOT EXISTS "feedback_note" text;
--> statement-breakpoint
ALTER TABLE "conversation_message" ADD COLUMN IF NOT EXISTS "feedback_at" timestamp;
--> statement-breakpoint
ALTER TABLE "conversation_message" ADD COLUMN IF NOT EXISTS "feedback_by" text;
--> statement-breakpoint
-- conversation.autonomy: how recommended actions behave in THIS thread.
--   'ask'               — the default; each recommendation is a card the
--                          person taps to put it in the review queue.
--   'act-within-bounds' — recommendations are proposed into the review queue
--                          as they arrive and the card reports "in review".
-- Neither value executes anything: the review queue and trust rules still
-- gate every outward action. Text, not an enum, so a new rung is a code
-- change (Manifesto §8: automation is earned one rung at a time).
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "autonomy" text DEFAULT 'ask' NOT NULL;
--> statement-breakpoint
-- chat_widget_state.rail_*: the rail's width in px and whether it is open,
-- per (org, user), so a second browser opens the rail the way the first left
-- it. localStorage is the fast path; this row is what a new device reads.
ALTER TABLE "chat_widget_state" ADD COLUMN IF NOT EXISTS "rail_width" integer;
--> statement-breakpoint
ALTER TABLE "chat_widget_state" ADD COLUMN IF NOT EXISTS "rail_open" boolean;
--> statement-breakpoint
COMMENT ON COLUMN "conversation"."autonomy" IS
  'How recommended actions behave in this thread: ask (cards the person taps) | act-within-bounds (auto-proposed into the review queue). Never executes anything; the review queue and trust rules still gate every outward action.';
--> statement-breakpoint
COMMENT ON COLUMN "conversation_message"."feedback_rating" IS
  'Thumb on this assistant turn: up | down | NULL. The note beside it is queued for the feedback classifier when present.';
