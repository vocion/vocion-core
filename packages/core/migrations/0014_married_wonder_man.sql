CREATE TABLE "conversation_message" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"runs_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_slug" text NOT NULL,
	"title" text NOT NULL,
	"created_by" text,
	"message_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"step_id" integer NOT NULL,
	"rule_text" text NOT NULL,
	"source" text,
	"created_by" text,
	"last_used_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_step" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"preamble" text,
	"agent_slugs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning" ADD CONSTRAINT "learning_step_id_learning_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."learning_step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_org_agent_updated_idx" ON "conversation" USING btree ("org_id","agent_slug","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_step_org_name_idx" ON "learning_step" USING btree ("org_id","name");