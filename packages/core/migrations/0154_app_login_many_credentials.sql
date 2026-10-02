-- A workspace may hold several app sign-ins.
--
-- `app-login` is a sign-in URL, an account email and a password for an app the
-- workspace builds, so the factory's QA can sign in to production and capture
-- live evidence after a release (2026-09-30). One product environment names one
-- row (`qaLoginCredentialId`), so a workspace with several products needs
-- several, told apart by `name` — the same shape as `rest` in 0153.
--
-- The list is spelled out in SQL because a partial index cannot call into
-- TypeScript; `MANY_CREDENTIAL_PLATFORM_IDS` in `src/libs/platforms/registry.ts`
-- and the declaration in `src/models/Schema.ts` are the other two copies, and
-- `registry.test.ts` fails if they drift. Relaxing the index cannot conflict
-- with stored rows: no `app-login` row exists before this migration.

-- migration-safety: allow blocking-index on "api_token" because a partial UNIQUE
-- index has no concurrent route (see 0153). api_token holds a handful of rows
-- per workspace, written only when a person saves, rotates or revokes a key.
DROP INDEX IF EXISTS "api_token_org_platform_live_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_token_org_platform_live_idx"
  ON "api_token" ("org_id", "platform")
  WHERE "revoked_at" IS NULL
    AND "platform" NOT IN ('vocion', 'granola', 'hubspot', 'jira', 'strapi', 'google', 'slack', 'zoom', 'rest', 'app-login');
