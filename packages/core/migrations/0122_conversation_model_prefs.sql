-- 0122 — how strong a model, how much it thinks, per conversation.
--
-- A person had no say in which model answered or how hard it thought; both
-- were the agent's YAML and the server's env. Chris, 2026-09-18: *"why don't I
-- have tools when chatting to control reasoning level or model strength?"*
-- Two nullable text columns beside `autonomy`, the same unit (a thread) for
-- the same reason: appetite differs by task, not by day.
--
--   model_strength   fast | balanced | deep   (null = balanced: the agent's own)
--   thinking_effort  off | low | medium | high (null = off)
ALTER TABLE "conversation"
  ADD COLUMN IF NOT EXISTS "model_strength" text;
--> statement-breakpoint
ALTER TABLE "conversation"
  ADD COLUMN IF NOT EXISTS "thinking_effort" text;
