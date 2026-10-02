-- What an agent run cost, recorded where the model call is charged
-- (`services/budget/runCost.ts`). Added without a default first, so every row
-- written before this migration stays NULL — "not recorded", never a
-- fabricated $0.00 — and only then given one, so a mission run created from
-- here on starts at zero and counts up.
ALTER TABLE "mission_run" ADD COLUMN IF NOT EXISTS "tokens" bigint;--> statement-breakpoint
ALTER TABLE "mission_run" ADD COLUMN IF NOT EXISTS "micro_cents" bigint;--> statement-breakpoint
ALTER TABLE "mission_run" ALTER COLUMN "tokens" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "mission_run" ALTER COLUMN "micro_cents" SET DEFAULT 0;--> statement-breakpoint
-- A chat turn's cost sits on the assistant message that answered it; the
-- conversation carries the running sum, kept beside `message_count` in the
-- same write.
ALTER TABLE "conversation_message" ADD COLUMN IF NOT EXISTS "tokens" bigint;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD COLUMN IF NOT EXISTS "micro_cents" bigint;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "tokens" bigint;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS "micro_cents" bigint;
