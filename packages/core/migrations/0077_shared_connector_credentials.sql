-- One stored credential may now be held by several sources.
--
-- Until now every connector platform served one connector, and every credential
-- was issued for one place: a Strapi API token is worthless against any
-- instance but the one that minted it, so two sources pointing at the same
-- credential row could only be a mistake, and a unique index said so.
--
-- That stopped being true with the Google, Slack and Zoom platforms. One Google
-- OAuth consent yields a refresh token that Gmail, Drive, Calendar, Analytics
-- and Ads all authenticate with; one Slack bot token reads every channel the
-- workspace syncs, and a source syncs one channel; one Zoom server-to-server
-- app covers the whole account. Making a workspace paste the same secret once
-- per source would be the wrong answer to all three.
--
-- The exclusivity rule is kept rather than given up — it just narrows to the
-- links that want it. `credentialsShareable` on the platform descriptor in
-- `src/libs/platforms/registry.ts` decides, `linkSourceToStoredCredential`
-- writes the answer onto the row, and the index below reads it. A partial index
-- cannot look up a platform descriptor, but it can read a boolean.

-- 1. Each link records whether it claims the credential exclusively.
ALTER TABLE "knowledge_source"
  ADD COLUMN IF NOT EXISTS "api_token_exclusive" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Every link that exists today is to one of the four per-instance platforms
-- (granola, hubspot, jira, strapi), all of which stay exclusive.
UPDATE "knowledge_source"
  SET "api_token_exclusive" = true
  WHERE "api_token_id" IS NOT NULL;--> statement-breakpoint

-- 2. Uniqueness narrows to those rows; a plain index keeps the column's lookups
--    fast for the shared links the unique one no longer covers.
DROP INDEX IF EXISTS "knowledge_source_api_token_live_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_source_api_token_exclusive_idx"
  ON "knowledge_source" ("api_token_id")
  WHERE "api_token_id" IS NOT NULL AND "api_token_exclusive";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_source_api_token_live_idx"
  ON "knowledge_source" ("api_token_id")
  WHERE "api_token_id" IS NOT NULL;--> statement-breakpoint

-- 3. The new platforms join the list of those an org may hold more than one
--    live credential for — "Slack — support workspace" and "Slack — partner
--    workspace" are both live at once, and each source names the one it wants.
--    Spelled out in SQL because a partial index cannot call into TypeScript;
--    `MANY_CREDENTIAL_PLATFORM_IDS` is the copy application code reads and
--    `registry.test.ts` fails if the two drift.
DROP INDEX IF EXISTS "api_token_org_platform_live_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_token_org_platform_live_idx"
  ON "api_token" ("org_id", "platform")
  WHERE "revoked_at" IS NULL
    AND "platform" NOT IN ('vocion', 'granola', 'hubspot', 'jira', 'strapi', 'google', 'slack', 'zoom');
