-- 0099 — earned autonomy: the alignment ledger and the autonomy ladder as
-- first-class records. Hand-written, like every migration since 0066.
--
-- Numbered 0099 on purpose: 0090–0098 are claimed by other PRs at the
-- time of writing, and drizzle applies by journal order, so a collision would
-- be a rebase problem rather than a data problem — but a gap costs nothing.
--
-- decision_alignment — one row per human decision on something an agent
-- recommended: an action_run decided in the review queue (subject_kind
-- 'action', subject_key = action id) or an ask answered on the Needs-you page
-- (subject_kind 'ask', subject_key = ask kind). `recommended` is what the
-- agent advised, `agreed` whether the person chose it, `implicit` whether the
-- recommendation was inferred (an action proposed with no suggestedDecision
-- is an implicit approve). `auto_executed` marks a run that had already run
-- under a trust rule when the person decided it. Append-only; the unique
-- index makes a re-decided subject idempotent.
--
-- autonomy_policy — one row per (org, action id): the rung on the manifesto's
-- ladder (observe → recommend → assist → execute-with-approval →
-- execute-within-bounds → autonomous), the risk tier that sets how much
-- evidence the next rung needs, the confidence floor for an auto-execution,
-- who promoted it and on what evidence, and a flag for an automatic demotion
-- nobody has looked at yet. trust_rule stays the execution record
-- ActionService reads; this is the policy that writes it.
--
-- Both tables are created here, so every index is inline (CONVENTIONS.md
-- rule 1 applies to pre-existing tables only). ask.options is jsonb, so the
-- new optional `confidence` on an option needs no DDL.
CREATE TABLE IF NOT EXISTS "decision_alignment" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "subject_kind" text NOT NULL,
  "subject_key" text NOT NULL,
  "subject_id" integer NOT NULL,
  "agent_slug" text,
  "decision" text NOT NULL,
  "recommended" text,
  "implicit" boolean DEFAULT false NOT NULL,
  "agreed" boolean,
  "confidence" real,
  "auto_executed" boolean DEFAULT false NOT NULL,
  "has_note" boolean DEFAULT false NOT NULL,
  "decided_by" text,
  "decided_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "decision_alignment_subject_decision_idx" ON "decision_alignment" ("org_id","subject_kind","subject_id","decision");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_alignment_org_key_decided_idx" ON "decision_alignment" ("org_id","subject_key","decided_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_alignment_org_agent_decided_idx" ON "decision_alignment" ("org_id","agent_slug","decided_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "autonomy_policy" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "action_id" text NOT NULL,
  "rung" text DEFAULT 'execute-with-approval' NOT NULL,
  "risk_tier" text NOT NULL,
  "min_confidence" real,
  "promoted_at" timestamp,
  "promoted_by" text,
  "evidence" jsonb,
  "flagged" boolean DEFAULT false NOT NULL,
  "flag_reason" text,
  "source" text DEFAULT 'app' NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "autonomy_policy_org_action_idx" ON "autonomy_policy" ("org_id","action_id");--> statement-breakpoint
COMMENT ON COLUMN "ask"."options" IS
  'Named answers: { id, label, description?, recommended?, confidence? }. At most one recommended; confidence (0-1) is the asker''s certainty in that option and is advisory only.';
