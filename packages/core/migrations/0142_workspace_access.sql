-- People, groups, and per-workspace access.
--
-- Today a person reaches every project on their account: `listProjectsForUser`
-- filters on account_id alone, and the workspace role handed to `authz.ts` is
-- derived from the account role (admin -> owner, member -> pm), both of which
-- carry '*' grants. These tables are where a real answer lives. Nothing reads
-- them in this migration's release; the resolver ships dark and is switched on
-- behind VOCION_ENFORCE_WORKSPACE_ACCESS in a later one.
--
-- `user_group`, NOT `team`: a `team` in this schema is an org-chart grouping of
-- AGENTS under a lead agent (see `team.lead_agent_slug`). A group of people is
-- a different noun and must not borrow that word.
--
-- Every index here is on a table this migration creates, so none of them needs
-- `concurrent/` — nothing else can be writing to a table that does not exist
-- yet. The one index on the pre-existing `project` table does, and lives in
-- `concurrent/0142_project_owner_user_idx.sql`.

CREATE TABLE IF NOT EXISTS "user_group" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  -- 'yaml' | 'ui'. Provenance for display only: it never gates a write, because
  -- `people:apply` is create-if-absent and never updates an existing row
  -- whatever wrote it.
  "managed_from" text DEFAULT 'ui' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "user_group_account_id_tenant_account_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "tenant_account"("id") ON DELETE cascade
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "user_group_account_slug_idx"
  ON "user_group" USING btree ("account_id", "slug");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_group_member" (
  "group_id" text NOT NULL,
  "user_id" text NOT NULL,
  "added_at" timestamp DEFAULT now() NOT NULL,
  -- A user id, or 'yaml' when the seed applier put the row there.
  "added_by" text,
  CONSTRAINT "user_group_member_pk" PRIMARY KEY ("group_id", "user_id"),
  CONSTRAINT "user_group_member_group_id_user_group_id_fk"
    FOREIGN KEY ("group_id") REFERENCES "user_group"("id") ON DELETE cascade,
  CONSTRAINT "user_group_member_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade
);
--> statement-breakpoint

-- The resolver asks "what may this PERSON reach", so it reads from the user
-- side. `user_id` is the trailing column of the primary key, which cannot serve
-- that direction.
CREATE INDEX IF NOT EXISTS "user_group_member_user_idx"
  ON "user_group_member" USING btree ("user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "group_project_grant" (
  "group_id" text NOT NULL,
  "project_id" text NOT NULL,
  -- A `WorkspaceRole` from services/authz.ts. Constrained here so a bad write
  -- cannot produce a role the grant model has no entry for, which would read
  -- as "no grants" rather than as an error.
  "role" text NOT NULL,
  "granted_at" timestamp DEFAULT now() NOT NULL,
  "granted_by" text,
  CONSTRAINT "group_project_grant_pk" PRIMARY KEY ("group_id", "project_id"),
  CONSTRAINT "group_project_grant_group_id_user_group_id_fk"
    FOREIGN KEY ("group_id") REFERENCES "user_group"("id") ON DELETE cascade,
  CONSTRAINT "group_project_grant_project_id_project_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE cascade,
  CONSTRAINT "group_project_grant_role_ck"
    CHECK ("role" IN ('owner', 'pm', 'specialist', 'client_reviewer'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "group_project_grant_project_idx"
  ON "group_project_grant" USING btree ("project_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_member" (
  "project_id" text NOT NULL,
  "user_id" text NOT NULL,
  "role" text NOT NULL,
  -- Why this row exists: 'direct' (someone granted it), 'owner' (the person a
  -- personal workspace belongs to). A group grant is NOT expanded into rows
  -- here — it is resolved at read time, so removing someone from a group takes
  -- effect immediately instead of waiting for a re-expansion.
  "source" text DEFAULT 'direct' NOT NULL,
  "added_at" timestamp DEFAULT now() NOT NULL,
  "added_by" text,
  CONSTRAINT "project_member_pk" PRIMARY KEY ("project_id", "user_id"),
  CONSTRAINT "project_member_project_id_project_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE cascade,
  CONSTRAINT "project_member_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade,
  CONSTRAINT "project_member_role_ck"
    CHECK ("role" IN ('owner', 'pm', 'specialist', 'client_reviewer')),
  CONSTRAINT "project_member_source_ck"
    CHECK ("source" IN ('direct', 'owner'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "project_member_user_idx"
  ON "project_member" USING btree ("user_id");
--> statement-breakpoint

-- A workspace that belongs to one person, versus one the team shares.
-- Both are metadata-only on modern Postgres: a new column with a constant
-- default does not rewrite the table.
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'shared' NOT NULL;
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "owner_user_id" text;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "project" ADD CONSTRAINT "project_kind_ck"
    CHECK ("kind" IN ('shared', 'personal'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- `project` is populated, so this constraint scans it. It holds four rows on
-- the deployment this ships to, and the scan is on the order of microseconds;
--> statement-breakpoint
-- on a large one this would belong behind NOT VALID + a later VALIDATE.
DO $$ BEGIN
  ALTER TABLE "project" ADD CONSTRAINT "project_owner_user_id_user_id_fk"
    FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
