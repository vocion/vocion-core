-- Two workspace role names, not four.
--
-- `owner` and `pm` were already identical: both carry `['*']` in ROLE_GRANTS
-- (services/authz.ts), and `libs/tenancy.ts` derived one from the account role
-- (admin -> owner, member -> pm) while enforcement is off. `specialist` and
-- `client_reviewer` were never written by any code path or by any seed — no
-- row on any deployment has ever held either. So this renames the two live
-- values to the account vocabulary they already mirrored and drops the two
-- dead ones.
--
-- A grant is binary from here: a group opens a workspace or it does not. What
-- a person may do once inside is their ACCOUNT role, which this migration does
-- not touch. `member` keeps `['*']`, so nobody's approval rights change
-- (decision Q4, 25 Sep 2026).
--
-- The columns stay `text`, so per-workspace admin remains possible later
-- without a schema change.
--
-- `api_token.role` carries the same vocabulary with no CHECK behind it, and
-- casts to `WorkspaceRole` in ApiTokenService. Left as 'owner' it would resolve
-- to no grant bundle at all and every live token would silently authorize
-- nothing, so it maps here too.
UPDATE "project_member"
   SET "role" = CASE WHEN "role" = 'owner' THEN 'admin' ELSE 'member' END
 WHERE "role" IN ('owner', 'pm', 'specialist', 'client_reviewer');
--> statement-breakpoint
UPDATE "group_project_grant"
   SET "role" = CASE WHEN "role" = 'owner' THEN 'admin' ELSE 'member' END
 WHERE "role" IN ('owner', 'pm', 'specialist', 'client_reviewer');
--> statement-breakpoint
UPDATE "api_token"
   SET "role" = CASE WHEN "role" = 'owner' THEN 'admin' ELSE 'member' END
 WHERE "role" IN ('owner', 'pm', 'specialist', 'client_reviewer');
--> statement-breakpoint
ALTER TABLE "project_member" DROP CONSTRAINT IF EXISTS "project_member_role_ck";
--> statement-breakpoint
ALTER TABLE "project_member"
  ADD CONSTRAINT "project_member_role_ck" CHECK ("role" IN ('admin', 'member'));
--> statement-breakpoint
ALTER TABLE "group_project_grant" DROP CONSTRAINT IF EXISTS "group_project_grant_role_ck";
--> statement-breakpoint
ALTER TABLE "group_project_grant"
  ADD CONSTRAINT "group_project_grant_role_ck" CHECK ("role" IN ('admin', 'member'));
