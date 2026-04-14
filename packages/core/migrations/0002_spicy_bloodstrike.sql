CREATE TABLE "skill_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"skill_id" integer NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb,
	"output" text,
	"status" text DEFAULT 'pending',
	"langfuse_trace_id" text,
	"created_by" text,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"prompt_template" text NOT NULL,
	"input_schema" jsonb,
	"model" text DEFAULT 'gpt-4o',
	"temperature" text DEFAULT '0.3',
	"requires_approval" text DEFAULT 'true',
	"category" text DEFAULT 'query',
	"version" integer DEFAULT 1,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_run" ADD CONSTRAINT "skill_run_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_org_slug_idx" ON "skill" USING btree ("org_id","slug");