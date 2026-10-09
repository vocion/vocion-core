-- Briefs read aloud (docs/guides/listen-to-your-brief.md). Every column is
-- nullable or has a constant default, so adding them rewrites no table. The
-- feed table is new, so its indexes are built here, on an empty table.
ALTER TABLE "briefing" ADD COLUMN IF NOT EXISTS "audio" jsonb;
--> statement-breakpoint
ALTER TABLE "personal_rhythm" ADD COLUMN IF NOT EXISTS "listen_on" boolean;
--> statement-breakpoint
ALTER TABLE "personal_rhythm" ADD COLUMN IF NOT EXISTS "voice_id" text;
--> statement-breakpoint
ALTER TABLE "personal_rhythm" ADD COLUMN IF NOT EXISTS "listen_speed" real DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_account" ADD COLUMN IF NOT EXISTS "brief_audio" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_account" ADD COLUMN IF NOT EXISTS "brief_voice_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "podcast_feed" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL REFERENCES "tenant_account"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_fetched_at" timestamp,
  "revoked_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "podcast_feed_token_uq" ON "podcast_feed" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "podcast_feed_user_idx" ON "podcast_feed" USING btree ("user_id", "account_id");
