ALTER TABLE "conversation_message" ADD COLUMN "langfuse_trace_id" text;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD COLUMN "confidence" text;--> statement-breakpoint
ALTER TABLE "skill_run" ADD COLUMN "confidence" text;