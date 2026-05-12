CREATE TABLE "playbook" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"frontmatter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_sha" text NOT NULL,
	"source_files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"license" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "playbook_org_slug_idx" ON "playbook" USING btree ("org_id","slug");