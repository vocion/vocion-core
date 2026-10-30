-- The wiki's evidence graph (ADR 0012). A new table, so its indexes are built
-- here, on an empty table, without blocking anything.
CREATE TABLE IF NOT EXISTS "memory_edge" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "from_ref" text NOT NULL,
  "edge" text NOT NULL,
  "to_ref" text NOT NULL,
  "to_hash" text,
  "claim" text,
  "excerpt" text,
  "origin" text NOT NULL,
  "page_slug" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memory_edge_org_from_edge_to_idx" ON "memory_edge" USING btree ("org_id","from_ref","edge","to_ref");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_edge_org_to_idx" ON "memory_edge" USING btree ("org_id","to_ref");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_edge_org_page_idx" ON "memory_edge" USING btree ("org_id","page_slug");
