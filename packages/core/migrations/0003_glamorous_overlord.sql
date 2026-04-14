CREATE TABLE "agent" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"system_prompt" text NOT NULL,
	"model" text DEFAULT 'gpt-4o',
	"temperature" text DEFAULT '0.3',
	"skill_slugs" jsonb DEFAULT '[]'::jsonb,
	"connector_sources" jsonb DEFAULT '[]'::jsonb,
	"object_type_slugs" jsonb DEFAULT '[]'::jsonb,
	"document_set_ids" jsonb DEFAULT '[]'::jsonb,
	"approval_policy" jsonb DEFAULT '{}'::jsonb,
	"langfuse_project_id" text,
	"icon" text,
	"active" text DEFAULT 'true',
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_org_slug_idx" ON "agent" USING btree ("org_id","slug");