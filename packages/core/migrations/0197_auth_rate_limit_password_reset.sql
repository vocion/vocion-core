-- Sign-in fit for client data, part one: rate limits and forgot-password.
--
-- `rate_limit_hit` is the shared counter behind `libs/rateLimit`. One row is
-- one key (a policy name plus who it counts: an IP, an email, a user) in one
-- fixed window. A hit is a single upsert that returns the new count, so every
-- app instance sees the same number and a lockout holds across a restart or a
-- second container. Only the policies that guard a secret use it (sign-in,
-- the second factor, invites, password reset); throughput limits on the chat
-- and the API count in process memory instead (`libs/rateLimit/policies.ts`).
-- Rows expire on their own clock and are swept opportunistically, so the table
-- holds roughly one row per active key.
--
-- `password_reset_token` holds one forgot-password link. Only the SHA-256 of
-- the token is stored: the link in the person's mail is the one copy of the
-- secret, so a read of this table cannot reset anyone's password. A token is
-- single-use (`used_at`, claimed with a conditional update) and expires an hour
-- after it is issued (`expires_at`, set by `services/auth/passwordReset.ts`).
--
-- Both tables are new, so their indexes are built here (CONVENTIONS.md rule 1
-- applies to tables that already exist).

CREATE TABLE IF NOT EXISTS "rate_limit_hit" (
  "key" text NOT NULL,
  "window_start" timestamp NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp NOT NULL,
  CONSTRAINT "rate_limit_hit_pk" PRIMARY KEY ("key", "window_start")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limit_hit_expires_idx" ON "rate_limit_hit" ("expires_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "password_reset_token" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_token_hash_idx" ON "password_reset_token" ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_reset_token_user_idx" ON "password_reset_token" ("user_id");
