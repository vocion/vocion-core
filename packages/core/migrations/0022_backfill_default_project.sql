-- Backfill data for Phase 1 tenancy migration.
--
-- Creates one default tenant_account + one default project, then populates
-- the new project_id column on every business-content row by mapping it from
-- the existing org_id (one project per distinct org_id encountered).
--
-- Hand-written: Drizzle's generator only emits schema DDL, not data migrations.
--
-- After this migration: every existing row has both org_id (unchanged) and
-- project_id (newly populated). Services keep filtering by org_id today;
-- a follow-up migration (separate PR, after Phase 2 lands auth.js) will
-- set project_id NOT NULL and drop org_id.

-- Seed exactly ONE tenant_account for self-hosted "team mode". For multi-org
-- legacy data, the migration creates one project per distinct org_id under
-- this single account — preserves tenant isolation through the cutover.
INSERT INTO "tenant_account" ("id", "name", "slug")
VALUES ('default-account', 'Default', 'default')
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint

-- Create a project per distinct LEGACY org_id. The project's id is
-- `proj-<orgId>` so it's deterministic + traceable to the legacy org.
--
-- GUARDED (2026-10-09): an org_id that is already a project's id is a
-- workspace, not a legacy org, and gets no project of its own. Without the
-- guard, a run against a database whose org_id already held workspace ids
-- minted a ghost per workspace — `proj-proj-<id>`, "Project proj-<id>" — and
-- the UPDATEs below then pointed that workspace's content at the ghost. Every
-- environment that applied this file before the guard keeps what it recorded;
-- the guard only changes a run on such a database, which is exactly the run
-- that did the damage. Repair: src/scripts/repair-ghost-projects.ts.
INSERT INTO "project" ("id", "account_id", "slug", "name")
SELECT
  'proj-' || org_id,
  'default-account',
  'org-' || org_id,
  'Project ' || org_id
FROM (
  SELECT DISTINCT org_id FROM "skill" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "agent" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "workflow" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "business_object_type" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "business_object" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "playbook" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "context_version" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "learning_step" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "learning" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "conversation" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "eval_dataset" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "agent_budget" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "knowledge_source" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "knowledge_document" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "knowledge_chunk" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "source_install" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "source_dek" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "source_audit" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "feedback_job" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "skill_run" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "eval_run" WHERE org_id IS NOT NULL
  UNION SELECT DISTINCT org_id FROM "workflow_run" WHERE org_id IS NOT NULL
) AS distinct_orgs
WHERE NOT EXISTS (SELECT 1 FROM "project" p WHERE p."id" = distinct_orgs.org_id)
  AND distinct_orgs.org_id NOT LIKE 'proj-%'
ON CONFLICT ("account_id", "slug") DO NOTHING;
--> statement-breakpoint

-- Populate project_id on every business-content row from its org_id: the
-- org_id itself when it is already a workspace's id, else the legacy
-- `proj-<orgId>` project created above (guarded, see that statement).
UPDATE "skill" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "agent" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "workflow" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "business_object_type" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "business_object" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "playbook" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "context_version" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "learning_step" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "learning" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "conversation" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "eval_dataset" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "agent_budget" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "knowledge_source" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "knowledge_document" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "knowledge_chunk" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "source_install" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "source_dek" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "source_audit" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "feedback_job" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "skill_run" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "eval_run" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
--> statement-breakpoint
UPDATE "workflow_run" AS t SET project_id = COALESCE((SELECT p."id" FROM "project" p WHERE p."id" = t.org_id), (SELECT p."id" FROM "project" p WHERE p."id" = 'proj-' || t.org_id)) WHERE t.project_id IS NULL;
