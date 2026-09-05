-- Apollo joins the platforms an org may hold more than one live credential for.
--
-- Every connector platform is on that list, for the same reason: a key is
-- issued for one account, and a workspace with two Apollo accounts (or one
-- ordinary key and one master key) should be able to hold both and point each
-- connector at the one it wants. The one-live cap exists for LLM keys, where
-- "the org's Anthropic key" has to resolve to a single deterministic row.
--
-- Spelled out in SQL because a partial index cannot call into TypeScript;
-- `MANY_CREDENTIAL_PLATFORM_IDS` in `src/libs/platforms/registry.ts` is the
-- copy application code reads, and `registry.test.ts` fails if the two drift.
DROP INDEX IF EXISTS "api_token_org_platform_live_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_token_org_platform_live_idx"
  ON "api_token" ("org_id", "platform")
  WHERE "revoked_at" IS NULL
    AND "platform" NOT IN ('vocion', 'apollo', 'granola', 'hubspot', 'jira', 'strapi', 'google', 'slack', 'zoom');
