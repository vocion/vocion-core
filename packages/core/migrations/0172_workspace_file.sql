-- The workspace's files, in the database (Vocion 5.1, step 1 of workspaces in
-- the database).
--
-- Until now an agent read its skill and playbook bodies, a dashboard page its
-- YAML and prose, and get_brand its brand.yaml off the folder on
-- WORKSPACE_PATH at the moment of the read. A host without that folder (Vocion
-- Cloud, or a shared host whose folder is another project's) therefore mounted
-- nothing: a sample workspace's skills never reached its agents, because the
-- sample was applied from templates/ while the mount looked in WORKSPACE_PATH.
--
-- Each apply now stores the files those reads ask for, one row per file, keyed
-- by the path the file has in the workspace folder (`skills/<slug>/SKILL.md`,
-- `pages/pipeline.yaml`, `brand.yaml`). The folder layout is kept on purpose:
-- a reader asks the database the same question it used to ask the disk. Text
-- is stored exactly as authored, `{{env.NAME}}` tokens included, and resolved
-- on the way out, so a value that differs per host never lands in the table.
-- A logo is stored base64 (`encoding`).
--
-- `workspace_sha` names the apply that wrote the row, so a body an agent read
-- traces to the same sha its run is stamped with.
--
-- Expand-only: a new table, so its index is built here. Nothing reads it until
-- a project's next apply writes its rows; until then every read falls back to
-- the folder exactly as before.
CREATE TABLE IF NOT EXISTS "workspace_file" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"path" text NOT NULL,
	"content" text NOT NULL,
	"encoding" text DEFAULT 'utf8' NOT NULL,
	"sha" text NOT NULL,
	"workspace_sha" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_file_org_path_idx" ON "workspace_file" USING btree ("org_id","path");
