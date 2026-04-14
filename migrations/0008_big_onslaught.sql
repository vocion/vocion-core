CREATE TABLE "workflow_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workflow_id" integer NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb,
	"trigger_context" jsonb DEFAULT '{}'::jsonb,
	"status" text DEFAULT 'running' NOT NULL,
	"step_results" jsonb DEFAULT '{}'::jsonb,
	"current_step" integer DEFAULT 0,
	"pause_reason" text,
	"paused_at" timestamp,
	"error" text,
	"context_sha" text,
	"created_by" text,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"version" integer DEFAULT 1,
	"status" text DEFAULT 'active',
	"trigger" jsonb NOT NULL,
	"steps" jsonb NOT NULL,
	"input_schema" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_org_slug_idx" ON "workflow" USING btree ("org_id","slug");