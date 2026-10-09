-- Goals (libs/objectives/goal.ts, services/objectives/GoalService.ts): the
-- objective noun, generalised past a conversation's setup. A goal outlives
-- any one conversation and is listed, measured and reviewed on its own, so
-- it is a row rather than `conversation.objective` jsonb; a conversation
-- working on one points at it (`{"kind":"goal","goalId":…}`).
-- Every row is scoped to its home workspace (org_id) and its owner.
-- The table is new, so its indexes are built here, on an empty table.
CREATE TABLE IF NOT EXISTS "goal" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL,
  "owner_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "horizon" jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "measure" jsonb NOT NULL,
  "links" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "cadence" text,
  "next_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "activity" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_done" integer,
  "last_total" integer,
  "progress_at" timestamp,
  "created_by" text NOT NULL,
  "created_from" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_org_owner_status_idx" ON "goal" USING btree ("org_id", "owner_user_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_owner_status_idx" ON "goal" USING btree ("owner_user_id", "status");
