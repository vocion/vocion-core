-- A person's own connections (Personal → Connectors): the Org's switch for
-- them, and the cleanup when a personal workspace loses its owner.
--
-- The grants themselves need no new table: each is a login row in api_token
-- under the person's personal workspace (project.kind = 'personal'), which
-- only its owner can open, encrypted under that workspace's own key.
ALTER TABLE "tenant_account" ADD COLUMN IF NOT EXISTS "personal_connections" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
-- When the person is deleted, project.owner_user_id is set null (ON DELETE
-- SET NULL) and the workspace becomes unreachable. Their vendor grants must
-- not outlive them there: delete every credential the workspace held, after
-- unlinking any source that pointed at one (that FK is ON DELETE RESTRICT).
CREATE OR REPLACE FUNCTION "personal_project_forget_credentials"() RETURNS trigger AS $$
BEGIN
  UPDATE "knowledge_source" SET "api_token_id" = NULL WHERE "org_id" = NEW."id" AND "api_token_id" IS NOT NULL;
  DELETE FROM "api_token" WHERE "org_id" = NEW."id";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "personal_project_forget_credentials_tg" ON "project";
--> statement-breakpoint
CREATE TRIGGER "personal_project_forget_credentials_tg"
  AFTER UPDATE OF "owner_user_id" ON "project"
  FOR EACH ROW
  WHEN (OLD."kind" = 'personal' AND OLD."owner_user_id" IS NOT NULL AND NEW."owner_user_id" IS NULL)
  EXECUTE FUNCTION "personal_project_forget_credentials"();
