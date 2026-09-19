-- Applied outside a transaction by infra/aws/apply-migrations.sh.
--
-- Per-user resolution asks one new question of this table — "the live grant on
-- this install belonging to this owner" — and asks it on every turn that
-- touches a personal connector. Without an index that is a scan of every
-- credential the install has ever held.
--
-- Not UNIQUE, deliberately. Uniqueness here is a constraint, and CONVENTIONS.md
-- refuses one in this directory because dev and the unit tests run without
-- these files and would then accept rows production rejects. The guarantee is
-- held in the write path instead: `storeCredential` revokes the prior live row
-- for the same (install, owner) in the same transaction, which is the same
-- shape `storePlatformKey` uses for `api_token`.
--
-- The DROP clears an INVALID index left by a build that died partway;
-- IF NOT EXISTS is required because baselining records only the numbered
-- migrations, so this can legitimately run against a database that has it.
DROP INDEX IF EXISTS "source_credential_install_owner_live_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "source_credential_install_owner_live_idx"
  ON "source_credential" USING btree ("install_id", "user_id", "created_at" DESC)
  WHERE "revoked_at" IS NULL;
