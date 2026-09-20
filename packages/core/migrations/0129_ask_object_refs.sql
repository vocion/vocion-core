-- 0129 — what an ask is about, and what deciding it costs.
--
-- `object_refs` names the records a question concerns — `[{ type, id }]`, an
-- object type slug and the object's id — so a person's answer can be read
-- back onto them: `ask.decided` carries the refs, and an automation filtered
-- on the asking agent and the kind writes the decision where the question
-- came from. Until this the only link from an ask to a record was prose in
-- the body. `decision_cost` is the minutes of attention the asker estimates
-- the decision takes, summed by a batch against a daily decision budget.
--
-- Both are metadata-only adds: a jsonb with a constant default and a
-- nullable integer. Hand-written, like every migration since 0066.
ALTER TABLE "ask" ADD COLUMN IF NOT EXISTS "object_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN IF NOT EXISTS "decision_cost" integer;
