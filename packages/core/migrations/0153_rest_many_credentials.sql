-- A workspace may hold several REST API credentials.
--
-- The `rest` platform is a bearer token plus the base URL it was issued for, so
-- one credential names one API. It was capped at one live row per org only
-- because lifting the cap meant rebuilding the partial unique index below, and
-- that rebuild had no route the migration checker allows. The cap is now the
-- thing in the way: a workspace with a delivery API and a billing API needs two,
-- and until today connecting the second silently revoked the first — one-live
-- platforms treat a second save as a rotation.
--
-- So `rest` joins the platforms an org may hold several live credentials for,
-- told apart by `name`, each connector naming the row it uses through
-- `knowledge_source.api_token_id`. Nothing else changes: the one-live cap still
-- holds for every LLM platform, `aws` and `custom`, where a caller asks for
-- "the org's key" and must get a single deterministic row.
--
-- The list is spelled out in SQL because a partial index cannot call into
-- TypeScript. There are two other copies of it: `MANY_CREDENTIAL_PLATFORM_IDS`
-- in `src/libs/platforms/registry.ts`, which is what application code reads,
-- and the declaration in `src/models/Schema.ts`, which applies no DDL and is
-- read by people. `registry.test.ts` fails if any of the three drift.
--
-- Relaxing a unique index cannot conflict with rows already stored: every row
-- the new index covers was covered by the old one too, so there is nothing to
-- backfill and nothing to clean up first.

-- migration-safety: allow blocking-index on "api_token" because a partial UNIQUE
-- index has no concurrent route — CREATE INDEX CONCURRENTLY cannot run inside
-- drizzle's transaction, and migrations/concurrent/ refuses UNIQUE because dev
-- and the tests would then accept rows production rejects. The lock is bounded
-- by the table: api_token holds one row per credential a workspace has stored,
-- a handful each, and it is written only when a person saves, rotates or
-- revokes a key. The build is milliseconds, against writes that arrive by hand.
DROP INDEX IF EXISTS "api_token_org_platform_live_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_token_org_platform_live_idx"
  ON "api_token" ("org_id", "platform")
  WHERE "revoked_at" IS NULL
    AND "platform" NOT IN ('vocion', 'granola', 'hubspot', 'jira', 'strapi', 'google', 'slack', 'zoom', 'rest');
