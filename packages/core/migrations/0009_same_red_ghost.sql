ALTER TABLE "skill_run" ADD COLUMN "rating" text;--> statement-breakpoint
ALTER TABLE "skill_run" ADD COLUMN "feedback_note" text;--> statement-breakpoint
ALTER TABLE "skill_run" ADD COLUMN "feedback_by" text;--> statement-breakpoint
ALTER TABLE "skill_run" ADD COLUMN "feedback_at" timestamp;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "rating" text;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "feedback_note" text;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "feedback_by" text;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD COLUMN "feedback_at" timestamp;