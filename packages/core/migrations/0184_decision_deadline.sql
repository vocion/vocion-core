-- The clock on every decision waiting on Needs you.
--
-- Vocion's own zero-person company stopped with 24 approvals nobody approved
-- or rejected: an ask had no deadline, no default, nobody it escalated to and
-- no way to be accepted in a batch. This table is the clock. One row per open
-- ask or pending proposal, opened by the needs-you sweep
-- (`services/needsYou/DecisionClockService.ts`): when it is due, what happens
-- if nobody answers (the asker's recommended option), who hears about it
-- before then, and what became of it — applied by default, held for a person
-- because the trust ladder keeps it, or settled by a person.
--
-- A side table, like `decision_alignment`: `ask` and `action_run` are not
-- touched, so nothing that writes them changes. Expand-only. The table is new,
-- so its indexes are built here with it (CONVENTIONS.md rule 1 applies to
-- tables that already exist).

CREATE TABLE IF NOT EXISTS "decision_deadline" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "subject_kind" text NOT NULL,
  "subject_id" integer NOT NULL,
  "deadline_at" timestamp NOT NULL,
  "escalate_at" timestamp NOT NULL,
  "next_at" timestamp NOT NULL,
  "default_option" text,
  "default_label" text,
  "owner_user_id" text,
  "owner_source" text,
  "escalations" integer DEFAULT 0 NOT NULL,
  "last_escalated_at" timestamp,
  "status" text DEFAULT 'open' NOT NULL,
  "outcome_reason" text,
  "applied_at" timestamp,
  "undone_at" timestamp,
  "undone_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "decision_deadline_subject_uq" ON "decision_deadline" ("org_id", "subject_kind", "subject_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_deadline_due_idx" ON "decision_deadline" ("status", "next_at");
