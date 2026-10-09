-- Saved views and the query log they are learned from (services/state/views.ts,
-- services/state/learnViews.ts). Both tables are new, so their indexes are built
-- here, on empty tables, inside the migration.
CREATE TABLE IF NOT EXISTS "state_view" (
  "id" serial PRIMARY KEY NOT NULL,
  "scope" text NOT NULL,
  "account_id" text,
  "org_id" text,
  "user_id" text REFERENCES "user"("id") ON DELETE CASCADE,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "query" jsonb NOT NULL,
  "in_brief" boolean DEFAULT false NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "state_view_scope_owner_slug_uq" ON "state_view" USING btree ("scope", "account_id", "org_id", "user_id", "slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "state_view_org_user_idx" ON "state_view" USING btree ("org_id", "user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "state_query_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "shape" text NOT NULL,
  "query" jsonb NOT NULL,
  "view_slug" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "state_query_log_user_shape_idx" ON "state_query_log" USING btree ("user_id", "org_id", "shape", "created_at");
