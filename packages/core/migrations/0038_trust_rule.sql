-- Trust ladder execution: per-action auto-approve rules. A pending proposal
-- whose confidence clears an ENABLED rule's threshold executes immediately
-- (fully audited via proposal.autoApproved). Default: no rules = every
-- external action rides the review queue.
CREATE TABLE IF NOT EXISTS "trust_rule" (
  "id" serial PRIMARY KEY,
  "org_id" text NOT NULL,
  "action_id" text NOT NULL,
  "threshold" real NOT NULL,
  "enabled" text DEFAULT 'false' NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trust_rule_org_action_idx" ON "trust_rule" ("org_id", "action_id");
