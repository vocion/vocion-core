CREATE TABLE "context_version" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"sha" text NOT NULL,
	"source_path" text,
	"status" text DEFAULT 'applied' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb,
	"errors" jsonb DEFAULT '[]'::jsonb,
	"applied_by" text,
	"applied_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_run" ADD COLUMN "context_sha" text;--> statement-breakpoint
CREATE UNIQUE INDEX "context_version_org_applied_idx" ON "context_version" USING btree ("org_id","applied_at");