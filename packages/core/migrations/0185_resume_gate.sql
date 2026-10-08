-- A run that has nothing to do but wait stops spending.
--
-- A long-running worker run, mission run or scheduled automation whose
-- remaining work is all blocked on asks parks here: ONE resume-gate ask is
-- filed ("nothing I can do until …") and the subject spends nothing — no model
-- calls, no schedule fires — until that ask is answered or every ask it waits
-- on is (`services/needsYou/ResumeGateService.ts`). The zero-person company
-- kept paying for long runs with nothing they could do; this is the stop.
--
-- New table, expand-only; its indexes are built with it. The partial unique
-- index is what makes it ONE gate per subject: a second park of the same run
-- joins the gate already standing instead of filing another ask.

CREATE TABLE IF NOT EXISTS "resume_gate" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "subject_kind" text NOT NULL,
  "subject_ref" text NOT NULL,
  "automation_slug" text,
  "agent_slug" text,
  "gate_ask_id" integer,
  "waiting_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "reason" text,
  "status" text DEFAULT 'parked' NOT NULL,
  "parked_at" timestamp DEFAULT now() NOT NULL,
  "resolved_at" timestamp,
  "resolved_by" text,
  "resolution_note" text,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resume_gate_parked_subject_uq" ON "resume_gate" ("org_id", "subject_kind", "subject_ref") WHERE "status" = 'parked';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resume_gate_org_status_idx" ON "resume_gate" ("org_id", "status");
