-- Reviewer reactions become learning candidates, and a repeat becomes a count.
--
-- Until now a learning candidate could only come from a document comment or an
-- external client posting to `/api/v1/feedback`. Rejecting an agent's proposed
-- action in the review queue taught the system nothing, and a compliment was
-- classified as `ignore` on purpose. Three changes make both directions
-- teachable, and make a repeated request countable instead of duplicated.
--
-- 1. `learning_candidate.polarity` says whether the rule asks the agent to
--    change ('correct') or to keep doing something ('reinforce'). Default
--    'correct' because every candidate that exists today came from a
--    correction. Kept as text rather than an enum so a third polarity does not
--    need a migration to add and a deploy to roll back.
--
-- 2. `occurrence_count` on both `learning_candidate` and `learning`. When new
--    feedback restates a rule that is already pending or already adopted, we
--    do NOT write a second candidate — we increment this and record the
--    occurrence. That keeps the queue one-row-per-idea while preserving how
--    many distinct people asked, which is what makes the queue sortable by
--    weight of evidence. Starts at 1: the row's own first occurrence.
--
-- 3. `learning_feedback_occurrence` holds one row per piece of feedback that
--    landed on a candidate or a rule, with the note, who submitted it, and the
--    job/run it came from. A table rather than a JSONB array on the candidate
--    because the useful questions are per-person and per-agent ("what has this
--    reviewer been asking for", "which agent generates the most corrections"),
--    and those are WHERE clauses, not array scans.
--
--    Exactly one of `candidate_id` / `learning_id` is set — an occurrence
--    attaches either to a pending suggestion or to an adopted rule, never both
--    and never neither. Enforced in the database because a row with neither is
--    an orphan no query would ever find, and a row with both would be counted
--    twice.

ALTER TABLE "learning_candidate" ADD COLUMN "polarity" text DEFAULT 'correct' NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_candidate" ADD COLUMN "occurrence_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "learning" ADD COLUMN "occurrence_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "learning_feedback_occurrence" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "candidate_id" integer,
  "learning_id" integer,
  "polarity" text NOT NULL,
  "note" text,
  "agent_slug" text,
  "source_feedback_job_id" integer,
  "source_run_id" integer,
  "submitted_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "learning_feedback_occurrence_target_ck" CHECK (
    ("candidate_id" IS NOT NULL AND "learning_id" IS NULL)
    OR ("candidate_id" IS NULL AND "learning_id" IS NOT NULL)
  )
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "learning_feedback_occurrence"
    ADD CONSTRAINT "learning_feedback_occurrence_candidate_id_fk"
    FOREIGN KEY ("candidate_id") REFERENCES "learning_candidate"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "learning_feedback_occurrence"
    ADD CONSTRAINT "learning_feedback_occurrence_learning_id_fk"
    FOREIGN KEY ("learning_id") REFERENCES "learning"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "learning_feedback_occurrence_candidate_idx" ON "learning_feedback_occurrence" ("org_id","candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "learning_feedback_occurrence_learning_idx" ON "learning_feedback_occurrence" ("org_id","learning_id");
