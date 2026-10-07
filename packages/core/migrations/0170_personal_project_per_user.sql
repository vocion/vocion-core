-- One personal workspace per person per account.
--
-- `ensurePersonalProject` (services/workspace/personalProject.ts) creates a
-- person's personal workspace when they sign in and when they accept an
-- invite. It is called from several places at once (two tabs signing in, an
-- invite accepted while the JWT is issued), so "one per person" has to be a
-- constraint the database holds, not a check the code makes: the insert is
-- ON CONFLICT DO NOTHING against this index, then reads back whichever row won.
--
-- Per (account, owner) rather than per owner: a person in two accounts holds a
-- personal workspace in each, because a workspace belongs to exactly one
-- account and everything in it is that account's data. Self-hosted has one
-- account, where the two readings are the same.
--
-- Existing duplicates. Nothing in core has written a personal workspace before
-- this release, but a seed or a hand-written row could have. Building a UNIQUE
-- index over duplicates fails, and this file runs inside the deploy's migration
-- step, so a failure there refuses the container swap. Deleting a workspace to
-- make room would drop someone's data. So the build is skipped instead, with a
-- WARNING that names the fix, and nothing else changes: `ensurePersonalProject`
-- stays single-row without the index because its slug is derived from the user
-- id and (account_id, slug) is already unique (`project_account_slug_idx`), so
-- two concurrent calls collide there instead. Once the duplicates are merged by
-- hand, run the CREATE below on its own.
--
-- migration-safety: allow blocking-index on "project" because a partial UNIQUE
-- index has no concurrent route (CONVENTIONS rule 1, "The one exemption"), and
-- project holds one row per workspace — tens per deployment, written only when
-- a workspace is created or its settings are applied.
DO $$
DECLARE
  duplicate_owners integer;
BEGIN
  SELECT count(*) INTO duplicate_owners FROM (
    SELECT "account_id", "owner_user_id"
      FROM "project"
     WHERE "kind" = 'personal' AND "owner_user_id" IS NOT NULL
     GROUP BY "account_id", "owner_user_id"
    HAVING count(*) > 1
  ) dupes;

  IF duplicate_owners > 0 THEN
    RAISE WARNING 'project_personal_owner_uq NOT created: % (account, owner) pair(s) hold more than one personal workspace. Merge them, then run: CREATE UNIQUE INDEX IF NOT EXISTS "project_personal_owner_uq" ON "project" ("account_id", "owner_user_id") WHERE "kind" = ''personal'';', duplicate_owners;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "project_personal_owner_uq"
      ON "project" USING btree ("account_id", "owner_user_id")
      WHERE "kind" = 'personal';
  END IF;
END $$;
