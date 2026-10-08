-- Runners that are safe per tenant (Vocion 5.1, docs/guides/runner.md "Multi-tenant deployments").
--
-- Until now a runner claimed with one installation-wide secret (VOCION_RUNNER_TOKEN) and took
-- the oldest queued engineering run from ANY workspace. On a host serving several companies that
-- is one company's repository code running in a container that holds a key to every other
-- company's queue. Two changes make a runner belong to a tenant:
--
-- 1. `runner_token`: a runner credential bound to one account, and optionally to a subset of its
--    workspaces. `vcn_runner_<id>_<secret>`; only the SHA-256 of the secret is stored, so the
--    token is shown once, when it is minted, and never again. An account admin (dashboard) or an
--    operator (`npm run runner-tokens`) mints and revokes them. The claim route returns only runs
--    from the token's scope (`services/runners/claimNext.ts`).
--    `project_ids` NULL means every workspace of the account, now and later; a list narrows it.
--    Rows are never deleted by the app: revoking stamps `revoked_at`, so the list still says
--    which token existed and when it stopped.
--
-- 2. `runner_target` on `project` and `tenant_account`: which of the installation's targets
--    (`VOCION_RUNNERS`, `libs/runners/config.ts`) builds this workspace's runs. The workspace's
--    own value wins, then its account's; NULL on both is today's behaviour, any target. A run is
--    then claimed only by that target and started (Fargate push) only there, so a tenant's code
--    runs only on capacity meant for it.
--
-- Expand-only: one new table, two nullable columns with no default (metadata-only on a
-- populated table), and an index on the new table only. Every existing row reads NULL, which is
-- exactly the single-tenant behaviour. Replay-safe: every statement is IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS "runner_token" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "name" text NOT NULL,
  "secret_hash" text NOT NULL,
  "key_hint" text,
  "project_ids" jsonb,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_used_at" timestamp,
  "revoked_at" timestamp,
  "expires_at" timestamp
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runner_token_account_id_fk') THEN
    ALTER TABLE "runner_token"
      ADD CONSTRAINT "runner_token_account_id_fk"
      FOREIGN KEY ("account_id") REFERENCES "tenant_account"("id") ON DELETE CASCADE;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runner_token_account_idx" ON "runner_token" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "runner_target" text;--> statement-breakpoint
ALTER TABLE "tenant_account" ADD COLUMN IF NOT EXISTS "runner_target" text;
