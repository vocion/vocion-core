ALTER TABLE "agent" ADD COLUMN "subagents" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "playbook_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "learning_steps" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "accent" text;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "eyebrow" text;