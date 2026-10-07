-- One workspace per mailbox address.
--
-- A workspace's mailbox is resolved by the address mail was sent TO
-- (`EmailSurfaceService.resolveMailbox`), and until now nothing stopped two
-- workspaces claiming the same one: the read took whichever row came back
-- first. On a deployment that hosts several companies that is mail for one
-- company answered in another's workspace. The default address is
-- `<slug>@<VOCION_MAIL_DOMAIN>`, and slugs are unique per account, not per
-- deployment, so two accounts each with a "revenue" workspace collide without
-- either naming an address.
--
-- Partial and on lower(): a disabled mailbox holds no address, and mail
-- addresses compare case-insensitively, which is how the read matches them.
-- `workspace:apply` checks first and refuses a claimed address with a message
-- naming the fix (`libs/mail/mailboxClaim.ts`); this index is what holds when
-- two applies race.
--
-- Existing duplicates. Building a UNIQUE index over duplicates fails, and this
-- file runs inside the deploy's migration step, so a failure here refuses the
-- container swap. Turning a mailbox off to make room would stop a workspace's
-- mail without anyone choosing that. So, as 0170 does, the build is skipped
-- with a WARNING that names the fix, and nothing else changes: the apply-time
-- check still refuses any new claim on an address already taken. Once the
-- duplicates are resolved by hand, run the CREATE below on its own.
--
-- migration-safety: allow blocking-index on "project" because a partial UNIQUE
-- index has no concurrent route (CONVENTIONS rule 1, "The one exemption"), and
-- project holds one row per workspace — tens per deployment, written only when
-- a workspace is created or its settings are applied.
DO $$
DECLARE
  duplicate_addresses integer;
BEGIN
  SELECT count(*) INTO duplicate_addresses FROM (
    SELECT lower("mailbox_address")
      FROM "project"
     WHERE "mailbox_enabled" AND "mailbox_address" IS NOT NULL
     GROUP BY lower("mailbox_address")
    HAVING count(*) > 1
  ) dupes;

  IF duplicate_addresses > 0 THEN
    RAISE WARNING 'project_mailbox_address_uq NOT created: % mailbox address(es) are enabled on more than one workspace. Give each workspace its own mailbox.address (or turn the extra mailboxes off), then run: CREATE UNIQUE INDEX IF NOT EXISTS "project_mailbox_address_uq" ON "project" (lower("mailbox_address")) WHERE "mailbox_enabled";', duplicate_addresses;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "project_mailbox_address_uq"
      ON "project" USING btree (lower("mailbox_address"))
      WHERE "mailbox_enabled";
  END IF;
END $$;
