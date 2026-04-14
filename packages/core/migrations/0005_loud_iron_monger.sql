ALTER TABLE "agent" ADD COLUMN "search_config" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "few_shot_examples" jsonb DEFAULT '[]'::jsonb;