-- Ticket 011: discovery-call detection.
-- discovery_candidate is the feature's provenance ledger and safety invariant:
-- a row exists ONLY for a meeting that passed the CRM match gate, so the
-- presence of a row is itself the proof the content gate was satisfied before
-- any transcript was read (ties to ticket 010). Hand-written; idempotent.
CREATE TABLE IF NOT EXISTS "discovery_candidate" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "meeting_external_id" text NOT NULL,
  "meeting_doc_id" integer,
  "meeting_title" text,
  "meeting_start" timestamp,
  "match_type" text NOT NULL,
  "match_ref" text,
  "match_reason" text,
  "matched_at" timestamp DEFAULT now() NOT NULL,
  "status" text DEFAULT 'matched' NOT NULL,
  "classification" jsonb,
  "classified_at" timestamp,
  "route" text,
  "review_action_run_id" integer,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_candidate_org_meeting_idx" ON "discovery_candidate" ("org_id","meeting_external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discovery_candidate_org_status_idx" ON "discovery_candidate" ("org_id","status");
