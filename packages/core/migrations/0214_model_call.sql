-- The spend ledger (services/spend/ledger.ts): one row per paid model call, written by
-- chargeUsage beside the budget counters, carrying the workspace, Org, agent, feature, person,
-- conversation, run and model the call belonged to. agent_budget keeps its counters for caps.
-- The table is new, so its indexes are built here.
CREATE TABLE IF NOT EXISTS "model_call" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "account_id" text,
  "agent_slug" text,
  "feature" text NOT NULL,
  "user_id" text,
  "conversation_id" integer,
  "message_id" integer,
  "run_kind" text,
  "run_id" text,
  "provider" text,
  "model" text NOT NULL,
  "effort_level" text,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "cache_read_tokens" integer DEFAULT 0 NOT NULL,
  "cache_write_tokens" integer DEFAULT 0 NOT NULL,
  "micro_cents" bigint DEFAULT 0 NOT NULL,
  "latency_ms" integer,
  "trace_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_call_org_created_idx" ON "model_call" USING btree ("org_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_call_account_created_idx" ON "model_call" USING btree ("account_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_call_agent_created_idx" ON "model_call" USING btree ("agent_slug", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_call_user_created_idx" ON "model_call" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_call_run_idx" ON "model_call" USING btree ("run_kind", "run_id");
