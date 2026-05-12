CREATE TABLE "agent_budget" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_slug" text NOT NULL,
	"period" text DEFAULT 'daily' NOT NULL,
	"current_tokens" bigint DEFAULT 0 NOT NULL,
	"current_cents" bigint DEFAULT 0 NOT NULL,
	"soft_token_limit" bigint,
	"soft_cents_limit" bigint,
	"hard_token_limit" bigint,
	"hard_cents_limit" bigint,
	"period_started_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_case_result" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"item_index" integer NOT NULL,
	"input" text NOT NULL,
	"output" text,
	"score" text,
	"verdict" text,
	"rationale" text,
	"trace_id" text,
	"latency_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_dataset" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"agent_slug" text NOT NULL,
	"description" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"dataset_id" integer NOT NULL,
	"agent_slug" text NOT NULL,
	"context_sha" text,
	"status" text DEFAULT 'running' NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "eval_case_result" ADD CONSTRAINT "eval_case_result_run_id_eval_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_run" ADD CONSTRAINT "eval_run_dataset_id_eval_dataset_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."eval_dataset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_budget_org_slug_period_idx" ON "agent_budget" USING btree ("org_id","agent_slug","period");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_dataset_org_slug_idx" ON "eval_dataset" USING btree ("org_id","slug");