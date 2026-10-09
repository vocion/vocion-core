-- A person's day with their own assistant: when the morning brief and the
-- evening wrap arrive, in their own zone (docs/guides/morning-brief.md).
CREATE TABLE IF NOT EXISTS "personal_rhythm" (
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL REFERENCES "tenant_account"("id") ON DELETE CASCADE,
  "brief_at" text DEFAULT '07:30' NOT NULL,
  "wrap_at" text DEFAULT '17:30' NOT NULL,
  "brief_on" boolean DEFAULT true NOT NULL,
  "wrap_on" boolean DEFAULT true NOT NULL,
  "time_zone" text,
  "next_brief_at" timestamp,
  "next_wrap_at" timestamp,
  "last_brief_at" timestamp,
  "last_wrap_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "personal_rhythm_user_id_account_id_pk" PRIMARY KEY ("user_id", "account_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personal_rhythm_next_brief_idx" ON "personal_rhythm" ("next_brief_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personal_rhythm_next_wrap_idx" ON "personal_rhythm" ("next_wrap_at");
--> statement-breakpoint
-- The Org's switch for daily briefs, and what they may spend on the model in a day.
ALTER TABLE "tenant_account" ADD COLUMN IF NOT EXISTS "daily_briefs" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_account" ADD COLUMN IF NOT EXISTS "brief_daily_cents" integer;
