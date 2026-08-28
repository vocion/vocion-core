-- The tool-call activity record (ticket 044). One row per domain-tool
-- invocation, written at the tool registry so every harness provider is
-- covered. Replaces the operation-scoped skill_run history as the record
-- of what agents do.
--
-- Hand-written; idempotent.
CREATE TABLE IF NOT EXISTS "tool_call" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "project_id" text,
  "agent_slug" text NOT NULL,
  "lead_agent_slug" text,
  "tool" text NOT NULL,
  "input" jsonb DEFAULT '{}'::jsonb,
  "output" text,
  "error" text,
  "duration_ms" integer,
  "conversation_id" integer,
  "mission_run_id" integer,
  "provider" text,
  "langfuse_trace_id" text,
  "workspace_sha" text,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_project_id_project_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tool_call_org_created_idx" ON "tool_call" ("org_id","created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tool_call_org_agent_idx" ON "tool_call" ("org_id","agent_slug");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tool_call_org_tool_idx" ON "tool_call" ("org_id","tool");
