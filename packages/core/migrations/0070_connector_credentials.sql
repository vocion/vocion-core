-- Connector installs point at a stored credential instead of holding their own.
--
-- Two changes, one idea. `api_token` already holds an org's third-party keys;
-- until now a connector install kept a second, independent copy of the same
-- key in `source_credential`. That meant a Jira key typed twice and rotated
-- twice, and ingestion breaking quietly whenever only one copy was updated.
--
-- 1. `source_install.api_token_id` names the credential the install
--    authenticates with. Nullable: every OAuth connector keeps its grant in
--    `source_credential` (a grant is issued to one installation and carries a
--    refresh token, so there is nothing to share), the no-auth connectors need
--    nothing, and an API-key install created before this column existed stays
--    null until the backfill script runs.
--
--    ON DELETE RESTRICT because a credential an install is using must not
--    vanish underneath it. Retiring one means revoking the row, which leaves
--    the install pointing at a revoked credential — that is what lets the
--    connector report a broken credential instead of failing its next sync for
--    no stated reason.
--
-- 2. `api_token_org_platform_live_idx` grows a carve-out. The index exists so
--    "the org's OpenAI key" resolves to a single deterministic row, and that
--    stays true. But a connector platform is resolved the other way round: the
--    install names the credential by id, so "Strapi — staging" and
--    "Strapi — prod" are both live at once and the uniqueness rule is simply
--    wrong for them.
--
--    The platform ids are spelled out because a partial index cannot call into
--    TypeScript. `MANY_CREDENTIAL_PLATFORM_IDS` in
--    `src/libs/platforms/registry.ts` is the copy application code reads, and
--    `registry.test.ts` fails if the two lists drift. The list is of the
--    platforms exempt from the rule rather than the ones subject to it, so a
--    platform added without touching this file inherits the strict cap rather
--    than losing it.
--
-- One consequence for migration 0069's `api_token_platform_immutable_tg`:
-- rotating a connector credential is now an UPDATE in place on `api_token`
-- rather than a revoke-and-insert, because the install's foreign key has to
-- keep pointing at the same row. The trigger is unaffected — it only refuses
-- writes that change `platform`, which rotation never does.

ALTER TABLE "source_install"
  ADD COLUMN IF NOT EXISTS "api_token_id" text;

--> statement-breakpoint

ALTER TABLE "source_install"
  DROP CONSTRAINT IF EXISTS "source_install_api_token_id_api_token_id_fk";

--> statement-breakpoint

ALTER TABLE "source_install"
  ADD CONSTRAINT "source_install_api_token_id_api_token_id_fk"
  FOREIGN KEY ("api_token_id") REFERENCES "api_token"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "source_install_api_token_idx"
  ON "source_install" ("api_token_id");

--> statement-breakpoint

DROP INDEX IF EXISTS "api_token_org_platform_live_idx";

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "api_token_org_platform_live_idx"
  ON "api_token" ("org_id", "platform")
  WHERE "revoked_at" IS NULL
    AND "platform" NOT IN ('vocion', 'granola', 'hubspot', 'jira', 'strapi');
