-- A workspace may hold several QuickBooks logins: one per company.
--
-- A QuickBooks Online login grants one company (Intuit's `realmId`), and a firm
-- keeps its books in several, one per legal entity. On a one-live platform a
-- second company's login reads as a rotation of the first: the first is
-- revoked, and the sources reading the first company are relinked to the
-- second company's books. Carving `quickbooks` out of the cap makes each
-- company its own row, told apart by its account (`<name> (company <id>)`),
-- the same shape as `rest` in 0153 and `app-login` in 0154.
--
-- The list is spelled out in SQL because a partial index cannot call into
-- TypeScript; `MANY_CREDENTIAL_PLATFORM_IDS` in `src/libs/platforms/registry.ts`
-- and the declaration in `src/models/Schema.ts` are the other two copies, and
-- `registry.test.ts` fails if they drift. Relaxing the index cannot conflict
-- with stored rows: no `quickbooks` row exists before this migration.

-- migration-safety: allow blocking-index on "api_token" because a partial UNIQUE
-- index has no concurrent route (see 0153). api_token holds a handful of rows
-- per workspace, written only when a person saves, rotates or revokes a key.
DROP INDEX IF EXISTS "api_token_org_platform_live_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_token_org_platform_live_idx"
  ON "api_token" ("org_id", "platform")
  WHERE "revoked_at" IS NULL
    AND "platform" NOT IN ('vocion', 'granola', 'hubspot', 'jira', 'strapi', 'google', 'slack', 'zoom', 'rest', 'app-login', 'quickbooks');
