-- ONE DECISION: the ask, extended — not a parallel table (DESIGN-PRINCIPLES 6, 7).
--
-- Vocion asked a person to decide through ten unrelated mechanisms (an ask on
-- Needs you, a recommendation card, a proposal card, an approval gate held
-- only in the browser, a ruling's typed options, chips that sent text …), and
-- every answer re-entered the chat as a NEW user message, read again by the
-- router and the intent judge. A Decision is one noun: a question, options
-- (each with its consequence and the exact action it runs), free text, skip,
-- a deadline and a default, an owner, the asking agent and the conversation
-- it docks in. The ask already holds most of that; these columns hold the rest.
--
--   conversation_id    the conversation the Decision docks in, above the
--                      composer; null for one that lives only on Needs you
--   owner_user_id      the accountable person — who it is waiting on
--   allow_other        whether "Something else" (free text) is offered
--   multi_select       whether several options may be chosen together
--   chosen_option_ids  every option chosen, in order (the first is also
--                      `decision`, so every reader of `decision` keeps working)
--   decided_via        where it was answered: card | composer | needs_you |
--                      slack | email | default | agent
--   effect_run_id      the action_run the chosen option's effect started —
--                      what Undo reverses, and only when that kind has undo
--
-- An approval Decision needs no column: it IS the pending action_run, read as
-- a Decision — a wrapping ask would put every proposal on Needs you twice.
-- `status` gains one value, `skipped`, written by code; the column is text.
-- Expand-only: every column is nullable or has a constant default, so the
-- ALTERs are metadata-only and old code reading `ask` is untouched. The one
-- index (open Decisions in a conversation) is on a table that already exists,
-- so it is built concurrently in production — concurrent/0193_….

ALTER TABLE "ask" ADD COLUMN IF NOT EXISTS "conversation_id" integer;--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN IF NOT EXISTS "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN IF NOT EXISTS "allow_other" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN IF NOT EXISTS "multi_select" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN IF NOT EXISTS "chosen_option_ids" jsonb;--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN IF NOT EXISTS "decided_via" text;--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN IF NOT EXISTS "effect_run_id" integer;
