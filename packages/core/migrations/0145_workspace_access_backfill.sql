-- Backfill: nobody loses access when enforcement is switched on.
--
-- Numbered 0145 rather than 0143: main claimed 0143 and 0144 first, so this
-- renumbered to the tail per CONVENTIONS rule 5. It had not merged, so there is
-- no applied copy anywhere under the old number.
--
-- Today every member of an account reaches every project on it, at a workspace
-- role derived from the account role (admin -> owner, member -> pm). Once
-- VOCION_ENFORCE_WORKSPACE_ACCESS=1, access comes from grants instead — so
-- without this, turning the flag on empties everyone's workspace switcher.
--
-- One direct grant per (person, shared workspace), carrying exactly the role
-- they hold today. Personal workspaces are excluded: none exist yet, and their
-- access comes from ownership rather than from a grant.
--
-- Admins are included even though the resolver already gives them every shared
-- workspace. The row makes today's access explicit and survivable if the
-- admin-implies-owner rule is ever narrowed, and ON CONFLICT keeps it harmless.
--
-- Idempotent, and safe to re-run: `ON CONFLICT DO NOTHING` never overwrites a
-- grant someone has since edited in the interface. That is the same rule
-- `people:apply` will follow, and the reason `enabled_surfaces` is NOT the
-- model to copy here.
-- Written in whichever role vocabulary is IN FORCE, which is not a detail.
--
-- This file is not run once. `infra/aws/migrate.sh` applies every .sql on
-- every deploy and sorts real errors from already-applied ones by message, so
-- an idempotent backfill re-runs forever by design — harmless while the values
-- it writes stay legal.
--
-- 0146 collapsed the four role names to two and pinned `project_member_role_ck`
-- to ('admin','member'). From that moment this INSERT's 'owner'/'pm' were
-- values the constraint rejects, so the next deploy that found a new
-- (member, shared workspace) pair to insert failed the whole migration step
-- and refused the swap. That happened on 2026-09-27.
--
-- So ask the constraint what it accepts. On a fresh database the order is
-- 0142 (old vocabulary) → here → 0146 (remaps), which still works: this writes
-- the old names and 0146 maps them. On a migrated one the new constraint is
-- already in force and this writes the new names directly.
DO $$
DECLARE
  new_vocabulary boolean;
BEGIN
  SELECT pg_get_constraintdef(oid) NOT LIKE '%''owner''%'
    INTO new_vocabulary
    FROM pg_constraint
   WHERE conname = 'project_member_role_ck';

  -- No constraint at all: write what the model uses today.
  IF COALESCE(new_vocabulary, true) THEN
    INSERT INTO "project_member" ("project_id", "user_id", "role", "source", "added_by")
    SELECT p."id", m."user_id",
           CASE WHEN m."role" = 'admin' THEN 'admin' ELSE 'member' END,
           'direct', 'backfill-0145'
    FROM "project" p
    JOIN "account_membership" m ON m."account_id" = p."account_id"
    WHERE p."kind" = 'shared'
    ON CONFLICT ("project_id", "user_id") DO NOTHING;
  ELSE
    INSERT INTO "project_member" ("project_id", "user_id", "role", "source", "added_by")
    SELECT p."id", m."user_id",
           CASE WHEN m."role" = 'admin' THEN 'owner' ELSE 'pm' END,
           'direct', 'backfill-0145'
    FROM "project" p
    JOIN "account_membership" m ON m."account_id" = p."account_id"
    WHERE p."kind" = 'shared'
    ON CONFLICT ("project_id", "user_id") DO NOTHING;
  END IF;
END $$;
