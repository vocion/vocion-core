-- Personalization surface, scaffold.
--
-- Two independent pieces:
--   1. `project.enabled_surfaces` — the optional dashboard surfaces a
--      workspace switched on via workspace.yaml `surfaces:`. Defaults to an
--      empty list, so every existing project keeps exactly today's sidebar.
--   2. `lead_brief` — the personalization ledger. One row per MQL the sweep
--      picked up, carrying the brief, the drafted sequence, and the audit
--      trail behind both. Mirrors discovery_candidate.
--
-- Hand-written; idempotent.
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "enabled_surfaces" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "lead_brief" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "contact_ref" text NOT NULL,
  "contact_name" text NOT NULL,
  "contact_title" text,
  "company_name" text,
  "trigger_type" text NOT NULL,
  "entrance_source" text,
  "utm_campaign" text,
  "engagement_sent" integer DEFAULT 0 NOT NULL,
  "engagement_opened" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'ready_for_review' NOT NULL,
  "confidence" real,
  "claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "draft_sequence" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "review_action_run_id" integer,
  "thresholds" jsonb,
  "brief_version" text,
  "workspace_sha" text,
  "briefed_by" jsonb,
  "skipped_reason" text,
  "briefed_at" timestamp,
  "decided_at" timestamp,
  "decided_by" text,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- One brief per lead — this is what makes a re-fire of the sweep a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS "lead_brief_org_contact_idx" ON "lead_brief" ("org_id","contact_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_brief_org_status_idx" ON "lead_brief" ("org_id","status");
