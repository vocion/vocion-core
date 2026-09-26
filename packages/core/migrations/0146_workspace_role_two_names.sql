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
-- `api_token.role` carries the same vocabulary and is deliberately NOT touched.
-- A deploy applies migrations BEFORE the container swap, so for the length of
-- the drain the PREVIOUS image is still serving against this data. Rewriting
-- that column would leave a token whose authority comes from its role, rather
-- than from explicit grants, resolving to no grants at all on that image, and
-- every call it made would be refused until the swap finished. The value stays
-- and `normalizeWorkspaceRole` accepts both vocabularies instead; a later
-- release can contract it once no row holds a legacy name.
--
-- The two tables below are safe to rewrite because the previous image reads
-- them for DISPLAY on the members screen and for a resolver that is not
-- consulted while enforcement is off, which it is on that image.
--
-- The CHECKs come off FIRST. They still name the four old values while the
-- rows hold them, so an UPDATE that writes 'admin' under the old constraint is
-- refused before it has changed anything. An empty table hides this: the
-- statement matches no rows and passes, which is why it took a database with
-- real rows in it to find.
ALTER TABLE "project_member" DROP CONSTRAINT IF EXISTS "project_member_role_ck";
--> statement-breakpoint
ALTER TABLE "group_project_grant" DROP CONSTRAINT IF EXISTS "group_project_grant_role_ck";
--> statement-breakpoint
UPDATE "project_member"
   SET "role" = CASE WHEN "role" = 'owner' THEN 'admin' ELSE 'member' END
 WHERE "role" IN ('owner', 'pm', 'specialist', 'client_reviewer');
--> statement-breakpoint
UPDATE "group_project_grant"
   SET "role" = CASE WHEN "role" = 'owner' THEN 'admin' ELSE 'member' END
 WHERE "role" IN ('owner', 'pm', 'specialist', 'client_reviewer');
--> statement-breakpoint
ALTER TABLE "project_member"
  ADD CONSTRAINT "project_member_role_ck" CHECK ("role" IN ('admin', 'member'));
--> statement-breakpoint
ALTER TABLE "group_project_grant"
  ADD CONSTRAINT "group_project_grant_role_ck" CHECK ("role" IN ('admin', 'member'));
