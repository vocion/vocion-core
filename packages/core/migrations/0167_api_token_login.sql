-- A login (OAuth grant or app install) is stored where a pasted key is (#1080).
-- `obtained_via` says which; `account` is the non-secret identity the login
-- belongs to (a GitHub org, an Atlassian site, a Slack team), used to keep one
-- row per account across re-logins. Replay-safe: every deploy re-runs this file.
ALTER TABLE "api_token" ADD COLUMN IF NOT EXISTS "obtained_via" text DEFAULT 'paste' NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN IF NOT EXISTS "account" text;
