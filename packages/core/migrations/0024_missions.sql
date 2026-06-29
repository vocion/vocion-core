-- Missions: open-ended, goal-driven team work (the third work mode).
-- Hand-written (drizzle-kit generate is blocked by the pre-existing 0021/0022
-- snapshot collision in migrations/meta).
CREATE TABLE "mission" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"version" integer DEFAULT 1,
	"status" text DEFAULT 'active',
	"goal" text NOT NULL,
	"default_team" jsonb NOT NULL,
	"autonomy_policy" jsonb DEFAULT '{}'::jsonb,
	"success_criteria" jsonb DEFAULT '[]'::jsonb,
	"desired_artifacts" jsonb DEFAULT '[]'::jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text,
	"mission_id" integer,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"goal" text,
	"status" text DEFAULT 'planning' NOT NULL,
	"plan" jsonb DEFAULT '{"tasks":[]}'::jsonb,
	"team" jsonb NOT NULL,
	"autonomy_policy" jsonb DEFAULT '{}'::jsonb,
	"artifacts" jsonb DEFAULT '[]'::jsonb,
	"pause_reason" text,
	"paused_at" timestamp,
	"error" text,
	"workspace_sha" text,
	"created_by" text,
	"rating" text,
	"feedback_note" text,
	"feedback_by" text,
	"feedback_at" timestamp,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mission" ADD CONSTRAINT "mission_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_run" ADD CONSTRAINT "mission_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_run" ADD CONSTRAINT "mission_run_mission_id_mission_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."mission"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mission_org_slug_idx" ON "mission" USING btree ("org_id","slug");
