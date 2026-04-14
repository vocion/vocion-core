ALTER TABLE "business_object_type" ADD COLUMN "source_relevance" jsonb;--> statement-breakpoint
ALTER TABLE "business_object_type" ADD COLUMN "few_shot_examples" jsonb;--> statement-breakpoint
ALTER TABLE "business_object_type" ADD COLUMN "classification_prompt" text;