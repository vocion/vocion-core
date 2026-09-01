-- Learning candidates (VEERIO-239). A rule the feedback worker proposes but
-- the system has not adopted: it sits here as 'pending' until a person
-- approves it into a real `learning` row or rejects it with a reason.
--
-- The rejected pile is the point. A plain delete would throw away why a
-- suggestion was turned down, which is exactly the signal worth keeping.
--
-- Hand-written; idempotent.
CREATE TABLE IF NOT EXISTS "learning_candidate" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "project_id" text,
  "step_name" text NOT NULL,
  "rule_text" text NOT NULL,
  "edited_rule_text" text,
  "source_feedback_job_id" integer,
  "source_run_id" integer,
  "status" text DEFAULT 'pending' NOT NULL,
  "rejected_reason" text,
  "decided_by" text,
  "decided_at" timestamp,
  "created_learning_id" integer,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "learning_candidate"
    ADD CONSTRAINT "learning_candidate_project_id_project_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- The back-link to the feedback that suggested the rule. Nulled rather than
-- cascaded: losing the feedback should not erase the decision made about it.
DO $$ BEGIN
  ALTER TABLE "learning_candidate"
    ADD CONSTRAINT "learning_candidate_source_feedback_job_id_feedback_job_id_fk"
    FOREIGN KEY ("source_feedback_job_id") REFERENCES "public"."feedback_job"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "learning_candidate"
    ADD CONSTRAINT "learning_candidate_created_learning_id_learning_id_fk"
    FOREIGN KEY ("created_learning_id") REFERENCES "public"."learning"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- Every queue read is "this org's candidates in this state".
CREATE INDEX IF NOT EXISTS "learning_candidate_org_status_idx"
  ON "learning_candidate" USING btree ("org_id","status");
