-- Push to the person: where their brief and urgent items reach them beyond the
-- app, quiet hours, and how far the urgent sweep has read (docs/guides/push-to-you.md).
ALTER TABLE "personal_rhythm" ADD COLUMN IF NOT EXISTS "push_channels" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "personal_rhythm" ADD COLUMN IF NOT EXISTS "push_mode" text DEFAULT 'brief_and_urgent' NOT NULL;
--> statement-breakpoint
ALTER TABLE "personal_rhythm" ADD COLUMN IF NOT EXISTS "quiet_start" text;
--> statement-breakpoint
ALTER TABLE "personal_rhythm" ADD COLUMN IF NOT EXISTS "quiet_end" text;
--> statement-breakpoint
ALTER TABLE "personal_rhythm" ADD COLUMN IF NOT EXISTS "urgent_seen_at" timestamp;
