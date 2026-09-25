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
INSERT INTO "project_member" ("project_id", "user_id", "role", "source", "added_by")
SELECT
  p."id",
  m."user_id",
  CASE WHEN m."role" = 'admin' THEN 'owner' ELSE 'pm' END,
  'direct',
  'backfill-0145'
FROM "project" p
JOIN "account_membership" m ON m."account_id" = p."account_id"
WHERE p."kind" = 'shared'
ON CONFLICT ("project_id", "user_id") DO NOTHING;
